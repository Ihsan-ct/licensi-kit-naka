export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
    systemVersion
  } = req.body || {};

  if (!ownerId) {
    return res.status(400).json({ valid: false, message: 'Owner ID wajib diisi' });
  }

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_KEY  = process.env.SUPABASE_KEY;
  const TABLE_NAME    = "licenses";
  const INSTALL_TABLE = "installations";

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[verify] Missing required env vars (SUPABASE_URL/SUPABASE_KEY)');
    return res.status(500).json({ valid: false, message: 'Server misconfigured' });
  }

  // TIDAK ADA pengecekan secret dari client -- secret hanya boleh hidup di
  // server ini (env var), tidak pernah dikirim ke/oleh script Luau yang
  // dijual. Keamanan didasarkan pada game.CreatorId (data resmi Roblox,
  // tidak bisa dipalsukan client) yang dicocokkan ke database kamu.
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE_NAME}?owner_id=eq.${ownerId}&owner_type=eq.${ownerType || 'User'}&product=eq.${product || 'kit-naka'}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(200).json({ valid: false, message: "Lisensi tidak terdaftar atau tidak aktif" });
    }

    const item = data[0];
    const isActive = (item.status || '').toLowerCase() === 'active';
    const notExpired = !item.expires_at || new Date(item.expires_at) > new Date();

    if (!isActive || !notExpired) {
      return res.status(200).json({ valid: false, message: "Lisensi tidak terdaftar atau tidak aktif" });
    }

    // Monitoring instalasi -- best-effort, tidak boleh menggagalkan validasi utama.
    try {
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
          body: JSON.stringify({
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
          })
        }
      );
    } catch (monitorErr) {
      console.error('[verify] Monitoring upsert failed (non-fatal):', monitorErr.message);
    }

    return res.status(200).json({
      valid: true,
      ownerId,
      ownerType: ownerType || 'User',
      product: product || 'kit-naka',
      status: item.status || "active"
    });
  } catch (err) {
    return res.status(500).json({ valid: false, error: err.message });
  }
}
