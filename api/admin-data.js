import { audit, clean, db, requireAdmin, setCors, sha256, validId } from './_lib/admin.js';
const num=(v,d,min=1,max=200)=>Math.min(max,Math.max(min,Number.parseInt(v||d,10)||d));
const esc=v=>encodeURIComponent(String(v));
async function safe(path,warnings,code){try{return await db(path)}catch(e){warnings.push({code,message:e.message});return[]}}
function risk(row){let s=10;const n=Number(row.attempt_count||1);s+=Math.min(35,n*3);if(Number(row.universe_count||1)>1)s+=20;if(['REVOKED','SIGNATURE_INVALID','RATE_LIMIT','UNIVERSE_MISMATCH'].includes(row.reason))s+=20;if(row.last_seen_at&&Date.now()-new Date(row.last_seen_at)<3600000)s+=15;return Math.min(100,s)}
export default async function handler(req,res){
  setCors(req,res); if(req.method==='OPTIONS')return res.status(204).end();
  try{await requireAdmin(req)}catch(e){return res.status(e.status||401).json({error:e.message})}
  try{
    if(req.method==='GET'){
      const scope=clean(req.query?.scope||'overview',30), page=num(req.query?.page,1), limit=num(req.query?.limit,25,10,100), offset=(page-1)*limit;
      const q=clean(req.query?.q||'',80), status=clean(req.query?.status||'',30), warnings=[];
      const allLic=await safe('licenses?select=*&order=created_at.desc',warnings,'LICENSES');
      const allInst=await safe('installations?select=*&order=last_seen_at.desc',warnings,'INSTALLATIONS');
      const allAttempts=await safe('access_attempts?select=*&order=attempted_at.desc&limit=2000',warnings,'ATTEMPTS');
      const audits=scope==='audit'?await safe('audit_logs?select=*&order=created_at.desc&limit=500',warnings,'AUDIT'):[];
      const products=await safe('products?select=*&order=name.asc',warnings,'PRODUCTS');
      const licKeys=new Set(allLic.map(x=>`${x.owner_id}:${x.owner_type}:${x.product}`));
      const legacy=allInst.filter(x=>!licKeys.has(`${x.owner_id}:${x.owner_type||'User'}:${x.product}`)).map(x=>({owner_id:x.owner_id,owner_type:x.owner_type||'User',product:x.product,place_id:x.place_id,universe_id:x.universe_id,place_name:x.place_name,game_name:x.game_name,system_version:x.system_version,reason:'LEGACY_NO_LICENSE',attempted_at:x.first_seen_at||x.last_seen_at,last_seen_at:x.last_seen_at,ip_address:null,user_agent:null}));
      const raw=[...allAttempts,...legacy];
      const groups=new Map();
      for(const x of raw){const k=`${x.ip_address||'unknown'}:${x.owner_id||'unknown'}:${x.reason||'UNKNOWN'}`;const g=groups.get(k)||{...x,attempt_count:0,universe_set:new Set(),first_seen_at:x.attempted_at,last_seen_at:x.attempted_at};g.attempt_count++;if(x.universe_id)g.universe_set.add(x.universe_id);if(new Date(x.attempted_at)<new Date(g.first_seen_at))g.first_seen_at=x.attempted_at;if(new Date(x.attempted_at)>new Date(g.last_seen_at))g.last_seen_at=x.attempted_at;groups.set(k,g)}
      const threats=[...groups.values()].map(g=>({...g,universe_count:g.universe_set.size,risk_score:risk(g),universe_set:undefined})).sort((a,b)=>b.risk_score-a.risk_score||new Date(b.last_seen_at)-new Date(a.last_seen_at));
      const latestByLicense=new Map();for(const i of allInst){const k=`${i.owner_id}:${i.owner_type||'User'}:${i.product}`;if(!latestByLicense.has(k))latestByLicense.set(k,i)}
      let licenses=allLic.map(l=>({...l,latest_installation:latestByLicense.get(`${l.owner_id}:${l.owner_type}:${l.product}`)||null}));
      const match=x=>!q||JSON.stringify(x).toLowerCase().includes(q.toLowerCase());
      if(status) licenses=licenses.filter(x=>x.status===status);licenses=licenses.filter(match);
      let rows=scope==='licenses'?licenses:scope==='installations'?allInst.filter(match):scope==='illegal-raw'?raw.filter(match):scope==='illegal'?threats.filter(match):scope==='audit'?audits.filter(match):scope==='products'?products.filter(match):[];
      const total=rows.length;rows=rows.slice(offset,offset+limit);
      const active=allLic.filter(x=>x.status==='active').length, online=allInst.filter(x=>x.last_seen_at&&Date.now()-new Date(x.last_seen_at)<120000).length;
      const notifications=[...threats.filter(x=>x.risk_score>=70).slice(0,8).map(x=>({level:'critical',title:x.reason,detail:`Owner ${x.owner_id||'unknown'} · ${x.attempt_count} attempts`,time:x.last_seen_at})),...allLic.filter(x=>x.expires_at&&new Date(x.expires_at)-Date.now()<604800000&&new Date(x.expires_at)>Date.now()).slice(0,5).map(x=>({level:'warning',title:'License expiring',detail:`${x.owner_id} · ${x.product}`,time:x.expires_at}))];
      return res.status(200).json({scope,rows,pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))},summary:{licenses:allLic.length,active,online,installations:allInst.length,illegal:raw.length,threats:threats.length,critical:threats.filter(x=>x.risk_score>=70).length,products:products.length},notifications,warnings});
    }
    const b=req.body||{}, action=clean(b.action,40);
    if(req.method==='POST'&&action==='create-license'){
      const ownerId=validId(b.ownerId), ownerType=['User','Group'].includes(b.ownerType)?b.ownerType:null, product=clean(b.product,50), key=clean(b.licenseKey,200)||`NAKA-${crypto.randomUUID().replaceAll('-','').toUpperCase()}`;if(!ownerId||!ownerType||!product)return res.status(400).json({error:'Data lisensi tidak valid'});
      const row={owner_id:ownerId,owner_type:ownerType,product,status:'active',universe_id:b.universeId?validId(b.universeId):null,expires_at:b.expiresAt||null,license_key_hash:await sha256(key)};
      const created=await db('licenses?on_conflict=owner_id,owner_type,product',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(row)});await audit(req,'LICENSE_CREATED',`${ownerType}:${ownerId}:${product}`,null,created?.[0]||row);return res.json({success:true});
    }
    if(req.method==='POST'&&action==='license-action'){
      const ownerId=validId(b.ownerId), ownerType=['User','Group'].includes(b.ownerType)?b.ownerType:null, product=clean(b.product,50);if(!ownerId||!ownerType||!product)return res.status(400).json({error:'Target tidak valid'});
      const query=`licenses?owner_id=eq.${esc(ownerId)}&owner_type=eq.${esc(ownerType)}&product=eq.${esc(product)}`;const before=await db(`${query}&select=*`);const patch={};if(['active','pending','suspended','revoked','compromised'].includes(b.status))patch.status=b.status;if(b.resetUniverse){patch.universe_id=null;patch.activated_at=null}if(b.licenseKey)patch.license_key_hash=await sha256(clean(b.licenseKey,200));if(!Object.keys(patch).length)return res.status(400).json({error:'Tidak ada perubahan'});const after=await db(query,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});await audit(req,'LICENSE_UPDATED',`${ownerType}:${ownerId}:${product}`,before?.[0],after?.[0],{operation:b.operation||null});return res.json({success:true});
    }
    if(req.method==='POST'&&action==='upsert-product'){
      const code=clean(b.code,40),name=clean(b.name,80),latest=clean(b.latestVersion,30),minimum=clean(b.minimumVersion,30),policy=['allow','warn','block'].includes(b.policy)?b.policy:'warn';if(!code||!name)return res.status(400).json({error:'Kode dan nama produk wajib'});const row={code,name,latest_version:latest,minimum_version:minimum,version_policy:policy,maintenance:Boolean(b.maintenance)};const out=await db('products?on_conflict=code',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(row)});await audit(req,'PRODUCT_UPSERT',code,null,out?.[0]||row);return res.json({success:true});
    }
    return res.status(405).json({error:'Method/action tidak didukung'});
  }catch(e){console.error('[admin-data]',e);return res.status(502).json({error:'Operasi dashboard gagal',detail:e.message})}
}
