import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {localBackend} from '../backend/local.mjs';
const port=Number(process.env.PORT||8080);
const password=process.env.LOCAL_ADMIN_PASSWORD;
if(!password)throw new Error('Configure LOCAL_ADMIN_PASSWORD (mínimo 12 caracteres). Esta vista previa es local, sin datos de producción.');
await mkdir('data',{recursive:true});
const {handler}=await localBackend({persist:'./data/preview-db',password});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpeg':'image/jpeg','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
const root=fileURLToPath(new URL('../public/',import.meta.url));
const server=http.createServer(async(req,res)=>{
 try{
  const actualPort=server.address().port;
  const url=new URL(req.url,'http://127.0.0.1:'+actualPort);
  if(url.pathname.startsWith('/api/')){
   const chunks=[];let length=0;
   for await(const c of req){length+=c.length;if(length>16000000){res.writeHead(413);res.end();return;}chunks.push(c);}
   const response=await handler(new Request(url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks),duplex:'half'}:{})}));
   const body=Buffer.from(await response.arrayBuffer());
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(body);return;
  }
  let filename=decodeURIComponent(url.pathname).replace(/^\/(admision-2027\/)?/,'')||'index.html';
  if(filename==='config.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end('window.ADMISSION_CONFIG={apiBase:"http://127.0.0.1:'+actualPort+'"}');return;}
  const file=path.resolve(root,filename);
  if(!file.startsWith(path.resolve(root)+path.sep)){res.writeHead(403);res.end();return;}
  const body=await readFile(file);
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(body);
 }catch(error){
  if(res.destroyed||res.writableEnded)return;
  if(res.headersSent){res.destroy();return;}
  const missing=['ENOENT','ENOTDIR','EISDIR'].includes(error.code);
  const status=error instanceof URIError?400:missing?404:500;
  res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});
  res.end(status===404?'No encontrado':status===400?'Dirección no válida':'Error de vista previa');
 }
}).listen(port,'127.0.0.1',()=>console.log('Vista previa local: http://127.0.0.1:'+server.address().port+'/admision-2027/'));
