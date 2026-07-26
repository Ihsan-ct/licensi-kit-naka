const enc = new TextEncoder();
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const unb64u = (text) => Buffer.from(text, 'base64url');

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

export function setCors(req, res) {
  const allowed = process.env.ADMIN_ORIGIN;
  const origin = req.headers.origin;
  if (allowed && origin === allowed) { res.setHeader('Access-Control-Allow-Origin', allowed); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}

async function hmac(data) {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET belum dikonfigurasi');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function issueToken(ttlSeconds = 28800) {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({ sub: 'admin', iat: now, exp: now + ttlSeconds, jti: crypto.randomUUID() }));
  const sig = b64u(await hmac(payload));
  return `${payload}.${sig}`;
}

export async function requireAdmin(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('Sesi admin diperlukan'), { status: 401 });
  const token = auth.slice(7);
  const [payload, sig] = token.split('.');
  if (!payload || !sig) throw Object.assign(new Error('Token tidak valid'), { status: 401 });
  const expected = await hmac(payload);
  const actual = unb64u(sig);
  const a = new Uint8Array(actual), b = expected;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a[i] ^ b[i];
  if (diff) throw Object.assign(new Error('Token tidak valid'), { status: 401 });
  const data = JSON.parse(unb64u(payload).toString('utf8'));
  if (data.exp <= Math.floor(Date.now() / 1000)) throw Object.assign(new Error('Sesi telah berakhir'), { status: 401 });
  return data;
}

export async function db(path, options = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!base || !key) throw new Error('SUPABASE_URL/SUPABASE_KEY belum dikonfigurasi');
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

export async function audit(req, action, target = null, before = null, after = null, meta = null) {
  try {
    await db('audit_logs', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ action, target_type: 'license', target_id: target, before_data: before, after_data: after, metadata: meta, actor_ip: clientIp(req) })
    });
  } catch (error) { console.warn('[audit]', error.message); }
}

export const clean = (v, max = 120) => v == null ? null : String(v).trim().slice(0, max);
export const validId = (v) => { const s = clean(v, 30); return s && /^\d+$/.test(s) && s !== '0' ? s : null; };
export async function sha256(text) { const d = await crypto.subtle.digest('SHA-256', enc.encode(text)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }
