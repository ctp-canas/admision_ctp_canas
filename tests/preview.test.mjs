import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('preview survives missing assets and malformed URLs, then serves login again',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'admission-preview-'));
 const script=fileURLToPath(new URL('../scripts/preview.mjs',import.meta.url));
 const child=spawn(process.execPath,[script],{cwd:temp,env:{...process.env,PORT:'0',LOCAL_ADMIN_PASSWORD:'PreviewRegression-2027'},stdio:['ignore','pipe','pipe']});
 let output='';let errors='';
 child.stderr.on('data',d=>{errors+=d.toString()});
 const exited=new Promise(resolve=>child.once('exit',resolve));
 try{
  const base=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Preview startup timed out: '+errors)),20000);
   child.stdout.on('data',d=>{output+=d.toString();const match=output.match(/Vista previa local: (http:\/\/127\.0\.0\.1:\d+)\//);if(match){clearTimeout(timer);resolve(match[1])}});
   child.once('error',e=>{clearTimeout(timer);reject(e)});
   child.once('exit',code=>{clearTimeout(timer);reject(new Error('Preview exited: '+code+' '+errors))});
  });
  for(const missing of ['/favicon.ico','/admision-2027/archivo-inexistente.js','/admision-2027/assets/no-existe.png']){
   const response=await fetch(base+missing);
   assert.equal(response.status,404);assert.equal(await response.text(),'No encontrado');
   const login=await fetch(base+'/admision-2027/admin-login.html');
   assert.equal(login.status,200);assert.match(await login.text(),/<!doctype html>/i);
  }
  const malformed=await fetch(base+'/admision-2027/%E0%A4%A');
  assert.equal(malformed.status,400);await malformed.text();
  const index=await fetch(base+'/admision-2027/');
  assert.equal(index.status,200);await index.text();
  const config=await fetch(base+'/admision-2027/config.js');
  assert.match(await config.text(),new RegExp(base.replaceAll('.','\\.')));
  assert.ok(!errors.includes('ERR_HTTP_HEADERS_SENT'),errors);
 }finally{
  if(child.exitCode===null){child.kill('SIGTERM');await exited;}
  await rm(temp,{recursive:true,force:true});
 }
});
