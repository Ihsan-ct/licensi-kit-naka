// GET /api/installations
// Mengembalikan daftar semua map yang pernah verify, digabung dengan status
// lisensinya. Dipanggil oleh dashboard.html -- SUPABASE_KEY tetap di server,
// tidak pernah dikirim ke browser.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  try {
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    };

    const [installRes, licenseRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/installations?select=*&order=last_seen_at.desc`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/licenses?select=*`, { headers })
    ]);

    const installations = await installRes.json();
    const licenses = await licenseRes.json();

    const licenseMap = {};
    for (const lic of licenses) {
      licenseMap[`${lic.owner_id}:${lic.owner_type}:${lic.product}`] = lic;
    }

    const merged = (Array.isArray(installations) ? installations : []).map((row) => {
      const lic = licenseMap[`${row.owner_id}:${row.owner_type}:${row.product}`];
      return {
        ...row,
        license_status: lic ? lic.status : 'unknown',
        expires_at: lic ? lic.expires_at : null
      };
    });

    return res.status(200).json({ installations: merged });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
