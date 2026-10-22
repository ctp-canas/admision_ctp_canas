import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
async function environment(){
 const root=new URL('../public/',import.meta.url),context={console,Uint8Array,ArrayBuffer,Date,Intl,Set,Map,TextEncoder,TextDecoder,setTimeout,clearTimeout},drawn=[];
 context.fetch=async resource=>{const bytes=await readFile(new URL(String(resource).split('?')[0],root));return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};};
 for(const file of ['vendor/pdf-lib.min.js','vendor/fontkit.umd.min.js','attendance-report.js','reports.js'])runInNewContext(await readFile(new URL(file,root),'utf8'),context);
 const original=context.PDFLib.PDFPage.prototype.drawText;context.PDFLib.PDFPage.prototype.drawText=function(value,opts){drawn.push({value,...opts,page:this});assert.ok(opts.x>=0&&opts.y>=0,'text stays on the page');assert.ok(opts.x+opts.font.widthOfTextAtSize(value,opts.size)<=this.getWidth()+.1,'text fits page width');return original.call(this,value,opts);};
 return {context,drawn};
}
async function save(name,bytes){if(process.env.ATTENDANCE_PDF_QA){await mkdir('tmp/pdfs',{recursive:true});await writeFile('tmp/pdfs/'+name,bytes);}}
test('alphabetical schedule PDF paginates with dates, times, rooms and pending appointments',async()=>{
 const {context:c,drawn}=await environment();
 const rows=Array.from({length:65},(_,i)=>({id:i+1,identification:i===0?'0123456789012345678901234567890123456789':String(i+1).padStart(9,'0'),first_name:'María Fernanda de los Ángeles',last_name1:i===0?'Álvarez':'Zúñiga',last_name2:'Rodríguez Campos',name:'Nombre de prueba',date:i===2?null:i===1?'2026-11-03':'2026-10-27',block:i<2||i===2?null:1,start:'09:15',end:'11:15',room:i%2?'Aula regular':'Aula Específica'})).reverse();
 const bytes=await c.createScheduleReport({cycle_year:'2027',blocks:[{id:1,time_label:'8:00 a.m. a 10:00 a.m.'}],rows}),pdf=await c.PDFLib.PDFDocument.load(bytes);
 assert.ok(pdf.getPageCount()>3);assert.ok(drawn.find(x=>x.value==='Sin cita'));assert.ok(drawn.find(x=>x.value==='03/11/2026'));assert.ok(drawn.find(x=>x.value.includes('Específica')));assert.ok(!drawn.some(x=>/ACS|ACNS|adecuación/i.test(x.value)));const ids=drawn.filter(x=>rows.some(r=>r.identification===x.value)).map(x=>x.value);assert.equal(ids.length,64,'long ID is wrapped and others remain complete');assert.ok(drawn.findIndex(x=>x.value.startsWith('Álvarez'))<drawn.findIndex(x=>x.value.startsWith('Zúñiga')));
 await save('schedule-alphabetical.pdf',bytes);
});
test('final report adds accommodation codes, keeps score ranking and fits all ten columns',async()=>{
 const {context:c,drawn}=await environment();
 const rows=Array.from({length:58},(_,i)=>({position:i+1,identification:String(i+1).padStart(9,'0'),name:(i===0?'Zúñiga':'Álvarez')+' María Fernanda Rodríguez Campos Castillo',accommodation:['NP','ACNS','ACS'][i%3],academic_avg_display:'100.0000',academic_component_display:'60.0000',exam_display:'100.0000',exam_component_display:'40.0000',final_display:'100.0000',final_score:100,status:i<30?'ADMITIDO':i===40?'PENDIENTE_EMPATE':'NO_ADMITIDO'}));
 const bytes=await c.createReport({config:{cycle_year:'2027',slots:30},rows,draft:true}),pdf=await c.PDFLib.PDFDocument.load(bytes);
 assert.ok(pdf.getPageCount()>3);for(const code of ['ACS','ACNS','NP'])assert.ok(drawn.find(x=>x.value===code));assert.ok(drawn.find(x=>x.value==='Adecuación'));assert.ok(drawn.find(x=>x.value==='Estado'));const ids=drawn.filter(x=>/^0{7}\d{2}$/.test(x.value)).map(x=>x.value);assert.deepEqual(ids,rows.map(r=>r.identification));assert.ok(drawn.some(x=>x.value.startsWith('NP: No posee')));await save('final-accommodations.pdf',bytes);
});
test('specific classroom attendance repeats its neutral room heading without condition codes',async()=>{
 const {context:c,drawn}=await environment();const rows=Array.from({length:32},(_,i)=>({identification:'QA'+i,name:'Álvarez Rodríguez María Fernanda de los Ángeles'}));
 const bytes=await c.createAttendanceReport({cycle_year:'2027',groups:[{date:'2026-10-27',label:'Primer bloque',time_label:'8:00 a.m. a 10:00 a.m.',room:'Aula Específica',rows}]}),pdf=await c.PDFLib.PDFDocument.load(bytes);
 assert.equal(drawn.filter(x=>x.value==='Aula Específica').length,pdf.getPageCount());assert.ok(!drawn.some(x=>/ACNS|ACS|adecuaci/i.test(x.value)));assert.equal(drawn.filter(x=>x.value.startsWith('QA')).length,32);await save('attendance-specific.pdf',bytes);
});
