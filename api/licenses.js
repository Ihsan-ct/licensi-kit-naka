const adminRateBuckets = globalThis.__nakaAdminRateBuckets || new Map();
globalThis.__nakaAdminRateBuckets = adminRateBuckets;

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

function rateLimited(key, limit = 60, windowMs = 60_000) {
  const now = Date.now();
  const current = adminRateBuckets.get(key);
  if (!current || now >= current.resetAt) {
    adminRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
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

async function db(url, key, path, options = {}) {
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

function setCors(req, res) {
  const allowedOrigin = process.env.ADMIN_ORIGIN;
  const origin = req.headers.origin;
  if (allowedOrigin && origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin || 'null');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
  res.setHeader('Cache-Control', 'no-store');
}

function authorized(req) {
  const expected = process.env.ADMIN_SECRET;
  const received = req.headers['x-admin-secret'];
  return Boolean(expected && received && received === expected);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ip = clientIp(req);
  if (rateLimited(`admin:${ip}`)) return res.status(429).json({ error: 'Terlalu banyak request' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Server misconfigured' });

  try {
    if (req.method === 'GET') {
      const [licenses, installations, attempts] = await Promise.all([
        db(SUPABASE_URL, SUPABASE_KEY, 'licenses?select=*&order=created_at.desc'),
        db(SUPABASE_URL, SUPABASE_KEY, 'installations?select=*&order=last_seen_at.desc'),
        db(SUPABASE_URL, SUPABASE_KEY, 'access_attempts?select=*&order=attempted_at.desc&limit=500')
      ]);

      const groups = {};
      for (const inst of Array.isArray(installations) ? installations : []) {
        const key = `${inst.owner_id}:${inst.owner_type}:${inst.product}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(inst);
      }

      const merged = [];
      for (const lic of Array.isArray(licenses) ? licenses : []) {
        const key = `${lic.owner_id}:${lic.owner_type}:${lic.product}`;
        const rows = groups[key] || [];
        const base = {
          record_type: 'license',
          owner_id: lic.owner_id,
          owner_type: lic.owner_type,
          product: lic.product,
          status: lic.status,
          expires_at: lic.expires_at,
          universe_id_bound: lic.universe_id || null,
          activated_at: lic.activated_at || null,
          created_at: lic.created_at
        };
        if (!rows.length) {
          merged.push({ ...base, ever_connected: false });
        } else {
          for (const inst of rows) {
            merged.push({
              ...base,
              ever_connected: true,
              place_id: inst.place_id,
              universe_id: inst.universe_id,
              place_name: inst.place_name,
              game_name: inst.game_name,
              player_count: inst.player_count,
              max_players: inst.max_players,
              is_private_server: inst.is_private_server,
              is_studio: inst.is_studio,
              system_version: inst.system_version,
              first_seen_at: inst.first_seen_at,
              last_seen_at: inst.last_seen_at
            });
          }
        }
      }

      const unauthorized = (Array.isArray(attempts) ? attempts : []).map((row) => ({
        record_type: 'unauthorized',
        status: 'unauthorized',
        owner_id: row.owner_id,
        owner_type: row.owner_type,
        product: row.product,
        place_id: row.place_id,
        universe_id: row.universe_id,
        place_name: row.place_name,
        game_name: row.game_name,
        system_version: row.system_version,
        reason: row.reason,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        attempted_at: row.attempted_at,
        last_seen_at: row.attempted_at
      }));

      return res.status(200).json({ licenses: merged, unauthorized });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const ownerId = positiveId(body.ownerId);
      const ownerType = body.ownerType === 'Group' ? 'Group' : body.ownerType === 'User' ? 'User' : null;
      const product = cleanString(body.product, 50);
      const status = ['active', 'pending', 'suspended', 'revoked'].includes(body.status) ? body.status : 'active';
      const licenseKey = cleanString(body.licenseKey, 200);
      const universeId = body.universeId ? positiveId(body.universeId) : null;
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

      if (!ownerId || !ownerType || !product || !licenseKey || licenseKey.length < 16) {
        return res.status(400).json({ error: 'Owner, product, dan license key minimal 16 karakter wajib diisi' });
      }
      if (expiresAt && Number.isNaN(expiresAt.getTime())) return res.status(400).json({ error: 'Format expiresAt tidak valid' });

      const licenseKeyHash = await sha256(licenseKey);
      const created = await db(SUPABASE_URL, SUPABASE_KEY, 'licenses?on_conflict=owner_id,owner_type,product', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          owner_id: ownerId,
          owner_type: ownerType,
          product,
          status,
          expires_at: expiresAt ? expiresAt.toISOString() : null,
          universe_id: universeId,
          license_key_hash: licenseKeyHash
        })
      });
      return res.status(200).json({ success: true, license: created?.[0] || null });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const ownerId = positiveId(body.ownerId);
      const ownerType = body.ownerType === 'Group' ? 'Group' : body.ownerType === 'User' ? 'User' : null;
      const product = cleanString(body.product, 50);
      if (!ownerId || !ownerType || !product) return res.status(400).json({ error: 'Identitas lisensi tidak lengkap' });

      const patch = {};
      if (['active', 'pending', 'suspended', 'revoked'].includes(body.status)) patch.status = body.status;
      if (body.resetUniverse === true) {
        patch.universe_id = null;
        patch.activated_at = null;
      } else if (body.universeId !== undefined) {
        const universeId = body.universeId ? positiveId(body.universeId) : null;
        if (body.universeId && !universeId) return res.status(400).json({ error: 'Universe ID tidak valid' });
        patch.universe_id = universeId;
      }
      if (body.licenseKey) {
        const nextKey = cleanString(body.licenseKey, 200);
        if (!nextKey || nextKey.length < 16) return res.status(400).json({ error: 'License key minimal 16 karakter' });
        patch.license_key_hash = await sha256(nextKey);
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Tidak ada perubahan' });

      const updated = await db(
        SUPABASE_URL,
        SUPABASE_KEY,
        `licenses?owner_id=eq.${encodeURIComponent(ownerId)}&owner_type=eq.${encodeURIComponent(ownerType)}&product=eq.${encodeURIComponent(product)}`,
        { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) }
      );
      return res.status(200).json({ success: true, license: updated?.[0] || null });
    }

    if (req.method === 'DELETE') {
      const body = req.body || {};
      const ownerId = positiveId(body.ownerId);
      const ownerType = body.ownerType === 'Group' ? 'Group' : body.ownerType === 'User' ? 'User' : null;
      const product = cleanString(body.product, 50);
      if (!ownerId || !ownerType || !product) return res.status(400).json({ error: 'Identitas lisensi tidak lengkap' });

      await db(
        SUPABASE_URL,
        SUPABASE_KEY,
        `licenses?owner_id=eq.${encodeURIComponent(ownerId)}&owner_type=eq.${encodeURIComponent(ownerType)}&product=eq.${encodeURIComponent(product)}`,
        { method: 'DELETE', headers: { Prefer: 'return=minimal' } }
      );
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[licenses]', error.message);
    return res.status(502).json({ error: 'Database gagal merespons', detail: error.message });
  }
}
