import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('result consultation displays the server score for both decisions without inventing missing grades',async()=>{
 const elements={};
 for(const id of ['resultForm','showPassword','password','identification','consultBtn','resultBox','cycleYear','availability']){
  elements[id]={value:'',handlers:{},addEventListener(type,handler){this.handlers[type]=handler;},focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;}};
 }
 let result;
 const context={document:{querySelector:selector=>elements[selector.slice(1)],querySelectorAll:()=>[]},Intl,Date,setInterval(){},matchMedia:()=>({matches:true}),async admissionRequest(url,options){
  if(url==='/api/public/status')return {cycle_year:2027,available:true};
  assert.equal(options.body.identification,'PRUEBA-NOTA');assert.equal(options.body.password,'AB12CD');return result;
 }};
 runInNewContext(await readFile(new URL('../public/public.js',import.meta.url),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 async function consult(status,final_score){
  result={name:'Estudiante García Rojas',instructions:'Información de la institución',status,final_score};
  elements.identification.value=' PRUEBA-NOTA ';elements.password.value='ab12cd';
  await elements.resultForm.handlers.submit({preventDefault(){}});
  assert.equal(elements.password.value,'');assert.equal(elements.resultBox.focused,true);assert.equal(elements.resultBox.scrolled,true);
  return elements.resultBox.innerHTML;
 }
 for(const status of ['ADMITIDO','NO_ADMITIDO']){
  for(const score of ['0.0000','100.0000','86.2149']){
   const html=await consult(status,score);
   assert.ok(html.includes('<p>Nota final de admisión</p>'));
   assert.ok(html.includes('<strong>'+score.replace('.',',')+'</strong>'));
   assert.ok(html.includes('Sobre 100 puntos'));assert.ok(html.includes(status.replace('_',' ')));
  }
 }
 for(const score of [undefined,null,'','<img src=x onerror=alert(1)>']){
  const html=await consult('NO_ADMITIDO',score);assert.ok(html.includes('Nota no disponible'));assert.ok(!html.includes('0,0000'));assert.ok(!html.includes('<img'));
 }
 for(const status of ['PENDIENTE','RENUNCIO'])assert.ok(!(await consult(status,null)).includes('result-score'));
 result={name:'<script>alert(1)</script>',instructions:'<img src=x onerror=alert(1)>',status:'ADMITIDO',final_score:'90.0000'};
 elements.identification.value='PRUEBA-NOTA';elements.password.value='AB12CD';
 await elements.resultForm.handlers.submit({preventDefault(){}});
 assert.ok(elements.resultBox.innerHTML.includes('&lt;script&gt;'));assert.ok(!elements.resultBox.innerHTML.includes('<script>'));assert.ok(!elements.resultBox.innerHTML.includes('<img'));
});
