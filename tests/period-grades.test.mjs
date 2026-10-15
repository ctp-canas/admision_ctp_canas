import test from 'node:test';
import assert from 'node:assert/strict';
import {localBackend} from '../backend/local.mjs';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('period grades require 25 marks, calculate the 60/40 score and preserve annual references',async()=>{
 const password='Synthetic-Periods-Only-2026',{db,handler}=await localBackend({password,fastHash:true});let token;
 async function request(path,method='GET',body){const response=await handler(new Request('http://127.0.0.1:8080'+path,{method,headers:{'Content-Type':'application/json',...(token?{'X-Admission-Token':token}:{})},...(body?{body:JSON.stringify(body)}:{})}));return {status:response.status,...await response.json()};}
 try{
  token=(await request('/api/login','POST',{username:'Admi2026',password})).token;
  const id=(await request('/api/admin/students','POST',{identification:'PERIODS-001',first_name:'Prueba',last_name1:'Períodos',password:'AB12CD'})).id;
  const keys=(await db.query('select admission_private.grade_keys() keys')).rows[0].keys;
  assert.equal(keys.length,25);assert.equal(keys.filter(k=>k.startsWith('g4_')).length,10);assert.equal(keys.filter(k=>k.startsWith('g5_')).length,10);assert.equal(keys.filter(k=>k.startsWith('g6_')).length,5);
  await db.query('update admission_private.students set grades=$1::jsonb,exam=75.1234 where id=$2',[JSON.stringify({g4_math:'90',g5_math:'95',g6_math:'88'}),id]);
  let d=await request(`/api/admin/students/${id}/academic`);assert.equal(d.result.academic_avg,null);assert.equal(d.legacy_grades.g4_math,'90');
  await request('/api/admin/locks/acquire','POST',{student_id:id});
  assert.equal((await request(`/api/admin/students/${id}/grades`,'PUT',{version:0,grades:{g4_math:'100'}})).status,400,'An old client must not erase period marks');
  const values=['60.1254','80.2345','90.3456','100','70.4567'],grades=Object.fromEntries(keys.map((key,index)=>[key,values[Math.floor(index/5)]]));
  const partial={...grades,[keys.at(-1)]:''};
  assert.equal((await request(`/api/admin/students/${id}/grades`,'PUT',{version:0,grades:partial})).status,200);
  d=await request(`/api/admin/students/${id}/academic`);assert.equal(d.result.final_score,null);assert.equal(d.grades[keys.at(-1)],null);
  await request('/api/admin/locks/acquire','POST',{student_id:id});assert.equal((await request(`/api/admin/students/${id}/grades`,'PUT',{version:1,grades})).status,200);
  d=await request(`/api/admin/students/${id}/academic`);
  assert.equal(d.result.academic_avg,'80.2324');assert.equal(d.result.academic_component,'48.1394');assert.equal(d.result.exam_component,'30.0494');assert.equal(d.result.final_score,'78.1888');assert.equal(d.legacy_grades.g4_math,'90');
  const ranking=await request('/api/admin/ranking');assert.equal(ranking.rows[0].final_display,'78.1888');const report=await request('/api/admin/report');assert.equal(report.rows[0].academic_avg_display,'80.2324');
  await request('/api/admin/cutoff/apply','POST',{slots:1});
  await request('/api/admin/locks/acquire','POST',{student_id:id});assert.equal((await request(`/api/admin/students/${id}/grades`,'PUT',{version:2,grades:Object.fromEntries(keys.map(k=>[k,'0']))})).status,200);
  d=await request(`/api/admin/students/${id}/academic`);assert.equal(d.result.academic_avg,'0.0000');assert.equal(d.result.final_score,'30.0494');assert.equal((await request('/api/admin/config')).cut_valid,false);
  // Simulate restoration of pre-period configuration with annual marks only.
  await db.query('update admission_private.students set grades=$1::jsonb,decision=$2 where id=$3',[JSON.stringify({g4_science:'90'}),'ADMITIDO',id]);
  await db.exec("update admission_private.config set data=(data-'grade_period_model')||'{\"cut_valid\":true}'::jsonb where id=1;select admission_private.sync_period_model();");
  assert.equal((await request('/api/admin/config')).cut_valid,false);
  assert.equal((await request(`/api/admin/students/${id}/academic`)).legacy_grades.g4_science,'90');
 }finally{await db.close();}
});

test('academic entry renders both periods and sends 25 independent marks including zero and blanks',async()=>{
 const source=await readFile(new URL('../public/admin.js',import.meta.url),'utf8');
 const constants=source.slice(source.indexOf('const subjects='),source.indexOf('function esc('));
 const functions=source.slice(source.indexOf('async function renderAcademic('),source.indexOf('function renderExam('));
 const prefixes=['g4_p1','g4_p2','g5_p1','g5_p2','g6_p1'],keys=prefixes.flatMap(p=>['math','science','spanish','social','conduct'].map(s=>p+'_'+s));
 const inputs=keys.map((key,index)=>({dataset:{key},value:index===0?'0':index===1?'':'88',addEventListener(){}}));
 const elements={'#studentTab':{innerHTML:''},'#saveGrades':{focus(){}},'#cancelGrades':{},'#gradeMsg':{innerHTML:''}},requests=[];
 const data={grades:Object.fromEntries(keys.map(k=>[k,null])),legacy_grades:{g4_math:'90'},result:{},version:7};
 const context={currentStudent:{id:1,data,lockOwned:false},gradeHeartbeat:null,$:key=>elements[key],$$:()=>inputs,esc:value=>String(value??''),clearInterval(){},setInterval(){return 1;},setTimeout(){},closeModal(){},async refreshStudentProgress(){},async api(path,options){requests.push({path,options});return path.endsWith('/academic')?data:{};}};
 runInNewContext(constants+functions,context);await context.renderAcademic(data);
 assert.ok(elements['#studentTab'].innerHTML.includes('Cuarto año – II período'));assert.ok(elements['#studentTab'].innerHTML.includes('Quinto año – II período'));assert.ok(elements['#studentTab'].innerHTML.includes('Sexto año – I período'));assert.ok(elements['#studentTab'].innerHTML.includes('dividida entre 25'));
 assert.equal((elements['#studentTab'].innerHTML.match(/class="grade-input"/g)||[]).length,25);
 await context.saveGrades();const sent=requests.find(r=>r.options?.method==='PUT');assert.equal(Object.keys(sent.options.body.grades).length,25);assert.equal(sent.options.body.grades.g4_p1_math,'0');assert.equal(sent.options.body.grades.g4_p1_science,'');assert.equal(sent.options.body.version,7);
});
