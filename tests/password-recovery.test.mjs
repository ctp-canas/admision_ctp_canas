import test from 'node:test';
import assert from 'node:assert/strict';
import {localBackend} from '../backend/local.mjs';
const password='OriginalSynthetic-2027', email='admin-recovery@example.test';
const authId='1593db1a-2285-4e0f-bb73-df6286b1958a';
const redirect='https://ctp-canas.github.io/admision_ctp_canas/admin-login.html?recover=1';
function token(session,method='recovery'){return ['header',Buffer.from(JSON.stringify({iss:'http://local-db/auth/v1',sub:authId,session_id:session,amr:[{method,timestamp:Math.floor(Date.now()/1000)}]})).toString('base64url'),'signature'].join('.');}
async function fixture({redirectTo=redirect,deliveryStatus=200}={}){
 let creates=0,sends=0;const valid=new Set();
 const authFetch=async(url,options)=>{
  if(url.endsWith('/admin/users')){creates++;const b=JSON.parse(options.body);assert.equal(b.email,email);assert.equal(b.email_confirm,true);assert.match(b.password,/^[a-f0-9]{64}$/);return Response.json({id:authId});}
  if(url.endsWith('/admin/generate_link'))return Response.json({action_link:'https://synthetic.supabase.co/auth/v1/verify?token=PRIVATE&type=recovery&redirect_to='+encodeURIComponent(redirectTo)});
  if(url.includes('/recover?')){sends++;return Response.json({}, {status:deliveryStatus});}
  if(url.endsWith('/user'))return valid.has(options.headers.Authorization?.slice(7))?Response.json({id:authId,email,email_confirmed_at:'2026-01-01T00:00:00Z'}):Response.json({}, {status:401});
  if(url.includes('/logout?'))return new Response(null,{status:204});
  throw new Error('Unexpected auth URL '+url);
 };
 const {db,handler}=await localBackend({password,fastHash:true,authFetch});let session='';
 const call=async(path,body,method='POST',authenticated=false)=>{const r=await handler(new Request('http://local-api/api'+path,{method,headers:{'Content-Type':'application/json',...(authenticated?{'X-Admission-Token':session}:{})},body:method==='GET'?undefined:JSON.stringify(body)}));return {status:r.status,...await r.json()};};
 session=(await call('/login',{username:'Admi2026',password})).token;
 const changed=await call('/admin/users/1/email',{email},'PUT',true);assert.equal(changed.status,200,changed.error);
 return {db,call,valid,counts:()=>({creates,sends})};
}
test('email recovery binds a private account, checks email proof, changes the password once and revokes sessions',async()=>{
 const f=await fixture();try{
  assert.equal((await f.db.query("select has_function_privilege('anon','public.admission_password_recovery(text,jsonb,text)','execute') as allowed")).rows[0].allowed,false);
  const unknown=await f.call('/password/request',{username:'unknown',email});
  const mismatch=await f.call('/password/request',{username:'Admi2026',email:'wrong@example.test'});
  assert.equal(unknown.status,200);assert.equal(unknown.message,mismatch.message);assert.deepEqual(f.counts(),{creates:0,sends:0});
  const sent=await f.call('/password/request',{username:'Admi2026',email});assert.equal(sent.status,200,sent.error);assert.equal(sent.message,unknown.message);assert.equal(sent.auth_id,undefined);assert.equal(sent.email,undefined);
  assert.deepEqual(f.counts(),{creates:1,sends:1});
  const short=await f.call('/password/reset',{recovery_token:'invalid',password:'short'});assert.equal(short.status,400);
  assert.equal((await f.call('/password/reset',{recovery_token:'header.body.signature',password:'ChangedSynthetic-2027'})).status,401);
  const notRecovery=token('29fe0af4-4e1b-4bcb-b67f-e92e8062e974','password');f.valid.add(notRecovery);
  assert.equal((await f.call('/password/reset',{recovery_token:notRecovery,password:'ChangedSynthetic-2027'})).status,401);
  const proof=token('58a69158-12f7-4fd3-9c42-d6f7e685b04b');f.valid.add(proof);
  const reset=await f.call('/password/reset',{recovery_token:proof,password:'ChangedSynthetic-2027'});assert.equal(reset.status,200,reset.error);
  assert.equal((await f.call('/session',undefined,'GET',true)).authenticated,false);
  assert.equal((await f.call('/login',{username:'Admi2026',password})).status,401);
  assert.equal((await f.call('/login',{username:'Admi2026',password:'ChangedSynthetic-2027'})).status,200);
  assert.equal((await f.call('/password/reset',{recovery_token:proof,password:'ReplayedSynthetic-2027'})).status,401);
  await f.call('/password/request',{username:'Admi2026',email});
  assert.equal((await f.call('/password/reset',{recovery_token:proof,password:'ReplayedSynthetic-2027'})).status,401);
  const expired=token('bd21e6a3-c046-4327-b3d5-4799d41e217e');f.valid.add(expired);
  await f.db.exec("update admission_private.password_recovery_pending set expires_at=now()-interval '1 second'");
  assert.equal((await f.call('/password/reset',{recovery_token:expired,password:'ExpiredSynthetic-2027'})).status,401);
  assert.equal((await f.call('/password/request',{username:'Admi2026',email})).status,429);
  const audit=(await f.db.query('select detail_json from admission_private.audit')).rows;
  assert.ok(!JSON.stringify(audit).includes(proof));assert.ok(!JSON.stringify(audit).includes('ChangedSynthetic-2027'));
 }finally{await f.db.close();}
});
test('a rejected redirect never sends a broken localhost link; delivery failure clears the pending request',async()=>{
 for(const config of [{redirectTo:'http://localhost:3000'},{deliveryStatus:429}]){
  const f=await fixture(config);try{
   const r=await f.call('/password/request',{username:'Admi2026',email});assert.equal(r.status,config.redirectTo?503:429);
   assert.equal(f.counts().sends,config.redirectTo?0:1);
   assert.equal((await f.db.query('select count(*) as count from admission_private.password_recovery_pending')).rows[0].count,0);
  }finally{await f.db.close();}
 }
});
