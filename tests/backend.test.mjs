import test from 'node:test';
import assert from 'node:assert/strict';
import {localBackend} from '../backend/local.mjs';
import {createHandler} from '../supabase/functions/admission/index.ts';
const password='TestsOnly-NotProduction-2027';
let db,handler,principal,digitador,second,studentId,backup;
async function request(path,{method='GET',body,token=principal}={}){
 const res=await handler(new Request('http://127.0.0.1:8080'+path,{method,headers:{'Content-Type':'application/json',...(token?{'X-Admission-Token':token}:{})},...(body?{body:JSON.stringify(body)}:{})}));
 return {status:res.status,...await res.json(),httpStatus:res.status};
}
const post=(p,b,t)=>request(p,{method:'POST',body:b,token:t});
const put=(p,b,t)=>request(p,{method:'PUT',body:b,token:t});
const keys=['g4_math','g4_science','g4_spanish','g4_social','g4_conduct','g5_math','g5_science','g5_spanish','g5_social','g5_conduct','g6_math','g6_science','g6_spanish','g6_social','g6_conduct'];
const grades=v=>Object.fromEntries(keys.map(k=>[k,v]));
async function student(id,name,avg,exam){
 const created=await post('/api/admin/students',{identification:id,first_name:name,last_name1:'Prueba',last_name2:'',password:'AB12CD'});
 assert.equal(created.status,200,created.error);const sid=created.id;
 if(avg!==undefined){assert.equal((await post('/api/admin/locks/acquire',{student_id:sid})).status,200);
 assert.equal((await put(`/api/admin/students/${sid}/grades`,{version:0,grades:grades(avg)})).status,200);
 assert.equal((await put(`/api/admin/students/${sid}/exam`,{version:1,score:exam})).status,200);}
 return sid;
}
test('admissions backend, transactions and permissions',async t=>{
 ({db,handler}=await localBackend({password,fastHash:true}));
 try{
 await t.test('private tables, RLS, login, roles and CORS',async()=>{
  const anon=(await db.query("select has_function_privilege('anon','public.admission_api(text,text,jsonb,text,text,text,text)','EXECUTE') as allowed")).rows[0];assert.equal(anon.allowed,false);
  const exposed=(await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='admission_private' and c.relkind='r' and not c.relrowsecurity")).rows[0];assert.equal(exposed.n,0);
  const mutable=(await db.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='admission_private' and p.proconfig is null")).rows[0];assert.equal(mutable.n,0);
  assert.equal((await request('/api/admin/students',{token:''})).status,401);
  assert.equal((await post('/api/login',{username:'Admi2026',password:'incorrect'})).status,401);
  const login=await post('/api/login',{username:'Admi2026',password});assert.equal(login.status,200);principal=login.token;
  second=(await post('/api/login',{username:'Admi2026',password})).token;
  assert.equal((await post('/api/admin/users',{username:'digitador',display_name:'Digitador de prueba',password,role:'digitador'})).status,200);
  digitador=(await post('/api/login',{username:'digitador',password})).token;
  for(const path of ['/api/admin/users','/api/admin/backup/create','/api/admin/cutoff/apply','/api/admin/config']){
   assert.equal((await request(path,{method:'POST',body:{},token:digitador})).status,403);
  }
  const denied=await handler(new Request('http://127.0.0.1:8080/api/public/status',{headers:{Origin:'https://evil.example'}}));assert.equal(denied.status,403);
  await db.exec('set role service_role;');
  assert.equal((await db.query("select public.admission_api('GET','/api/public/status') as result")).rows[0].result.cycle_year,'2027');
  await db.exec('reset role;');
 });
 await t.test('four decimal calculation and strict validation',async()=>{
  studentId=await student('0007','Cálculo', '86.2147','82.7500');
  const d=await request(`/api/admin/students/${studentId}/academic`);
  assert.equal(d.result.academic_avg,'86.2147');assert.equal(d.result.academic_component,'51.7288');
  assert.equal(d.result.exam_component,'33.1000');assert.equal(d.result.final_score,'84.8288');
  assert.equal((await put(`/api/admin/students/${studentId}/exam`,{version:d.version,score:'100.0001'})).status,400);
  assert.equal((await put(`/api/admin/students/${studentId}/exam`,{version:d.version,score:'NaN'})).status,400);
 });
 await t.test('exclusive lock per session, stale write, partial grades and zero',async()=>{
  assert.equal((await post('/api/admin/locks/acquire',{student_id:studentId})).status,200);
  assert.equal((await post('/api/admin/locks/acquire',{student_id:studentId},second)).status,409);
  const other=await student('0008','Otro');assert.equal((await post('/api/admin/locks/acquire',{student_id:other},second)).status,200);
  assert.equal((await put(`/api/admin/students/${studentId}/grades`,{version:0,grades:grades('90')})).status,409);
  const d=await request(`/api/admin/students/${studentId}/academic`);
  const partial=grades(null);partial.g4_math='0';
  assert.equal((await put(`/api/admin/students/${studentId}/grades`,{version:d.version,grades:partial})).status,200);
  const saved=await request(`/api/admin/students/${studentId}/academic`);assert.equal(saved.grades.g4_math,'0.0000');assert.equal(saved.grades.g4_science,null);assert.equal(saved.result.final_score,null);
  assert.equal((await put(`/api/admin/students/${studentId}/grades`,{version:saved.version,grades:grades('90')})).status,409);
  await post('/api/admin/locks/acquire',{student_id:studentId});
  await db.query("update admission_private.locks set expires_at=now()-interval '1 minute' where student_id=$1",[studentId]);
  assert.equal((await post('/api/admin/locks/heartbeat',{student_id:studentId})).status,409);
 });
 await t.test('boundary ties, manual selection, all, renunciation and publication',async()=>{
  const a=await student('A','Ana','90','90'),b=await student('B','Beatriz','90','90'),c=await student('C','Carlos','80','80');
  let cut=await post('/api/admin/cutoff/apply',{slots:1});assert.equal(cut.tie.group.length,2);assert.equal(cut.tie.remaining,1);
  await put('/api/admin/config',{publication_at:'2027-01-01T12:00:00-06:00',published:true,admitted_instructions:'Matrícula',not_admitted_message:'Gracias'});
  assert.equal((await request('/api/public/status',{token:''})).available,false);
  assert.equal((await post('/api/admin/cutoff/resolve',{strategy:'manual',selected_ids:[a],justification:''})).status,400);
  assert.equal((await post('/api/admin/cutoff/resolve',{strategy:'manual',selected_ids:[c],justification:'Prueba selección'})).status,400);
  assert.equal((await post('/api/admin/cutoff/resolve',{strategy:'manual',selected_ids:[b],justification:'Decisión de prueba'})).status,200);
  let ranking=await request('/api/admin/ranking');assert.equal(ranking.rows.find(r=>r.id===b).status,'ADMITIDO');assert.equal(ranking.rows.find(r=>r.id===a).status,'NO_ADMITIDO');
  await post('/api/admin/cutoff/apply',{slots:1});await post('/api/admin/cutoff/resolve',{strategy:'all',justification:'Se amplía cupo'});
  ranking=await request('/api/admin/ranking');assert.equal(ranking.rows.filter(r=>r.status==='ADMITIDO').length,2);
  await post('/api/admin/cutoff/apply',{slots:1});await post('/api/admin/cutoff/resolve',{strategy:'alphabetical'});
  assert.equal((await put(`/api/admin/results/${a}/status`,{status:'RENUNCIO',reason:'Renuncia de prueba'})).status,200);
  ranking=await request('/api/admin/ranking');assert.equal(ranking.rows.find(r=>r.id===b).status,'ADMITIDO');assert.equal(ranking.rows.find(r=>r.id===a).status,'RENUNCIO');
  await put('/api/admin/config',{publication_at:'2020-01-01T00:00:00-06:00',published:true,admitted_instructions:'Texto <script>alert(1)</script>',not_admitted_message:'Gracias'});
  const own=await post('/api/public/result',{identification:'B',password:'AB12CD'},'');assert.equal(own.httpStatus,200);assert.equal(own.name,'Beatriz Prueba');assert.equal(own.status,'ADMITIDO');assert.equal(own.final_score,'90.0000');assert.equal(own.rows,undefined);
  assert.deepEqual(Object.keys(own).sort(),['final_score','httpStatus','instructions','name','status']);
  const notAdmitted=await post('/api/public/result',{identification:'C',password:'AB12CD'},'');assert.equal(notAdmitted.status,'NO_ADMITIDO');assert.equal(notAdmitted.final_score,'80.0000');
  const resigned=await post('/api/public/result',{identification:'A',password:'AB12CD'},'');assert.equal(resigned.status,'RENUNCIO');assert.equal(resigned.final_score,null);
  const wrong=await post('/api/public/result',{identification:'B',password:'WRONG1'},'');assert.equal(wrong.status,401);
  assert.equal((await post('/api/public/result',{identification:'UNKNOWN',password:'WRONG1'},'')).error,wrong.error);
 });
 await t.test('XLSX preview validation, duplicate protection and hashed imports',async()=>{
  const headers=['identificacion','nombre','apellido1','apellido2','contrasena'];
  const row=(id)=>({identificacion:id,nombre:'Importado',apellido1:'Prueba',apellido2:'',contrasena:'ZZ12AA'});
  const result=await post('/api/admin/import/preview',{headers,rows:[row('0099'),row('0099'),row('B'),row(123)]});
  assert.equal(result.status,200,result.error);assert.equal(result.summary.ok,1);assert.equal(result.summary.duplicates,2);assert.equal(result.summary.errors,3);
  assert.equal(JSON.stringify(result).includes('ZZ12AA'),false);
  const confirmed=await post('/api/admin/import/confirm',{token:result.token});assert.equal(confirmed.inserted,1);assert.ok(confirmed.backup.id);
  assert.equal((await post('/api/admin/import/confirm',{token:result.token})).status,400);
  const hash=(await db.query("select password_hash from admission_private.students where identification='0099'")).rows[0].password_hash;assert.ok(hash.startsWith('$2'));assert.notEqual(hash,'ZZ12AA');
 });
 await t.test('encrypted backups, restore preview, integrity, transaction rollback and annual reset',async()=>{
  backup=await post('/api/admin/backup/create',{});assert.equal(backup.status,200);
  const zip=await request('/api/admin/backup/download?id='+backup.id);assert.equal(zip.manifest.encrypted,true);assert.equal(zip.payload.includes('Beatriz'),false);
  const preview=await post('/api/admin/restore/preview',{payload:zip.payload,sha256:zip.manifest.sha256});assert.equal(preview.status,200);assert.equal(preview.cycle_year,'2027');
  const before=(await request('/api/admin/stats')).registered;
  assert.equal((await post('/api/admin/restore',{payload:zip.payload+'bad',sha256:zip.manifest.sha256,confirmation:'RESTAURAR'})).status,400);assert.equal((await request('/api/admin/stats')).registered,before);
  const reset={new_year:'2028',slots:'120',publication_at:'2027-12-01T08:00:00-06:00',admitted_instructions:'Proceso 2028',confirmation:'REINICIAR 2027'};
  assert.equal((await post('/api/admin/reset-cycle',{...reset,confirmation:'wrong'})).status,400);
  const complete=await post('/api/admin/reset-cycle',reset);assert.equal(complete.status,200,complete.error);assert.equal((await request('/api/admin/stats')).registered,0);
  const restored=await post('/api/admin/restore',{payload:zip.payload,sha256:zip.manifest.sha256,confirmation:'RESTAURAR'});assert.equal(restored.status,200,restored.error);
  assert.equal((await request('/api/session')).authenticated,false);
  principal=(await post('/api/login',{username:'Admi2026',password})).token;
  assert.equal((await request('/api/admin/stats')).registered,before);assert.equal((await request('/api/admin/config')).cycle_year,'2027');
  assert.ok((await request('/api/admin/backups')).rows.some(b=>b.label==='prerestauracion'));
  const logs=await request('/api/admin/audit');assert.equal(JSON.stringify(logs).includes(password),false);assert.equal(JSON.stringify(logs).includes('AB12CD'),false);
 });
 await t.test('rate limit survives sessions and uses account as well as address',async()=>{
  let last;for(let i=0;i<32;i++)last=await post('/api/login',{username:'unrecognized-account',password:'incorrect'},'');assert.equal(last.status,429);
 });
 }finally{await db.close();}
});
