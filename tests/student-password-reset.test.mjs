import test from 'node:test';
import assert from 'node:assert/strict';
import {localBackend} from '../backend/local.mjs';

test('student password reset is principal-only, returns a new credential once and preserves published results',async t=>{
 const {db,handler}=await localBackend({password:'Synthetic-Password-Reset-2026',fastHash:true});let principal,studentId,admin,clerk;
 const request=async(path,{method='GET',body,token=principal}={})=>{
  const response=await handler(new Request('http://127.0.0.1:8080'+path,{method,headers:{'Content-Type':'application/json',...(token?{'X-Admission-Token':token}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  return {status:response.status,data:await response.json(),cache:response.headers.get('Cache-Control')};
 };
 const reset=(version,token=principal)=>request('/api/admin/students/'+studentId+'/password',{method:'PUT',body:{version},token});
 try{
  principal=(await request('/api/login',{method:'POST',body:{username:'Admi2026',password:'Synthetic-Password-Reset-2026'},token:''})).data.token;
  for(const [username,role] of [['reset-admin','admin'],['reset-clerk','digitador']]){
   await request('/api/admin/users',{method:'POST',body:{username,display_name:'Usuario de prueba',role,password:'Synthetic-Password-Reset-2026'}});
   const token=(await request('/api/login',{method:'POST',body:{username,password:'Synthetic-Password-Reset-2026'},token:''})).data.token;if(role==='admin')admin=token;else clerk=token;
  }
  studentId=(await request('/api/admin/students',{method:'POST',body:{identification:'RESET-QA',first_name:'Estudiante',last_name1:'Prueba',last_name2:'Datos',password:'AB12CD',accommodation:'ACS'}})).data.id;
  const keys=(await db.query('select admission_private.grade_keys() keys')).rows[0].keys;
  await db.query("update admission_private.students set grades=$1,exam=75,decision='ADMITIDO',exam_date='2026-10-27',exam_block=1 where id=$2",[Object.fromEntries(keys.map(k=>[k,'80'])),studentId]);
  await db.exec("update admission_private.config set data=data||'{\"published\":\"1\",\"cut_valid\":true,\"publication_at\":\"2020-01-01T00:00:00-06:00\"}'::jsonb where id=1");
  await t.test('unauthenticated, admin and digitador requests cannot reset or read credentials',async()=>{
   for(const [token,status] of [['',401],[admin,403],[clerk,403]]){const denied=await reset(0,token);assert.equal(denied.status,status);assert.equal(denied.data.password,undefined);}
   assert.equal((await request('/api/admin/students/'+studentId+'/password')).status,405);
   for(const version of [undefined,null,'0',-1,0.5])assert.equal((await reset(version)).status,400);
   assert.equal((await reset(999)).status,409);
   assert.equal((await db.query('select version from admission_private.students where id=$1',[studentId])).rows[0].version,0);
  });
  let password;
  const storedState=async()=>(await db.query("select to_jsonb(s)-array['password_hash','version','updated_at','updated_by'] data from admission_private.students s where id=$1",[studentId])).rows[0].data;
  await t.test('principal reset changes only credential metadata and both versions of the password are checked by public consultation',async()=>{
   const before=await storedState(),config=(await request('/api/admin/config')).data;
   const result=await reset(0);assert.equal(result.status,200);assert.equal(result.cache,'no-store');assert.equal(result.data.ok,true);assert.equal(result.data.id,studentId);assert.equal(result.data.version,1);password=result.data.password;
   assert.match(password,/^[A-HJ-NP-Z2-9]{6}$/);assert.notEqual(password,'AB12CD');assert.deepEqual(await storedState(),before);assert.deepEqual((await request('/api/admin/config')).data,config);
   assert.equal((await request('/api/public/status',{token:''})).data.available,true);
   const consult=async p=>request('/api/public/result',{method:'POST',body:{identification:'RESET-QA',password:p},token:''});
   assert.equal((await consult('AB12CD')).status,401);const current=await consult(password);assert.equal(current.status,200);assert.equal(current.data.final_score,'78.0000');assert.equal(current.data.status,'ADMITIDO');
   assert.equal((await reset(0)).status,409);assert.equal((await consult(password)).status,200);
  });
  await t.test('later reads, reports, backups and audit never disclose the generated password and a second reset revokes it',async()=>{
   for(const path of ['/api/admin/students','/api/admin/students/'+studentId+'/academic','/api/admin/report','/api/admin/exam-schedule','/api/admin/audit']){
    const result=await request(path);assert.equal(result.status,200);assert.equal(JSON.stringify(result.data).includes(password),false,path);assert.equal(JSON.stringify(result.data).includes('password_hash'),false,path);
   }
   const snapshot=(await db.query("select strpos(admission_private.snapshot()::text,$1)>0 plaintext_present",[password])).rows[0];assert.equal(snapshot.plaintext_present,false);
   const hash=(await db.query('select password_hash from admission_private.students where id=$1',[studentId])).rows[0].password_hash;assert.match(hash,/^\$2[aby]\$/);assert.notEqual(hash,password);
   const audit=(await request('/api/admin/audit')).data.rows.filter(r=>r.action==='CONTRASENA_ESTUDIANTE_RESTABLECIDA');assert.equal(audit.length,1);assert.equal(audit[0].student_id,studentId);assert.deepEqual(audit[0].detail_json,{});
   const second=await reset(1);assert.equal(second.status,200);assert.equal(second.data.version,2);assert.notEqual(second.data.password,password);
   const old=await request('/api/public/result',{method:'POST',body:{identification:'RESET-QA',password},token:''});assert.equal(old.status,401);
   const updated=await request('/api/public/result',{method:'POST',body:{identification:'RESET-QA',password:second.data.password},token:''});assert.equal(updated.status,200);assert.equal(updated.data.final_score,'78.0000');
   assert.equal((await request('/api/admin/config')).data.cut_valid,true);
  });
 }finally{await db.close();}
});
