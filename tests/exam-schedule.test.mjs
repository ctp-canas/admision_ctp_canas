import test from 'node:test';
import assert from 'node:assert/strict';
import {localBackend} from '../backend/local.mjs';

test('exam scheduling, attendance privacy, concurrent edits and backups',async t=>{
 const password='Synthetic-Schedule-Only-2026';
 const {db,handler}=await localBackend({password,fastHash:true});
 let token,second,clerk,students,backup;
 const request=async(path,{method='GET',body,session=token}={})=>{
  const response=await handler(new Request('http://127.0.0.1:8080'+path,{method,headers:{'Content-Type':'application/json',...(session?{'X-Admission-Token':session}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  return {status:response.status,data:await response.json()};
 };
 const assign=(rows,date,block,session=token)=>request('/api/admin/exam-schedule',{method:'PUT',body:{students:rows.map(s=>({id:s.id,version:s.version})),date,block},session});
 const schedule=async()=>{const r=await request('/api/admin/exam-schedule');assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 try{
  await t.test('routes require an active administrative session and respect service-only permissions',async()=>{
   for(const path of ['/api/admin/exam-schedule','/api/admin/exam-attendance'])assert.equal((await request(path,{session:''})).status,401);
   const permissions=(await db.query("select has_function_privilege('anon','admission_private.exam_schedule(text,text,jsonb,bigint)','EXECUTE') anon,has_function_privilege('authenticated','admission_private.exam_schedule(text,text,jsonb,bigint)','EXECUTE') authenticated,has_function_privilege('service_role','admission_private.exam_schedule(text,text,jsonb,bigint)','EXECUTE') server")).rows[0];
   assert.deepEqual(permissions,{anon:false,authenticated:false,server:true});
   token=(await request('/api/login',{method:'POST',body:{username:'Admi2026',password},session:''})).data.token;
   second=(await request('/api/login',{method:'POST',body:{username:'Admi2026',password},session:''})).data.token;
   await request('/api/admin/users',{method:'POST',body:{username:'schedule-clerk',display_name:'Registro',password,role:'digitador'}});
   clerk=(await request('/api/login',{method:'POST',body:{username:'schedule-clerk',password},session:''})).data.token;
   await db.exec('set role service_role');
   assert.equal((await db.query("select public.admission_api('GET','/api/admin/exam-schedule','{}',$1) result",[(await import('node:crypto')).createHash('sha256').update(token).digest('hex')])).rows[0].result.summary.total,0);
   await db.exec('reset role');
  });
  await t.test('three dates and three Costa Rica blocks, with every new student initially unassigned',async()=>{
   for(const [id,name,last] of [['00001','Ana','Zúñiga'],['00002','Beatriz','Alfaro'],['00003','Carlos','Mora']]){
    assert.equal((await request('/api/admin/students',{method:'POST',body:{identification:id,first_name:name,last_name1:last,last_name2:'',password:'ZZ12AB'}})).status,200);
   }
   const d=await schedule();students=d.rows;
   assert.deepEqual(d.dates,['2026-10-27','2026-10-28','2026-10-29']);assert.equal(d.timezone,'America/Costa_Rica');
   assert.deepEqual(d.blocks.map(b=>[b.start,b.end]),[['08:00','10:00'],['11:00','13:00'],['14:00','16:00']]);
   assert.equal(d.summary.unassigned,3);assert.equal(d.summary.assigned,0);assert.equal(d.summary.by_slot.length,9);
   assert.deepEqual(d.rows.map(r=>r.identification),['00002','00003','00001']);
   assert.equal(JSON.stringify(d).includes('password_hash'),false);assert.equal(JSON.stringify(d).includes('ZZ12AB'),false);
  });
  await t.test('invalid dates, partial assignments, duplicate selections and nonexistent students cannot modify records',async()=>{
   for(const [date,block] of [['2026-10-26',1],['2027-10-27',1],['2026-10-28',0],['2026-10-28',4],['2026-10-28',null],[null,1],['not-a-date',1]])assert.equal((await assign([students[0]],date,block)).status,400);
   assert.equal((await assign([students[0],students[0]],'2026-10-27',1)).status,400);
   assert.equal((await assign([],'2026-10-27',1)).status,400);
   assert.equal((await assign([{id:999999,version:0}],'2026-10-27',1)).status,404);
   assert.equal((await request('/api/admin/exam-schedule',{method:'PUT',body:{students:[{id:students[0].id,version:0}]}})).status,400);
   assert.equal((await schedule()).summary.assigned,0);
  });
  await t.test('bulk assignment is atomic, digitadores can schedule, and stale sessions cannot overwrite another edit',async()=>{
   assert.equal((await assign(students.slice(0,2),'2026-10-27',2,clerk)).data.updated,2);
   const stale=await assign(students,'2026-10-28',3,second);assert.equal(stale.status,409);
   let d=await schedule();assert.equal(d.rows.find(r=>r.id===students[2].id).date,null);
   assert.equal(d.summary.by_slot.find(s=>s.date==='2026-10-27'&&s.block===2).count,2);
   assert.equal((await assign([d.rows[0]],'2026-10-29',3)).data.updated,1);
   d=await schedule();assert.equal((await assign([d.rows[0]],'2026-10-29',3)).data.updated,0);
   students=(await schedule()).rows;
   const audit=(await request('/api/admin/audit')).data.rows;assert.equal(audit.filter(a=>a.action==='HORARIO_PRUEBA_ASIGNADO').length,3);
  });
  await t.test('attendance groups contain only the selected day/block, include empty blocks and never contain grades or passwords',async()=>{
   let r=await request('/api/admin/exam-attendance?date=2026-10-27&block=2',{session:clerk});assert.equal(r.status,200);assert.equal(r.data.groups.length,1);
   assert.deepEqual(r.data.groups[0].rows.map(s=>s.identification),['00003']);
   assert.deepEqual(Object.keys(r.data.groups[0].rows[0]).sort(),['identification','name']);
   assert.equal((await request('/api/admin/exam-attendance?date=2026-10-28')).data.groups.length,3);
   assert.ok((await request('/api/admin/exam-attendance?date=2026-10-28')).data.groups.every(g=>g.rows.length===0));
   assert.equal((await request('/api/admin/exam-attendance')).data.groups.length,9);
   assert.equal((await request('/api/admin/exam-attendance?date=2026-11-01')).status,400);
   assert.equal((await request('/api/admin/exam-attendance?block=4')).status,400);
   assert.equal((await request('/api/admin/exam-schedule',{method:'POST',body:{}})).status,405);
  });
  await t.test('changing or removing an appointment preserves grades, record version and the publication decision',async()=>{
   const s=students[1];await db.query("update admission_private.students set grades='{}',exam=87.25,decision='ADMITIDO' where id=$1",[s.id]);
   await db.exec("update admission_private.config set data=data||'{\"cut_valid\":true}'::jsonb where id=1");
   assert.equal((await assign([s],null,null)).status,200);
   const actual=(await db.query('select exam,version,decision from admission_private.students where id=$1',[s.id])).rows[0];assert.equal(Number(actual.exam),87.25);assert.equal(actual.version,0);assert.equal(actual.decision,'ADMITIDO');
   assert.equal((await request('/api/admin/config')).data.cut_valid,true);
   assert.equal((await schedule()).summary.unassigned,2);
  });
  await t.test('encrypted backup/restore preserves appointments and legacy backups restore without appointments',async()=>{
   backup=(await request('/api/admin/backup/create',{method:'POST',body:{}})).data;
   const saved=(await request('/api/admin/backup/download?id='+backup.id)).data;
   let d=await schedule();const before=d.rows.map(r=>[r.id,r.date,r.block,r.version]);
   assert.equal((await assign(d.rows,'2026-10-28',1)).status,200);
   const restored=await request('/api/admin/restore',{method:'POST',body:{payload:saved.payload,sha256:saved.manifest.sha256,confirmation:'RESTAURAR'}});assert.equal(restored.status,200,JSON.stringify(restored.data));
   token=(await request('/api/login',{method:'POST',body:{username:'Admi2026',password},session:''})).data.token;
   d=await schedule();assert.deepEqual(d.rows.map(r=>[r.id,r.date,r.block,r.version]),before);
   const legacy=(await db.query("with snap as (select admission_private.snapshot() data), old as (select jsonb_set(data,'{students}',(select jsonb_agg(s-'exam_date'-'exam_block'-'exam_schedule_version') from jsonb_array_elements(data->'students') s)) data from snap), encrypted as (select encode(extensions.pgp_sym_encrypt(data::text,$1),'base64') payload from old) select payload,encode(extensions.digest(payload,'sha256'),'hex') sha256 from encrypted",['local-tests-only-backup-key-1234567890'])).rows[0];
   assert.equal((await request('/api/admin/restore',{method:'POST',body:{...legacy,confirmation:'RESTAURAR'}})).status,200);
   token=(await request('/api/login',{method:'POST',body:{username:'Admi2026',password},session:''})).data.token;
   assert.equal((await schedule()).summary.unassigned,3);assert.ok((await schedule()).rows.every(s=>s.version===0));
  });
  await t.test('exceptional appointments require a valid reason and time, move the signature list and survive backup/restore',async()=>{
   let d=await schedule(),first=d.rows[0],other=d.rows[1];
   const custom=(rows,changes={})=>request('/api/admin/exam-schedule',{method:'PUT',body:{students:rows.map(r=>({id:r.id,version:r.version})),mode:'custom',date:'2026-11-03',block:null,start:'09:15',end:'11:15',reason:'Cita médica justificada por la persona encargada.',...changes}});
   for(const changes of [{reason:''},{reason:'abc'},{start:'09:00',end:'08:00'},{start:'25:00'},{date:'2026-02-30'},{date:''},{end:''},{block:1}])assert.equal((await custom([first],changes)).status,400,JSON.stringify(changes));
   assert.equal((await assign([first,other],'2026-10-27',1)).status,200);
   d=await schedule();first=d.rows.find(r=>r.id===first.id);other=d.rows.find(r=>r.id===other.id);
   assert.equal((await custom([first])).status,200);
   d=await schedule();const special=d.rows.find(r=>r.id===first.id);assert.equal(special.kind,'custom');assert.equal(special.start,'09:15');assert.equal(special.end,'11:15');assert.ok(special.reason.includes('Cita médica'));assert.equal(d.summary.reprogrammed,1);assert.equal(d.custom_slots.length,1);assert.ok(d.dates.includes('2026-11-03'));assert.equal(d.regular_dates.length,3);
   const oldList=(await request('/api/admin/exam-attendance?date=2026-10-27&block=1')).data.groups[0].rows;
   assert.deepEqual(oldList.map(r=>r.identification),[other.identification]);
   const newList=(await request('/api/admin/exam-attendance?date=2026-11-03&block=custom')).data;
   assert.equal(newList.groups.length,1);assert.equal(newList.groups[0].time_label,'9:15 a.m. a 11:15 a.m.');assert.deepEqual(newList.groups[0].rows.map(r=>r.identification),[first.identification]);assert.equal(newList.groups[0].rows[0].reason,undefined);
   const all=(await request('/api/admin/exam-attendance')).data;assert.equal(all.groups.length,10);assert.equal(all.groups.flatMap(g=>g.rows).filter(r=>r.identification===first.identification).length,1);
   assert.equal((await custom([first,other],{date:'2026-11-04'})).status,409);assert.equal((await schedule()).rows.find(r=>r.id===other.id).date,'2026-10-27');
   const audit=(await request('/api/admin/audit')).data.rows.find(r=>r.action==='PRUEBA_REPROGRAMADA');assert.equal(audit.detail_json.previous_date,'2026-10-27');assert.equal(audit.detail_json.reason,special.reason);
   const savedId=(await request('/api/admin/backup/create',{method:'POST',body:{}})).data.id,saved=(await request('/api/admin/backup/download?id='+savedId)).data;
   assert.equal((await assign([special],null,null)).status,200);
   const cleared=(await schedule()).rows.find(r=>r.id===special.id);assert.equal(cleared.reason,'');assert.equal(cleared.start,null);assert.equal(cleared.end,null);
   assert.equal((await request('/api/admin/restore',{method:'POST',body:{payload:saved.payload,sha256:saved.manifest.sha256,confirmation:'RESTAURAR'}})).status,200);
   token=(await request('/api/login',{method:'POST',body:{username:'Admi2026',password},session:''})).data.token;
   const restored=(await schedule()).rows.find(r=>r.id===special.id);assert.deepEqual([restored.date,restored.start,restored.end,restored.reason,restored.version],[special.date,special.start,special.end,special.reason,special.version]);
  });
  await t.test('annual reset removes appointments and prepares the three dates for the new cycle',async()=>{
   assert.equal((await request('/api/admin/reset-cycle',{method:'POST',body:{new_year:'2028',slots:'150',publication_at:'2027-12-01T08:00:00-06:00',admitted_instructions:'Matrícula',confirmation:'REINICIAR 2027'}})).status,200);
   const d=await schedule();assert.equal(d.rows.length,0);assert.deepEqual(d.dates,['2027-10-27','2027-10-28','2027-10-29']);
  });
 }finally{await db.close();}
});
