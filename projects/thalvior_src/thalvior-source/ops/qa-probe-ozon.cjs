// 一次性诊断：解密 shop_auths.credentials_enc，只读探测 Ozon Seller API，仅输出状态与错误摘要
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const env = Object.fromEntries(fs.readFileSync('/opt/thalvior-source/.env','utf8')
  .split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.split('=')[0], l.split('=').slice(1).join('=')]));
const SUPABASE_URL = process.env.SUPABASE_URL || env.VITE_SUPABASE_URL && 'https://thalvior.icu';
const KEY = process.env.SERVICE_ROLE_KEY;
async function main(){
  const db = createClient('https://thalvior.icu', KEY, { auth: { persistSession: false } });
  const { data: rows, error } = await db.from('shop_auths').select('id,shop_name,platform,status,credentials_enc')
    .ilike('platform','ozon');
  if (error) { console.log('DB 读取失败', error.message); return; }
  const secret = process.env.JWT_SECRET;
  const salt = Buffer.from('thalvior-cred-v1','utf8');
  for (const r of rows) {
    if (!r.credentials_enc) { console.log(`${r.shop_name}: 无凭据`); continue; }
    let creds = null, decErr = '';
    try {
      const buf = Buffer.from(r.credentials_enc, 'base64');
      const iv = buf.subarray(0,12), tag = buf.subarray(buf.length-16), ct = buf.subarray(12, buf.length-16);
      const key = crypto.pbkdf2Sync(secret, salt, 100000, 32, 'sha256');
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
      creds = JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
    } catch(e){ decErr = e.message; }
    const keys = creds ? Object.keys(creds) : [];
    const cid = creds ? String(creds.client_id ?? creds.clientId ?? '') : '';
    const ak  = creds ? String(creds.api_key ?? creds.apiKey ?? '') : '';
    console.log(`${r.shop_name} [${r.status}] 解密=${decErr?('失败:'+decErr.slice(0,60)):'ok'} 字段=${keys.join(',')} client_id长度=${cid.length} api_key长度=${ak.length}`);
    if (!cid || !ak) { console.log('  → 凭据里没有可用的 Client-Id / Api-Key'); continue; }
    for (const [name, path, body] of [
      ['finance/transaction/list','/v3/finance/transaction/list',{filters:{date:{from:new Date(Date.now()-7*864e5).toISOString(),to:new Date().toISOString()}},limit:10,page:1,last_id:0}],
      ['warehouse/list','/v1/warehouse/list',{}],
      ['orders/list','/v3/orders/list',{filter:{since:new Date(Date.now()-30*864e5).toISOString().slice(0,10),to_to:new Date().toISOString().slice(0,10)},limit:10,offset:0}],
      ['posting/fbo/list','/v3/posting/fbo/list',{filter:{since:new Date(Date.now()-30*864e5).toISOString().slice(0,10),to_to:new Date().toISOString().slice(0,10)},limit:10,offset:0}],
      ['product/list','/v3/product/list',{filter:{visibility:'ALL'},limit:10}],
    ]) {
      try {
        const res = await fetch('https://api-seller.ozon.ru'+path, { method:'POST',
          headers:{'Client-Id':cid,'Api-Key':ak,'Content-Type':'application/json','Accept-Encoding':'identity'},
          body: JSON.stringify(body) });
        const txt = await res.text();
        let msg = ''; try { const j = JSON.parse(txt); msg = (j.message || j.error || (j.result&&'有 result')) + ''; } catch { msg = txt.slice(0,80); }
        const nres = (()=>{ try { const j = JSON.parse(txt); const r = j.result; if (Array.isArray(r)) return r.length; if (r && (r.postings||r.items||r.operations||r.warehouses)) return (r.postings||r.items||r.operations||r.warehouses).length; } catch{} return '-'; })();
        console.log(`  ${name.padEnd(28)} HTTP ${res.status} 条目=${nres} message=${msg.slice(0,90)}`);
      } catch(e){ console.log(`  ${name.padEnd(28)} 请求异常 ${e.message.slice(0,70)}`); }
    }
  }
}
main();
