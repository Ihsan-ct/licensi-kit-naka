import { clientIp, db, issueToken, setCors } from './_lib/admin.js';
const buckets = globalThis.__nakaLoginBuckets || new Map(); globalThis.__nakaLoginBuckets = buckets;
function limited(ip) { const now=Date.now(), x=buckets.get(ip); if(!x||now>x.reset){buckets.set(ip,{n:1,reset:now+900000});return false} x.n++; return x.n>8; }
export default async function handler(req,res){
  setCors(req,res); if(req.method==='OPTIONS') return res.status(204).end(); if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const ip=clientIp(req); if(limited(ip)) return res.status(429).json({error:'Terlalu banyak percobaan login'});
  const supplied=String(req.body?.secret||''), expected=process.env.ADMIN_SECRET||'';
  if(!expected||supplied!==expected){ try{await db('admin_audit_logs',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({action:'LOGIN_FAILED',admin_ip:ip,user_agent:String(req.headers['user-agent']||'').slice(0,300)})})}catch{} return res.status(401).json({error:'Secret admin salah'}); }
  const token=await issueToken();
  try{await db('admin_audit_logs',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({action:'LOGIN_SUCCESS',admin_ip:ip,user_agent:String(req.headers['user-agent']||'').slice(0,300)})})}catch{}
  return res.status(200).json({token,expiresIn:28800});
}
