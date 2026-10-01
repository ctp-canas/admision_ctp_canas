import {rm,mkdir,cp,writeFile,readFile} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});await cp('public','dist',{recursive:true});
if(process.env.ADMISSION_API_URL){
 const url=new URL(process.env.ADMISSION_API_URL);
 if(url.protocol!=='https:' && url.hostname!=='127.0.0.1')throw new Error('La API de producción debe usar HTTPS');
 await writeFile('dist/config.js','window.ADMISSION_CONFIG=Object.freeze('+JSON.stringify({apiBase:url.href.replace(/\/$/,'')})+');\n');
}
await writeFile('dist/.nojekyll','');
console.log('Sitio estático generado en dist/');
