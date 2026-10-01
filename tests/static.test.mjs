import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
test('every local HTML asset/link works under the GitHub project path',async()=>{
 const root=new URL('../public/',import.meta.url);
 for(const name of ['index.html','admin.html','admin-login.html']){
  const html=await readFile(new URL(name,root),'utf8');
  for(const [,value] of html.matchAll(/(?:src|href)="([^"]+)"/g)){
   if(value.startsWith('#')||/^https?:/.test(value))continue;
   assert.ok(!value.startsWith('/'),name+' has an absolute link: '+value);
   assert.ok((await stat(new URL(value,root))).isFile(),name+' missing '+value);
  }
 }
 const config=await readFile(new URL('config.js',root),'utf8');
 const context={window:{}};runInNewContext(config,context);
 assert.deepEqual(Object.keys(context.window.ADMISSION_CONFIG),['apiBase']);
 assert.equal(typeof context.window.ADMISSION_CONFIG.apiBase,'string');
});
