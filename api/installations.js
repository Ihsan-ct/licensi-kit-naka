function cleanString(value, max = 100) {
  if (value === undefined || value === null) return null;
  return String(value).trim().slice(0, max);
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-admin-secret');
  res.setHeader('Cache-Control', 'no-store');
}

async function db(url, key, path) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ADMIN_SECRET = process.env.ADMIN_SECRET;
  if (!ADMIN_SECRET || req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Server misconfigured' });

  try {
    const [installations, licenses] = await Promise.all([
      db(SUPABASE_URL, SUPABASE_KEY, 'installations?select=*&order=last_seen_at.desc'),
      db(SUPABASE_URL, SUPABASE_KEY, 'licenses?select=*')
    ]);

    const licenseMap = {};
    for (const lic of Array.isArray(licenses) ? licenses : []) {
      licenseMap[`${lic.owner_id}:${lic.owner_type}:${lic.product}`] = lic;
    }

    const merged = (Array.isArray(installations) ? installations : []).map((row) => {
      const lic = licenseMap[`${row.owner_id}:${row.owner_type}:${row.product}`];
      return {
        ...row,
        job_id: undefined,
        license_status: cleanString(lic?.status, 20) || 'unknown',
        expires_at: lic?.expires_at || null,
        universe_id_bound: lic?.universe_id || null
      };
    });

    return res.status(200).json({ installations: merged });
  } catch (error) {
    console.error('[installations]', error.message);
    return res.status(502).json({ error: 'Database gagal merespons' });
  }
}
