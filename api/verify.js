export default async function handler(req, res) {
  // Allow CORS agar browser bisa akses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ownerId, ownerType, product } = req.body || {};

  if (!ownerId) {
    return res.status(400).json({ valid: false, message: 'Owner ID wajib diisi' });
  }

  SUPABASE_URL=https://zwpypvyllybsxigqwrzd.supabase.co
SUPABASE_KEY=sb_secret_bN-fcEa6oGgdQguBzkt0Nw_MWCHfkZl
LICENSE_SECRET=5e840ff9654edce4decbe3b802e283162f6cc0009b0c66d10dccd928351879ab

  try {
    // Cek lisensi ke Supabase
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

    // Jika data ditemukan dan lisensi aktif
    if (Array.isArray(data) && data.length > 0) {
      const license = data[0];
      return res.status(200).json({
        valid: true,
        ownerId: ownerId,
        ownerType: ownerType,
        product: product,
        status: "ACTIVE"
      });
    }

    // Jika lisensi tidak ditemukan
    return res.status(200).json({
      valid: false,
      message: "Lisensi tidak terdaftar atau tidak aktif"
    });

  } catch (err) {
    return res.status(500).json({ valid: false, error: err.message });
  }
}
