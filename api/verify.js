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

  const {
    ownerId, ownerType, product,
    placeId, universeId, placeName, gameName, jobId,
    playerCount, maxPlayers, isPrivateServer, isStudio,
    systemVersion, clientTimestamp,
    secret
  } = req.body || {};

  if (!ownerId) {
    return res.status(400).json({ valid: false, message: 'Owner ID wajib diisi' });
  }

  // Config diambil murni dari environment variables. TIDAK ADA fallback
  // hardcoded -- kalau env variable belum di-set di Vercel, request gagal
  // dengan error jelas, bukan diam-diam pakai key yang nempel di source code.
  const SUPABASE_URL   = process.env.SUPABASE_URL;
  const SUPABASE_KEY   = process.env.SUPABASE_KEY;
  const LICENSE_SECRET = process.env.LICENSE_SECRET;
  const TABLE_NAME     = "licenses";
  const INSTALL_TABLE  = "installations";

  if (!SUPABASE_URL || !SUPABASE_KEY || !LICENSE_SECRET) {
    console.error('[verify] Missing required env vars (SUPABASE_URL/SUPABASE_KEY/LICENSE_SECRET)');
    return res.status(500).json({ valid: false, message: 'Server misconfigured' });
  }

  // Validasi Secret Key (kalau dikirim oleh Script Roblox).
  // PENTING: dulu ada bug -- kalau incomingSecret kosong, pengecekan
  // dilewati sepenuhnya (bisa dibypass dengan tidak kirim secret sama
  // sekali). Sekarang: kalau LICENSE_SECRET diwajibkan, secret HARUS ada
  // dan HARUS cocok -- tidak ada jalur bypass diam-diam.
  const incomingSecret = req.headers['x-license-secret'] || secret;
  if (incomingSecret !== LICENSE_SECRET) {
    return res.status(401).json({ valid: false, message: 'Secret Key tidak cocok' });
  }

  try {
    // Cek lisensi
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

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(200).json({
        valid: false,
        message: "Lisensi tidak terdaftar atau tidak aktif"
      });
    }

    const item = data[0];
    const isActive = (item.status || '').toLowerCase() === 'active';
    const notExpired = !item.expires_at || new Date(item.expires_at) > new Date();

    if (!isActive || !notExpired) {
      return res.status(200).json({
        valid: false,
        message: "Lisensi tidak terdaftar atau tidak aktif"
      });
    }

    // Monitoring instalasi (best-effort -- kegagalan di sini TIDAK BOLEH
    // menggagalkan hasil validasi lisensi, jadi dibungkus try/catch terpisah).
    try {
      const upsertBody = {
        owner_id: ownerId,
        owner_type: ownerType || 'User',
        product: product || 'kit-naka',
        place_id: placeId ?? null,
        universe_id: universeId ?? null,
        place_name: placeName ?? null,
        game_name: gameName ?? null,
        job_id: jobId ?? null,
        player_count: playerCount ?? null,
        max_players: maxPlayers ?? null,
        is_private_server: isPrivateServer ?? null,
        is_studio: isStudio ?? null,
        system_version: systemVersion ?? null,
        last_seen_at: new Date().toISOString()
      };

      await fetch(
        `${SUPABASE_URL}/rest/v1/${INSTALL_TABLE}?on_conflict=owner_id,product,place_id`,
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify(upsertBody)
        }
      );
    } catch (monitorErr) {
      console.error('[verify] Monitoring upsert failed (non-fatal):', monitorErr.message);
    }

    return res.status(200).json({
      valid: true,
      ownerId: ownerId,
      ownerType: ownerType || 'User',
      product: product || 'kit-naka',
      status: item.status || "ACTIVE"
    });
  } catch (err) {
    return res.status(500).json({ valid: false, error: err.message });
  }
}
