import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {localBackend} from '../backend/local.mjs';

test('existing previews retain records and return each applicant final score after upgrade',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'admission-score-upgrade-'));
 const persist=path.join(temp,'db'),password='ScoreUpgradeTests-2027';
 let db,handler,token;
 const request=async(url,{method='GET',body,authenticated=true}={})=>{
  const response=await handler(new Request('http://127.0.0.1:8080'+url,{method,headers:{'Content-Type':'application/json',...(authenticated&&token?{'X-Admission-Token':token}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  return {httpStatus:response.status,...await response.json()};
 };
 const post=(url,body,authenticated=true)=>request(url,{method:'POST',body,authenticated});
 try{
  ({db,handler}=await localBackend({persist,password,fastHash:true}));
  token=(await post('/api/login',{username:'Admi2026',password},false)).token;
  const keys=(await db.query('select admission_private.grade_keys() as keys')).rows[0].keys;
  for(const [identification,avg,exam] of [['SCORE-ZERO','0','0'],['SCORE-MAX','100','100'],['SCORE-WEIGHTED','90.3456','80.0188']]){
   const created=await post('/api/admin/students',{identification,first_name:identification,last_name1:'Prueba',last_name2:'',password:'AB12CD'});
   assert.equal(created.httpStatus,200,created.error);
   await post('/api/admin/locks/acquire',{student_id:created.id});
   assert.equal((await request(`/api/admin/students/${created.id}/grades`,{method:'PUT',body:{version:0,grades:Object.fromEntries(keys.map(key=>[key,avg]))}})).httpStatus,200);
   assert.equal((await request(`/api/admin/students/${created.id}/exam`,{method:'PUT',body:{version:1,score:exam}})).httpStatus,200);
  }
  assert.equal((await post('/api/admin/cutoff/apply',{slots:2})).httpStatus,200);
  await request('/api/admin/config',{method:'PUT',body:{publication_at:'2099-01-01T00:00:00-06:00',published:true,admitted_instructions:'Matrícula',not_admitted_message:'Gracias por participar'}});
  const future=await post('/api/public/result',{identification:'SCORE-MAX',password:'AB12CD'},false);
  assert.equal(future.httpStatus,403);assert.equal(future.final_score,undefined);
  await request('/api/admin/config',{method:'PUT',body:{publication_at:'2020-01-01T00:00:00-06:00',published:true,admitted_instructions:'Matrícula',not_admitted_message:'Gracias por participar'}});
  // Recreate the previous gateway to represent a preview installed before this update.
  const original=await readFile(new URL('../supabase/migrations/202609290001_admissions.sql',import.meta.url),'utf8');
  const oldGateway=original.slice(original.indexOf('create function public.admission_api'),original.indexOf('create function public.admission_bootstrap')).replace('create function public.admission_api','create or replace function public.admission_api');
  await db.exec(oldGateway);
  assert.equal((await post('/api/public/result',{identification:'SCORE-MAX',password:'AB12CD'},false)).final_score,undefined);
  await db.close();db=null;
  ({db,handler}=await localBackend({persist,password:'UnusedReplacementPassword-2027',fastHash:true}));
  assert.equal((await post('/api/login',{username:'Admi2026',password},false)).httpStatus,200);
  for(const [identification,status,score] of [['SCORE-ZERO','NO_ADMITIDO','0.0000'],['SCORE-MAX','ADMITIDO','100.0000'],['SCORE-WEIGHTED','ADMITIDO','86.2149']]){
   const result=await post('/api/public/result',{identification,password:'AB12CD'},false);
   assert.equal(result.httpStatus,200);assert.equal(result.status,status);assert.equal(result.final_score,score);
   assert.deepEqual(Object.keys(result).sort(),['final_score','httpStatus','instructions','name','status']);
  }
  const wrong=await post('/api/public/result',{identification:'SCORE-MAX',password:'WRONG1'},false);
  assert.equal(wrong.httpStatus,401);assert.equal(wrong.final_score,undefined);
  const privileges=(await db.query("select has_function_privilege('anon','public.admission_api(text,text,jsonb,text,text,text,text)','EXECUTE') as anon_allowed,prosecdef from pg_proc where oid='public.admission_api(text,text,jsonb,text,text,text,text)'::regprocedure")).rows[0];
  assert.equal(privileges.anon_allowed,false);assert.equal(privileges.prosecdef,false);
  await db.close();db=null;
  ({db,handler}=await localBackend({persist,password,fastHash:true}));
  assert.equal((await db.query('select count(*)::int n from admission_private.students')).rows[0].n,3);
  assert.equal((await post('/api/public/result',{identification:'SCORE-MAX',password:'AB12CD'},false)).final_score,'100.0000');
 }finally{if(db)await db.close();await rm(temp,{recursive:true,force:true});}
});
