import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {localBackend} from '../backend/local.mjs';

async function waitFor(check,label){const until=Date.now()+5000;while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Timed out: '+label);}
test('administration DOM and real backend: progress, direct saving, group saving and rescheduling',async t=>{
 const password='Synthetic-Progress-DOM-2026',{db,handler}=await localBackend({password,fastHash:true});
 const html=await readFile(new URL('../public/admin.html',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:'http://127.0.0.1:8080/admin.html',runScripts:'outside-only'}),w=dom.window,d=w.document,requests=[],downloads=[],alerts=[];
 const change=(element,value)=>{assert.ok(element,'Missing control');element.value=value;element.dispatchEvent(new w.Event('change',{bubbles:true}));};
 const byId=id=>d.getElementById(id),row=id=>d.querySelector(`[data-schedule-row="${id}"]`),studentRow=id=>d.querySelector(`#studentRows [data-progress-id="${id}"]`)?.closest('tr');
 const scopeProgress=(scope,id,step)=>scope.querySelector(`[data-progress-id="${id}"][data-progress-step="${step}"]`);
 w.alert=message=>alerts.push(message);w.confirm=()=>true;
 w.fetch=async(url,options={})=>{const path=new URL(url).pathname;requests.push({path,method:options.method||'GET',body:options.body?JSON.parse(options.body):undefined});return handler(new Request(url,{...options,headers:{...options.headers,Origin:'http://127.0.0.1:8080'}}));};
 w.ADMISSION_CONFIG={apiBase:'http://127.0.0.1:8080'};
 w.downloadFile=(bytes,name,type)=>downloads.push({bytes,name,type});w.createAttendanceReport=async report=>{downloads.push({report});return new w.Uint8Array([1,2,3]);};
 try{
  w.eval(await readFile(new URL('../public/api.js',import.meta.url),'utf8'));
  await w.admissionRequest('/api/login',{method:'POST',body:{username:'Admi2026',password}});
  const ids=[];for(const [identification,first_name] of [['00001','Ana <script>prueba</script>'],['00002','Beatriz'],['00003','Carlos']]){
   const result=await w.admissionRequest('/api/admin/students',{method:'POST',body:{identification,first_name,last_name1:'Prueba',last_name2:'',password:'AB12CD'}});ids.push(result.id);
  }
  for(const name of ['statistics.js','progress.js','exam-schedule.js','admin.js'])w.eval(await readFile(new URL('../public/'+name,import.meta.url),'utf8'));
  await waitFor(()=>d.querySelector('#stats .stat-card'),'dashboard');
  const [first,second,third]=ids;
  const api=(path,method='GET',body)=>w.admissionRequest(path,{method,...(body?{body}:{})});
  const schedules=()=>api('/api/admin/exam-schedule');
  await t.test('choosing a block keeps unassigned students visible and group Save persists on the server',async()=>{
   w.showSection('examSchedule');await waitFor(()=>row(first),'schedule rows');assert.equal(byId('scheduleCount').textContent,'3 de 3 estudiantes');
   assert.equal(byId('assignSchedule').disabled,true);d.querySelector('[data-slot-date="2026-10-27"][data-slot-block="1"]').click();
   assert.equal(byId('scheduleCount').textContent,'3 de 3 estudiantes');assert.equal(byId('batchExamDate').value,'2026-10-27');assert.equal(byId('batchExamBlock').value,'1');assert.equal(byId('scheduleDate').value,'');assert.equal(byId('scheduleBlock').value,'');
   row(first).querySelector('[data-schedule-check]').click();row(second).querySelector('[data-schedule-check]').click();assert.equal(byId('assignSchedule').disabled,false);
   byId('assignSchedule').click();await waitFor(()=>byId('scheduleMsg').textContent.includes('2 horario(s) guardado(s)'),'group save');
   const saved=await schedules();assert.equal(saved.rows.filter(s=>s.date==='2026-10-27'&&s.block===1).length,2);assert.equal(saved.summary.unassigned,1);
   assert.ok(scopeProgress(row(first),first,'appointment').classList.contains('complete'));assert.ok(!row(first).querySelector('script'));
   const sent=requests.find(r=>r.path==='/api/admin/exam-schedule'&&r.method==='PUT');assert.equal(sent.body.date,'2026-10-27');assert.equal(sent.body.block,1);assert.equal(sent.body.students.length,2);
  });
  await t.test('each row enables Save only with date and block, then reloads the persisted appointment',async()=>{
   const save=row(third).querySelector('[data-schedule-save]');assert.equal(save.disabled,true);
   change(row(third).querySelector('[data-schedule-date]'),'2026-10-28');assert.equal(save.disabled,true);
   change(row(third).querySelector('[data-schedule-block]'),'2');assert.equal(save.disabled,false);save.click();
   await waitFor(()=>byId('scheduleMsg').textContent.includes('1 horario(s) guardado(s)'),'individual save');
   await w.ExamSchedule.load();assert.equal(row(third).querySelector('[data-schedule-date]').value,'2026-10-28');assert.equal(row(third).querySelector('[data-schedule-block]').value,'2');
   const saved=(await schedules()).rows.find(r=>r.id===third);assert.equal(saved.progress.password,true);assert.equal(saved.progress.appointment,true);assert.equal(saved.progress.grades,false);assert.equal(saved.progress.exam,false);assert.equal(saved.progress.completed,2);
  });
  await t.test('check marks follow stored marks, zero exam scores and removed appointments, with pending filters',async()=>{
   const keys=(await db.query('select admission_private.grade_keys() keys')).rows[0].keys;
   await api('/api/admin/locks/acquire','POST',{student_id:third});await api(`/api/admin/students/${third}/grades`,'PUT',{version:0,grades:Object.fromEntries(keys.map(k=>[k,'0']))});await api(`/api/admin/students/${third}/exam`,'PUT',{version:1,score:'0'});
   await api('/api/admin/locks/acquire','POST',{student_id:first});await api(`/api/admin/students/${first}/grades`,'PUT',{version:0,grades:Object.fromEntries(keys.map((k,i)=>[k,i===0?'0':null]))});
   const assigned=(await schedules()).rows.find(r=>r.id===first);await api('/api/admin/exam-schedule','PUT',{students:[{id:first,version:assigned.version}],date:null,block:null});
   w.showSection('students');await waitFor(()=>studentRow(third),'student progress');
   assert.ok(studentRow(third).textContent.includes('Registro completo'));assert.ok(scopeProgress(studentRow(third),third,'exam').classList.contains('complete'));assert.ok(scopeProgress(studentRow(third),third,'grades').textContent.includes('25/25'));
   assert.ok(scopeProgress(studentRow(first),first,'grades').textContent.includes('1/25'));assert.ok(scopeProgress(studentRow(first),first,'grades').classList.contains('pending'));assert.ok(scopeProgress(studentRow(first),first,'appointment').classList.contains('pending'));
   change(byId('studentProgressFilter'),'grades');await waitFor(()=>byId('studentRows').querySelectorAll('tr').length===2,'grade filter');
   change(byId('studentProgressFilter'),'appointment');await waitFor(()=>studentRow(first)&&!studentRow(second)&&!studentRow(third),'appointment filter');
   const rows=(await api('/api/admin/students')).rows;assert.ok(!JSON.stringify(rows).includes('password_hash'));assert.ok(!JSON.stringify(rows).includes('AB12CD'));
  });
  await t.test('each process indicator opens its corresponding form and appointment selects that student',async()=>{
   change(byId('studentProgressFilter'),'');await waitFor(()=>studentRow(third),'all students');
   scopeProgress(studentRow(third),third,'password').click();await waitFor(()=>byId('fPass'),'password form');assert.ok(!d.querySelector('.grade-input'));w.closeModal();
   scopeProgress(studentRow(third),third,'exam').click();await waitFor(()=>byId('examScore'),'exam form');assert.equal(byId('examScore').value,'0.0000');assert.ok(!d.querySelector('.grade-input'));w.closeModal();
   scopeProgress(studentRow(first),first,'grades').click();await waitFor(()=>d.querySelectorAll('.grade-input').length===25,'grades form');d.querySelectorAll('.grade-input').forEach(input=>input.value='0');byId('saveGrades').click();await waitFor(()=>scopeProgress(studentRow(first),first,'grades').classList.contains('complete'),'live grade indicator');w.closeModal();
   scopeProgress(studentRow(first),first,'exam').click();await waitFor(()=>byId('examScore'),'pending exam form');byId('examScore').value='0';byId('saveExam').click();await waitFor(()=>scopeProgress(studentRow(first),first,'exam').classList.contains('complete'),'live exam indicator');w.closeModal();
   scopeProgress(studentRow(first),first,'appointment').click();await waitFor(()=>byId('scheduleCount').textContent==='1 de 3 estudiantes','appointment focus');assert.equal(byId('scheduleSearch').value,'00001');assert.equal(byId('scheduleSelection').textContent,'1 seleccionados');
   d.querySelector('[data-slot-date="2026-10-29"][data-slot-block="3"]').click();assert.equal(byId('scheduleCount').textContent,'1 de 3 estudiantes');assert.equal(byId('scheduleSelection').textContent,'1 seleccionados');
   byId('assignSchedule').click();await waitFor(()=>byId('scheduleMsg').textContent.includes('1 horario(s) guardado(s)'),'focused student save');
  });
  await t.test('rescheduling still requires a reason, updates attendance and rejects a stale inline edit',async()=>{
   row(first).querySelector('[data-schedule-edit]').click();await waitFor(()=>byId('assignCustomDate'),'custom form');assert.equal(byId('assignExamMode').value,'custom');
   change(byId('assignCustomDate'),'2026-11-03');change(byId('assignCustomStart'),'09:15');assert.equal(byId('assignCustomEnd').value,'11:15');
   const before=requests.filter(r=>r.method==='PUT'&&r.path==='/api/admin/exam-schedule').length;byId('saveExamSchedule').click();await waitFor(()=>byId('assignExamMsg').textContent.includes('motivo'),'reason validation');assert.equal(requests.filter(r=>r.method==='PUT'&&r.path==='/api/admin/exam-schedule').length,before);
   byId('assignCustomReason').value='Cita médica <script>ejemplo</script>';byId('saveExamSchedule').click();await waitFor(()=>byId('scheduleMsg').textContent.includes('reprogramada(s)'),'custom save');assert.ok(!row(first).querySelector('script'));assert.ok(row(first).textContent.includes('Cita médica <script>ejemplo</script>'));
   change(byId('scheduleDate'),'2026-11-03');change(byId('scheduleBlock'),'custom');byId('scheduleSearch').value='sin coincidencias';byId('scheduleSearch').dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(byId('scheduleCount').textContent,'0 de 3 estudiantes');byId('printAttendance').click();await waitFor(()=>downloads.some(x=>x.report),'attendance print');
   const report=downloads.find(x=>x.report).report;assert.equal(report.groups.length,1);assert.equal(report.groups[0].rows[0].identification,'00001');assert.equal(report.groups[0].rows[0].reason,undefined);assert.ok(downloads.find(x=>x.name)?.name.includes('_Reprogramados.pdf'));
   byId('clearScheduleFilters').click();const stale=(await schedules()).rows.find(r=>r.id===first);await api('/api/admin/exam-schedule','PUT',{students:[{id:first,version:stale.version}],date:'2026-10-28',block:1});
   change(row(first).querySelector('[data-schedule-date]'),'2026-10-28');change(row(first).querySelector('[data-schedule-block]'),'2');row(first).querySelector('[data-schedule-save]').click();await waitFor(()=>byId('scheduleMsg').textContent.includes('Otra persona'),'stale edit');assert.equal((await schedules()).rows.find(r=>r.id===first).block,1);
  });
  await t.test('student data saves accommodation and the schedule PDF ignores individual search',async()=>{
   await w.openStudent(third,'data');assert.equal(byId('fAccommodation').value,'NP');change(byId('fAccommodation'),'ACNS');byId('saveStudent').click();await waitFor(()=>!byId('saveStudent'),'save student condition');
   const saved=(await api('/api/admin/students')).rows.find(s=>s.id===third);assert.equal(saved.accommodation,'ACNS');await w.openStudent(third,'data');assert.equal(byId('fAccommodation').value,'ACNS');w.closeModal();
   w.showSection('examSchedule');await waitFor(()=>row(third)?.textContent.includes('Aula Específica'),'room badge');
   w.createScheduleReport=async report=>{downloads.push({scheduleReport:report});return new w.Uint8Array([4,5,6]);};
   byId('scheduleSearch').value='00001';byId('scheduleSearch').dispatchEvent(new w.Event('input',{bubbles:true}));byId('printSchedule').click();await waitFor(()=>downloads.some(x=>x.scheduleReport),'schedule PDF');assert.equal(downloads.find(x=>x.scheduleReport).scheduleReport.rows.length,3);assert.ok(downloads.some(x=>x.name?.startsWith('Informe_Horarios_')));
  });
  assert.deepEqual(alerts,[]);
 }finally{dom.window.close();await db.close();}
});
