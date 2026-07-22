export default async function handler(req, res) {
  // Allow CORS agar browser bisa mengakses API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-license-secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ownerId, ownerType, product, secret } = req.body || {};

  if (!ownerId) {
    return res.status(400).json({ valid: false, message: 'Owner ID wajib diisi' });
  }

  // 🌐 Supabase & Secret Config Anda:
  const SUPABASE_URL   = "https://zwpypvyllybsxigqwrzd.supabase.co";
  const SUPABASE_KEY   = process.env.SUPABASE_KEY || "SUPABASE_KEY=sb_secret_bN-fcEa6oGgdQguBzkt0Nw_MWCHfkZl"; 
  const LICENSE_SECRET = process.env.LICENSE_SECRET || "5e840ff9654edce4decbe3b802e283162f6cc0009b0c66d10dccd928351879ab";
  const TABLE_NAME     = "licenses"; // Nama tabel lisensi di Supabase

  // Validasi Secret Key (jika dikirim oleh Script Roblox)
  const incomingSecret = req.headers['x-license-secret'] || secret;
  if (incomingSecret && incomingSecret !== LICENSE_SECRET) {
    return res.status(401).json({ valid: false, message: 'Secret Key tidak cocok' });
  }

  try {
    // Panggil Supabase REST API
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE_NAME}?owner_id=eq.${ownerId}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    const data = await response.json();

    // Jika data lisensi ditemukan
    if (Array.isArray(data) && data.length > 0) {
      const item = data[0];
      return res.status(200).json({
        valid: true,
        ownerId: ownerId,
        ownerType: ownerType || 'User',
        product: product || 'kit-naka',
        status: item.status || "ACTIVE"
      });
    }

    // Jika lisensi tidak terdaftar / tidak aktif
    return res.status(200).json({
      valid: false,
      message: "Lisensi tidak terdaftar atau tidak aktif"
    });

  } catch (err) {
    return res.status(500).json({ valid: false, error: err.message });
  }
}
