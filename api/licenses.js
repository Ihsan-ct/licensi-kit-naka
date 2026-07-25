import { requireAdmin } from './_lib/admin.js';

const buckets = globalThis.__nakaAdminRateBuckets || new Map();
globalThis.__nakaAdminRateBuckets = buckets;

const clean = (v, max = 120) => v == null ? null : String(v).trim().slice(0, max);
const validId = (v) => { const s = clean(v, 30); return s && /^\d+$/.test(s) && s !== '0' ? s : null; };
const ipOf = (req) => clean(String(req.headers['x-forwarded-for'] || '').split(',')[0], 80) || clean(req.socket?.remoteAddress, 80) || 'unknown';

function limited(key, limit = 60, windowMs = 60_000) {
  const now = Date.now();
  const item = buckets.get(key);
  if (!item || now >= item.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  item.count += 1;
  return item.count > limit;
}

async function hash(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function db(base, key, path, options = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function cors(req, res) {
  const configured = process.env.ADMIN_ORIGIN;
  const origin = req.headers.origin;
  if (configured && origin === configured) {
    res.setHeader('Access-Control-Allow-Origin', configured);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', configured || 'null');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

async function safeRead(base, key, path, warningCode, warnings) {
  try { return await db(base, key, path); }
  catch (error) { warnings.push({ code: warningCode, message: error.message }); return []; }
}

function installationIdentity(row) {
  return [row.owner_id || '', row.owner_type || 'User', row.product || '', row.place_id || '', row.universe_id || ''].join(':');
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (limited(`admin:${ipOf(req)}`)) return res.status(429).json({ error: 'Terlalu banyak request' });
  try { await requireAdmin(req); }
  catch (error) { return res.status(error.status || 401).json({ error: error.message || 'Sesi admin tidak valid' }); }

  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!base || !key) return res.status(500).json({ error: 'SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi' });

  try {
    if (req.method === 'GET') {
      const warnings = [];
      const licenses = await safeRead(base, key, 'licenses?select=*&order=created_at.desc', 'LICENSES_READ_FAILED', warnings);
      const installations = await safeRead(base, key, 'installations?select=*&order=last_seen_at.desc', 'INSTALLATIONS_READ_FAILED', warnings);
      const attempts = await safeRead(base, key, 'access_attempts?select=*&order=attempted_at.desc&limit=500', 'ACCESS_ATTEMPTS_TABLE_MISSING', warnings);

      const installGroups = {};
      const licenseKeys = new Set();
      for (const lic of licenses) licenseKeys.add(`${lic.owner_id}:${lic.owner_type}:${lic.product}`);
      for (const inst of installations) {
        const groupKey = `${inst.owner_id}:${inst.owner_type || 'User'}:${inst.product}`;
        (installGroups[groupKey] ||= []).push(inst);
      }

      const merged = [];
      for (const lic of licenses) {
        const groupKey = `${lic.owner_id}:${lic.owner_type}:${lic.product}`;
        const rows = installGroups[groupKey] || [];
        const baseRow = {
          record_type: 'license', owner_id: lic.owner_id, owner_type: lic.owner_type,
          product: lic.product, status: lic.status, expires_at: lic.expires_at,
          universe_id_bound: lic.universe_id || null, activated_at: lic.activated_at || null,
          created_at: lic.created_at
        };
        if (!rows.length) merged.push({ ...baseRow, ever_connected: false });
        for (const inst of rows) {
          merged.push({
            ...baseRow, ever_connected: true, place_id: inst.place_id,
            universe_id: inst.universe_id, place_name: inst.place_name,
            game_name: inst.game_name, player_count: inst.player_count,
            max_players: inst.max_players, is_private_server: inst.is_private_server,
            is_studio: inst.is_studio, system_version: inst.system_version,
            first_seen_at: inst.first_seen_at, last_seen_at: inst.last_seen_at
          });
        }
      }

      const unauthorized = attempts.map((row) => ({
        record_type: 'unauthorized', source: 'security_log', status: 'unauthorized', owner_id: row.owner_id,
        owner_type: row.owner_type, product: row.product, place_id: row.place_id,
        universe_id: row.universe_id, place_name: row.place_name, game_name: row.game_name,
        system_version: row.system_version, reason: row.reason, ip_address: row.ip_address,
        user_agent: row.user_agent, attempted_at: row.attempted_at, last_seen_at: row.attempted_at
      }));

      const loggedInstallationIds = new Set(attempts.map(installationIdentity));
      for (const inst of installations) {
        const groupKey = `${inst.owner_id}:${inst.owner_type || 'User'}:${inst.product}`;
        if (licenseKeys.has(groupKey) || loggedInstallationIds.has(installationIdentity(inst))) continue;
        unauthorized.push({
          record_type: 'unauthorized', source: 'legacy_installation', status: 'unauthorized',
          owner_id: inst.owner_id, owner_type: inst.owner_type || 'User', product: inst.product,
          place_id: inst.place_id, universe_id: inst.universe_id, place_name: inst.place_name,
          game_name: inst.game_name, system_version: inst.system_version,
          reason: 'LEGACY_NO_LICENSE', ip_address: null, user_agent: null,
          attempted_at: inst.last_seen_at || inst.first_seen_at || null,
          first_seen_at: inst.first_seen_at || null,
          last_seen_at: inst.last_seen_at || inst.first_seen_at || null
        });
      }

      unauthorized.sort((a, b) => new Date(b.attempted_at || 0) - new Date(a.attempted_at || 0));
      const fatal = warnings.find((w) => w.code === 'LICENSES_READ_FAILED');
      if (fatal) return res.status(502).json({ error: 'Tabel licenses gagal dibaca', detail: fatal.message, warnings });
      return res.status(200).json({ licenses: merged, unauthorized, warnings });
    }

    const body = req.body || {};
    const ownerId = validId(body.ownerId);
    const ownerType = body.ownerType === 'Group' ? 'Group' : body.ownerType === 'User' ? 'User' : null;
    const product = clean(body.product, 50);
    if (!ownerId || !ownerType || !product) return res.status(400).json({ error: 'Owner ID, owner type, dan product wajib valid' });

    if (req.method === 'POST') {
      const licenseKey = clean(body.licenseKey, 200);
      const status = ['active', 'pending', 'suspended', 'revoked'].includes(body.status) ? body.status : 'active';
      const universeId = body.universeId ? validId(body.universeId) : null;
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      if (!licenseKey || licenseKey.length < 16) return res.status(400).json({ error: 'License key minimal 16 karakter' });
      if (expiresAt && Number.isNaN(expiresAt.getTime())) return res.status(400).json({ error: 'Tanggal kedaluwarsa tidak valid' });

      const created = await db(base, key, 'licenses?on_conflict=owner_id,owner_type,product', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          owner_id: ownerId, owner_type: ownerType, product, status,
          expires_at: expiresAt ? expiresAt.toISOString() : null,
          universe_id: universeId, license_key_hash: await hash(licenseKey)
        })
      });
      return res.status(200).json({ success: true, license: created?.[0] || null });
    }

    const query = `licenses?owner_id=eq.${encodeURIComponent(ownerId)}&owner_type=eq.${encodeURIComponent(ownerType)}&product=eq.${encodeURIComponent(product)}`;

    if (req.method === 'PATCH') {
      const patch = {};
      if (['active', 'pending', 'suspended', 'revoked'].includes(body.status)) patch.status = body.status;
      if (body.resetUniverse === true) { patch.universe_id = null; patch.activated_at = null; }
      else if (body.universeId !== undefined) {
        const universeId = body.universeId ? validId(body.universeId) : null;
        if (body.universeId && !universeId) return res.status(400).json({ error: 'Universe ID tidak valid' });
        patch.universe_id = universeId;
      }
      if (body.licenseKey) {
        const nextKey = clean(body.licenseKey, 200);
        if (!nextKey || nextKey.length < 16) return res.status(400).json({ error: 'License key minimal 16 karakter' });
        patch.license_key_hash = await hash(nextKey);
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Tidak ada perubahan' });
      const updated = await db(base, key, query, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch)
      });
      return res.status(200).json({ success: true, license: updated?.[0] || null });
    }

    if (req.method === 'DELETE') {
      await db(base, key, query, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[licenses]', error);
    return res.status(502).json({ error: 'Database gagal merespons', detail: error.message });
  }
}
