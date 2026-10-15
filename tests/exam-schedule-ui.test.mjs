import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../public/exam-schedule.js',import.meta.url),'utf8');
function page(){
 const ids=['refreshSchedule','scheduleDate','scheduleBlock','scheduleState','scheduleSearch','scheduleSummary','scheduleSlots','scheduleRows','scheduleCount','scheduleMsg','scheduleSelection','selectScheduleAll','assignSchedule','printAttendance','assignExamDate','assignExamBlock','assignExamMsg','saveExamSchedule','clearExamSchedule','assignExamMode','assignRegularFields','assignCustomFields','assignCustomDate','assignCustomStart','assignCustomEnd','assignCustomReason'];
 const elements=Object.fromEntries(ids.map(id=>[id,{value:'',innerHTML:'',textContent:'',disabled:false,checked:false,events:{},addEventListener(name,fn){this.events[name]=fn;},querySelectorAll(){return [];},focus(){}}]));
 const rows=[{id:1,identification:'00001',name:'Ana <script>prueba</script>',date:null,block:null,version:0},{id:2,identification:'00002',name:'Beatriz Alfaro',date:'2026-10-28',block:2,version:3},{id:3,identification:'00003',name:'Carlos Mora',date:null,block:null,version:0}];
 const data={cycle_year:'2027',dates:['2026-10-27','2026-10-28','2026-10-29'],blocks:[{id:1,label:'Primer bloque',time_label:'8:00 a.m. a 10:00 a.m.'},{id:2,label:'Segundo bloque',time_label:'11:00 a.m. a 1:00 p.m.'},{id:3,label:'Tercer bloque',time_label:'2:00 p.m. a 4:00 p.m.'}],rows,summary:{total:3,assigned:1,unassigned:2,by_slot:[]}};
 const requests=[],downloads=[],dialogs=[];let closed=0;
 const context={window:{},document:{getElementById:id=>elements[id]},Intl,Date,URLSearchParams,Set,console,esc:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),head:value=>value,modal(html){dialogs.push(html);},closeModal(){closed++;},confirm(){return true;},async api(path,options){requests.push({path,options});if(options?.method==='PUT')return {updated:1};if(path.startsWith('/api/admin/exam-attendance'))return {cycle_year:'2027',groups:[]};return structuredClone(data);},async createAttendanceReport(report){return new Uint8Array([1,2,3]);},downloadFile(bytes,name,type){downloads.push({bytes,name,type});}};
 runInNewContext(source,context);
 const event=(id,name,target={})=>elements[id].events[name]({target});
 return {elements,requests,downloads,dialogs,closed:()=>closed,load:context.window.ExamSchedule.load,event};
}
test('schedule filters, selection and bulk save preserve per-student versions and escape names',async()=>{
 const p=page();await p.load();assert.ok(p.elements.scheduleRows.innerHTML.includes('&lt;script&gt;'));assert.equal(p.elements.assignSchedule.disabled,true);
 p.elements.scheduleState.value='unassigned';p.event('scheduleState','change');assert.equal(p.elements.scheduleCount.textContent,'2 de 3 estudiantes');assert.ok(!p.elements.scheduleRows.innerHTML.includes('Beatriz'));
 p.event('selectScheduleAll','change',{checked:true});assert.equal(p.elements.scheduleSelection.textContent,'2 seleccionados');assert.equal(p.elements.assignSchedule.disabled,false);
 p.event('assignSchedule','click');assert.ok(p.dialogs[0].includes('2 estudiantes'));assert.ok(!p.dialogs[0].includes('Quitar asignación'));
 p.elements.assignExamDate.value='2026-10-29';p.elements.assignExamBlock.value='3';await p.elements.saveExamSchedule.onclick();
 const saved=p.requests.find(r=>r.options?.method==='PUT');assert.equal(saved.options.body.date,'2026-10-29');assert.equal(saved.options.body.block,3);assert.deepEqual(Array.from(saved.options.body.students,s=>[s.id,s.version]),[[1,0],[3,0]]);assert.equal(p.closed(),1);
 p.event('selectScheduleAll','change',{checked:true});p.elements.scheduleSearch.value='Carlos';p.event('scheduleSearch','input');assert.equal(p.elements.scheduleSelection.textContent,'0 seleccionados');assert.equal(p.elements.scheduleCount.textContent,'1 de 3 estudiantes');
});
test('attendance printing filters only by date/block so a text search cannot omit a signature row',async()=>{
 const p=page();await p.load();p.elements.scheduleDate.value='2026-10-28';p.elements.scheduleBlock.value='2';p.elements.scheduleSearch.value='nombre sin coincidencias';p.event('scheduleSearch','input');
 assert.equal(p.elements.scheduleCount.textContent,'0 de 3 estudiantes');await p.event('printAttendance','click');
 assert.equal(p.requests.at(-1).path,'/api/admin/exam-attendance?date=2026-10-28&block=2');assert.equal(p.downloads[0].name,'Listas_Asistencia_Admision_2027_2026-10-28_Bloque_2.pdf');assert.equal(p.elements.printAttendance.disabled,false);
 p.elements.scheduleDate.value='';p.elements.scheduleBlock.value='';await p.event('printAttendance','click');assert.equal(p.requests.at(-1).path,'/api/admin/exam-attendance?');
});
test('custom scheduling validates the reason, sends the local date/time, and provides a custom attendance filter',async()=>{
 const p=page();await p.load();assert.ok(p.elements.scheduleBlock.innerHTML.includes('Horarios reprogramados'));
 p.event('scheduleRows','click',{closest(){return {dataset:{scheduleEdit:'2'}};}});
 p.elements.assignExamMode.value='custom';p.elements.assignExamMode.onchange();assert.equal(p.elements.assignRegularFields.hidden,true);assert.equal(p.elements.assignCustomFields.hidden,false);
 p.elements.assignCustomDate.value='2026-11-03';p.elements.assignCustomStart.value='09:15';p.elements.assignCustomStart.onchange();assert.equal(p.elements.assignCustomEnd.value,'11:15');
 p.elements.assignCustomReason.value='';await p.elements.saveExamSchedule.onclick();assert.equal(p.requests.filter(r=>r.options?.method==='PUT').length,0);
 p.elements.assignCustomReason.value='Cita médica justificada';await p.elements.saveExamSchedule.onclick();
 const sent=p.requests.find(r=>r.options?.method==='PUT').options.body;assert.equal(sent.mode,'custom');assert.equal(sent.date,'2026-11-03');assert.equal(sent.block,null);assert.equal(sent.start,'09:15');assert.equal(sent.end,'11:15');assert.equal(sent.reason,'Cita médica justificada');assert.deepEqual(Array.from(sent.students,s=>[s.id,s.version]),[[2,3]]);
 p.elements.scheduleBlock.value='custom';await p.event('printAttendance','click');assert.ok(p.requests.at(-1).path.includes('block=custom'));assert.ok(p.downloads[0].name.endsWith('_Reprogramados.pdf'));
});
