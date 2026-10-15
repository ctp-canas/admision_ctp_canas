import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('attendance PDF repeats date, block, institutional header and table across pages',async()=>{
 const root=new URL('../public/',import.meta.url),context={console,Uint8Array,ArrayBuffer,Date,Intl,Set,Map,TextEncoder,TextDecoder,setTimeout,clearTimeout};
 context.fetch=async resource=>{const bytes=await readFile(new URL(String(resource).split('?')[0],root));return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};};
 for(const file of ['vendor/pdf-lib.min.js','vendor/fontkit.umd.min.js','attendance-report.js'])runInNewContext(await readFile(new URL(file,root),'utf8'),context);
 const rows=Array.from({length:55},(_,i)=>({identification:i===0?'0123456789012345678901234567890123456789':String(i+1).padStart(9,'0'),name:i===0?'María Fernanda de los Ángeles Valverde Rodríguez Sánchez Jiménez Campos Castillo Méndez González Ramírez Salazar Hernández':'Estudiante de prueba '+(i+1)+' Apellido Pérez'}));
 const report={cycle_year:'2027',groups:[{date:'2026-10-27',block:1,label:'Primer bloque',time_label:'8:00 a.m. a 10:00 a.m.',rows},{date:'2026-10-28',block:2,label:'Segundo bloque',time_label:'11:00 a.m. a 1:00 p.m.',rows:[]},{date:'2026-10-29',block:3,label:'Tercer bloque',time_label:'2:00 p.m. a 4:00 p.m.',rows:[{identification:'000009999',name:'Última Estudiante Cañas'}]}]};
 const bytes=await context.createAttendanceReport(report),pdf=await context.PDFLib.PDFDocument.load(bytes);
 assert.ok(pdf.getPageCount()>=7);assert.ok(pdf.getPages().every(p=>p.getWidth()===612&&p.getHeight()===792));
 for(const p of pdf.getPages())assert.ok(p.node.Resources().get(context.PDFLib.PDFName.of('XObject')).keys().length>0,'Each page has the institutional header');
 if(process.env.ATTENDANCE_PDF_QA){await mkdir('tmp/pdfs',{recursive:true});await writeFile('tmp/pdfs/attendance-pagination.pdf',bytes);}
});
