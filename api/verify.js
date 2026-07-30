const rateBuckets = globalThis.__nakaVerifyRateBuckets || new Map();
globalThis.__nakaVerifyRateBuckets = rateBuckets;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function cleanString(value, max = 100) {
  if (value === undefined || value === null) return null;
  return String(value).trim().slice(0, max);
}

function positiveId(value) {
  const text = cleanString(value, 30);
  return text && /^\d+$/.test(text) && text !== '0' ? text : null;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return cleanString(Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0], 80)
    || cleanString(req.socket?.remoteAddress, 80)
    || 'unknown';
}

function rateLimited(key, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || now >= current.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function supabaseFetch(url, key, path, options = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${response.status}: ${body.slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function logAttempt(config, data) {
  try {
    await supabaseFetch(config.url, config.key, 'access_attempts', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        owner_id: data.ownerId,
        owner_type: data.ownerType,
        product: data.product,
        place_id: data.placeId,
        universe_id: data.universeId,
        place_name: data.placeName,
        game_name: data.gameName,
        system_version: data.systemVersion,
        ip_address: data.ip,
        user_agent: data.userAgent,
        reason: data.reason,
        attempted_at: new Date().toISOString()
      })
    });
  } catch (error) {
    console.error('[verify] access-attempt logging failed:', error.message);
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ valid: false, message: 'Method not allowed' });

  const ip = clientIp(req);
  if (rateLimited(`verify:${ip}`)) {
    return res.status(429).json({ valid: false, message: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[verify] Missing SUPABASE_URL/SUPABASE_KEY');
    return res.status(500).json({ valid: false, message: 'Server misconfigured' });
  }

  const body = req.body || {};
  const ownerId = positiveId(body.ownerId);
  const ownerType = body.ownerType === 'Group' ? 'Group' : 'User';
  const product = cleanString(body.product || 'kit-naka', 50);
  const placeId = positiveId(body.placeId);
  const universeId = positiveId(body.universeId);
  const licenseKey = cleanString(body.licenseKey, 200);
  const metadata = {
    placeName: cleanString(body.placeName, 100),
    gameName: cleanString(body.gameName, 100),
    jobId: cleanString(body.jobId, 100),
    playerCount: Number.isInteger(Number(body.playerCount)) ? Math.max(0, Math.min(1000, Number(body.playerCount))) : null,
    maxPlayers: Number.isInteger(Number(body.maxPlayers)) ? Math.max(0, Math.min(1000, Number(body.maxPlayers))) : null,
    isPrivateServer: typeof body.isPrivateServer === 'boolean' ? body.isPrivateServer : null,
    isStudio: typeof body.isStudio === 'boolean' ? body.isStudio : null,
    systemVersion: cleanString(body.systemVersion, 30)
  };

  const attemptBase = {
    ownerId, ownerType, product, placeId, universeId,
    placeName: metadata.placeName, gameName: metadata.gameName,
    systemVersion: metadata.systemVersion, ip,
    userAgent: cleanString(req.headers['user-agent'], 200)
  };

  if (!ownerId || !placeId || !universeId || !product) {
    await logAttempt({ url: SUPABASE_URL, key: SUPABASE_KEY }, { ...attemptBase, reason: 'invalid_request' });
    return res.status(400).json({ valid: false, message: 'Data lisensi atau identitas game tidak lengkap' });
  }

  try {
    const query = [
      `owner_id=eq.${encodeURIComponent(ownerId)}`,
      `owner_type=eq.${encodeURIComponent(ownerType)}`,
      `product=eq.${encodeURIComponent(product)}`,
      'select=*',
      'limit=1'
    ].join('&');
    const licenses = await supabaseFetch(SUPABASE_URL, SUPABASE_KEY, `licenses?${query}`);
    const item = Array.isArray(licenses) ? licenses[0] : null;

    if (!item) {
      await logAttempt({ url: SUPABASE_URL, key: SUPABASE_KEY }, { ...attemptBase, reason: 'license_not_found' });
      return res.status(200).json({ valid: false, message: 'Lisensi tidak terdaftar' });
    }

    // Dashboard approval is the primary authorization path. Keep optional
    // key validation for older clients that still send a license key.
    if (licenseKey && item.license_key_hash) {
      const keyHash = await sha256(licenseKey);
      if (keyHash !== item.license_key_hash) {
        await logAttempt({ url: SUPABASE_URL, key: SUPABASE_KEY }, { ...attemptBase, reason: 'invalid_license_key' });
        return res.status(200).json({ valid: false, message: 'License key tidak cocok' });
      }
    }

    const status = cleanString(item.status, 20)?.toLowerCase();
    if (status !== 'active') {
      await logAttempt({ url: SUPABASE_URL, key: SUPABASE_KEY }, { ...attemptBase, reason: `license_${status || 'inactive'}` });
      return res.status(200).json({ valid: false, message: 'Lisensi tidak aktif' });
    }

    if (item.expires_at && new Date(item.expires_at).getTime() <= Date.now()) {
      await logAttempt({ url: SUPABASE_URL, key: SUPABASE_KEY }, { ...attemptBase, reason: 'license_expired' });
      return res.status(200).json({ valid: false, message: 'Lisensi telah kedaluwarsa' });
    }

    // Universe and place are telemetry only. Authorization is intentionally
    // based on owner identity, owner type, product, status, and expiry.

    await supabaseFetch(SUPABASE_URL, SUPABASE_KEY, 'installations?on_conflict=owner_id,product,place_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        owner_id: ownerId,
        owner_type: ownerType,
        product,
        place_id: placeId,
        universe_id: universeId,
        place_name: metadata.placeName,
        game_name: metadata.gameName,
        job_id: metadata.jobId,
        player_count: metadata.playerCount,
        max_players: metadata.maxPlayers,
        is_private_server: metadata.isPrivateServer,
        is_studio: metadata.isStudio,
        system_version: metadata.systemVersion,
        last_seen_at: new Date().toISOString()
      })
    });

    return res.status(200).json({
      valid: true,
      ownerId,
      ownerType,
      product,
      universeId,
      status: 'active',
      expiresAt: item.expires_at || null,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    const detail = String(error?.message || 'Unknown error').slice(0, 300);
    console.error('[verify] error:', detail);
    return res.status(502).json({
      valid: false,
      message: 'Layanan lisensi sedang bermasalah',
      detail
    });
  }
}
