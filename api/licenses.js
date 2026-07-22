// /api/licenses
// GET    -> daftar semua lisensi (termasuk yang belum pernah connect sekalipun),
//           digabung dengan data instalasi terakhir kalau ada.
// POST   -> tambah lisensi baru { ownerId, ownerType, product, status, expiresAt }
// DELETE -> hapus lisensi { ownerId, ownerType, product }
//
// POST & DELETE WAJIB header x-admin-secret yang cocok dengan ADMIN_SECRET.
// Ini AMAN dipakai di sini (beda dari LICENSE_SECRET era lama) karena endpoint
// ini cuma dipanggil dari dashboard admin kamu sendiri, browser kamu -- bukan
// dari script Luau yang dijual ke pembeli. Tidak pernah ada di source yang
// didistribusikan.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const ADMIN_SECRET = process.env.ADMIN_SECRET;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  // ---------- GET: list semua lisensi + info instalasi terakhir ----------
  if (req.method === 'GET') {
    try {
      const [licRes, instRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/licenses?select=*&order=created_at.desc`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/installations?select=*&order=last_seen_at.desc`, { headers })
      ]);
      const licenses = await licRes.json();
      const installations = await instRes.json();

      // Kumpulkan SEMUA install per owner+product jadi array (bukan cuma yang
      // terakhir aktif) -- satu owner bisa pasang lisensi yang sama di banyak
      // place sekaligus (verify.js memang tidak membatasi jumlah place per
      // lisensi), jadi semuanya harus kelihatan di dashboard, bukan cuma satu.
      const instGroups = {};
      for (const inst of (Array.isArray(installations) ? installations : [])) {
        const key = `${inst.owner_id}:${inst.product}`;
        if (!instGroups[key]) instGroups[key] = [];
        instGroups[key].push(inst);
      }
      // installations sudah diurutkan last_seen_at.desc dari query, jadi tiap
      // array di instGroups otomatis juga terurut dari yang paling baru aktif.

      // Satu baris output per INSTALASI (bukan per lisensi) -- kalau owner
      // punya N place yang pasang lisensi yang sama, hasilnya N baris dengan
      // status lisensi yang sama tapi info map (place_id, player_count, dst)
      // masing-masing berbeda. Dashboard.html merender array baris apa
      // adanya tanpa dedup ulang, jadi tidak perlu ada perubahan di frontend.
      const merged = [];
      for (const lic of (Array.isArray(licenses) ? licenses : [])) {
        const insts = instGroups[`${lic.owner_id}:${lic.product}`] || [];

        const baseLicenseFields = {
          owner_id: lic.owner_id,
          owner_type: lic.owner_type,
          product: lic.product,
          status: lic.status,
          expires_at: lic.expires_at,
          created_at: lic.created_at
        };

        if (insts.length === 0) {
          // Lisensi ada tapi belum pernah connect ke place mana pun.
          merged.push({
            ...baseLicenseFields,
            place_id: null,
            universe_id: null,
            place_name: null,
            game_name: null,
            job_id: null,
            player_count: null,
            max_players: null,
            is_private_server: null,
            is_studio: null,
            system_version: null,
            first_seen_at: null,
            last_seen_at: null,
            ever_connected: false
          });
          continue;
        }

        for (const inst of insts) {
          merged.push({
            ...baseLicenseFields,
            place_id: inst.place_id ?? null,
            universe_id: inst.universe_id ?? null,
            place_name: inst.place_name ?? null,
            game_name: inst.game_name ?? null,
            job_id: inst.job_id ?? null,
            player_count: inst.player_count ?? null,
            max_players: inst.max_players ?? null,
            is_private_server: inst.is_private_server ?? null,
            is_studio: inst.is_studio ?? null,
            system_version: inst.system_version ?? null,
            first_seen_at: inst.first_seen_at ?? null,
            last_seen_at: inst.last_seen_at ?? null,
            ever_connected: true
          });
        }
      }

      return res.status(200).json({ licenses: merged });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ---------- Semua aksi di bawah ini butuh admin secret ----------
  const incomingSecret = req.headers['x-admin-secret'];
  if (!ADMIN_SECRET || incomingSecret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Admin secret tidak cocok' });
  }

  // ---------- POST: tambah lisensi baru ----------
  if (req.method === 'POST') {
    const { ownerId, ownerType, product, status, expiresAt } = req.body || {};
    if (!ownerId || !ownerType || !product) {
      return res.status(400).json({ error: 'ownerId, ownerType, product wajib diisi' });
    }
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/licenses?on_conflict=owner_id,owner_type,product`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          owner_id: ownerId,
          owner_type: ownerType,
          product,
          status: status || 'active',
          expires_at: expiresAt || null
        })
      });
      if (!resp.ok) {
        const errBody = await resp.text();
        return res.status(500).json({ error: 'Gagal simpan ke Supabase: ' + errBody });
      }
      const created = await resp.json();
      return res.status(200).json({ success: true, license: created[0] || null });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ---------- DELETE: hapus lisensi ----------
  if (req.method === 'DELETE') {
    const { ownerId, ownerType, product } = req.body || {};
    if (!ownerId || !ownerType || !product) {
      return res.status(400).json({ error: 'ownerId, ownerType, product wajib diisi' });
    }
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/licenses?owner_id=eq.${ownerId}&owner_type=eq.${ownerType}&product=eq.${product}`,
        { method: 'DELETE', headers }
      );
      if (!resp.ok) {
        const errBody = await resp.text();
        return res.status(500).json({ error: 'Gagal hapus dari Supabase: ' + errBody });
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
