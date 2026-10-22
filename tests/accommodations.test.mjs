import test from 'node:test';
import assert from 'node:assert/strict';
import {localBackend} from '../backend/local.mjs';

test('accommodations persist privately, separate attendance by room and retain schedules and backups',async()=>{
 const password='Synthetic-Accommodations-2026',{db,handler}=await localBackend({password,fastHash:true});let token;
 const request=async(path,method='GET',body)=>{const r=await handler(new Request('http://127.0.0.1:8080'+path,{method,headers:{'Content-Type':'application/json',...(token?{'X-Admission-Token':token}:{})},...(body?{body:JSON.stringify(body)}:{})}));return {status:r.status,data:await r.json()};};
 const login=async()=>{token=(await request('/api/login','POST',{username:'Admi2026',password})).data.token;};
 const students=async()=>(await request('/api/admin/students')).data.rows;
 const schedule=async()=>(await request('/api/admin/exam-schedule')).data;
 const change=async(row,extra={})=>request('/api/admin/students/'+row.id,'PUT',{identification:row.identification,first_name:row.first_name,last_name1:row.last_name1,last_name2:row.last_name2,version:row.version,...extra});
 try{
  await login();
  for(const [identification,last_name1,accommodation] of [['QA1','Zúñiga',undefined],['QA2','Álvarez','ACNS'],['QA3','álfaro','ACS'],['QA4','Ñúñez','NP'],['QA5','Núñez','NP']]){
   const body={identification,first_name:'María',last_name1,last_name2:'Pérez',password:'AB12CD',...(accommodation?{accommodation}:{})};assert.equal((await request('/api/admin/students','POST',body)).status,200);
  }
  let list=await students();assert.equal(list.find(s=>s.identification==='QA1').accommodation,'NP');
  const sc=await schedule();assert.deepEqual(sc.rows.map(s=>s.identification),['QA3','QA2','QA5','QA4','QA1']);
  assert.equal((await request('/api/admin/exam-schedule','PUT',{students:sc.rows.map(s=>({id:s.id,version:s.version})),date:'2026-10-27',block:1})).status,200);
  const attendance=async(path='?date=2026-10-27&block=1')=>(await request('/api/admin/exam-attendance'+path)).data;
  let report=await attendance();assert.deepEqual(report.groups.map(g=>g.room),['Aula regular','Aula Específica']);
  assert.deepEqual(report.groups[0].rows.map(s=>s.identification),['QA5','QA4','QA1']);assert.deepEqual(report.groups[1].rows.map(s=>s.identification),['QA3','QA2']);assert.equal(report.groups[1].rows[0].name,'álfaro Pérez María');
  assert.ok(report.groups.every(g=>g.rows.every(s=>Object.keys(s).sort().join(',')==='identification,name')));assert.ok(!/ACNS|ACS|adecuaci|password|grades|reason/.test(JSON.stringify(report)));
  assert.equal(new Set(report.groups.flatMap(g=>g.rows.map(s=>s.identification))).size,5);
  let row=list.find(s=>s.identification==='QA3');assert.equal((await change(row)).status,200);assert.equal((await students()).find(s=>s.id===row.id).accommodation,'ACS','old clients preserve accommodation');
  row=(await students()).find(s=>s.id===row.id);for(const accommodation of ['INVALID',null,4])assert.equal((await change(row,{accommodation})).status,400);
  const oldSchedule=(await schedule()).rows.find(s=>s.id===row.id);assert.equal((await change(row,{accommodation:'NP'})).status,200);const moved=(await schedule()).rows.find(s=>s.id===row.id);assert.equal(moved.date,oldSchedule.date);assert.equal(moved.block,oldSchedule.block);assert.equal(moved.version,oldSchedule.version+1);
  assert.equal((await request('/api/admin/exam-schedule','PUT',{students:[{id:row.id,version:oldSchedule.version}],date:'2026-10-28',block:2})).status,409);
  report=await attendance();assert.deepEqual(report.groups[1].rows.map(s=>s.identification),['QA2']);assert.ok(report.groups[0].rows.some(s=>s.identification==='QA3'));
  const special=(await schedule()).rows.find(s=>s.identification==='QA2');assert.equal((await request('/api/admin/exam-schedule','PUT',{students:[{id:special.id,version:special.version}],mode:'custom',date:'2026-11-03',start:'09:15',end:'11:15',reason:'Reprogramación de prueba QA.'})).status,200);
  const custom=await attendance('?date=2026-11-03&block=custom');assert.equal(custom.groups.find(g=>g.room==='Aula Específica').rows[0].identification,'QA2');assert.equal(custom.groups[0].start,'09:15');
  assert.equal((await attendance('')).groups.flatMap(g=>g.rows).filter(s=>s.identification==='QA2').length,1);
  const final=(await request('/api/admin/report')).data;assert.equal(final.rows.find(s=>s.identification==='QA2').accommodation,'ACNS');assert.ok(final.rows.every(s=>['NP','ACS','ACNS'].includes(s.accommodation)));
  const id=(await request('/api/admin/backup/create','POST',{})).data.id,saved=(await request('/api/admin/backup/download?id='+id)).data;
  row=(await students()).find(s=>s.identification==='QA2');await change(row,{accommodation:'NP'});
  assert.equal((await request('/api/admin/restore','POST',{payload:saved.payload,sha256:saved.manifest.sha256,confirmation:'RESTAURAR'})).status,200);await login();assert.equal((await students()).find(s=>s.identification==='QA2').accommodation,'ACNS');
  const legacy=(await db.query("with snap as (select admission_private.snapshot() data), old as (select jsonb_set(data,'{students}',(select jsonb_agg(s-'accommodation') from jsonb_array_elements(data->'students') s)) data from snap), encrypted as (select encode(extensions.pgp_sym_encrypt(data::text,$1),'base64') payload from old) select payload,encode(extensions.digest(payload,'sha256'),'hex') sha256 from encrypted",['local-tests-only-backup-key-1234567890'])).rows[0];
  assert.equal((await request('/api/admin/restore','POST',{...legacy,confirmation:'RESTAURAR'})).status,200);await login();assert.ok((await students()).every(s=>s.accommodation==='NP'));assert.equal((await schedule()).summary.assigned,5);
  const grants=(await db.query("select has_table_privilege('anon','admission_private.students','SELECT') anon,has_table_privilege('authenticated','admission_private.students','SELECT') authenticated")).rows[0];assert.deepEqual(grants,{anon:false,authenticated:false});
 }finally{await db.close();}
});
