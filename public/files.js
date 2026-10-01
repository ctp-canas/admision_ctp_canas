async function readWorkbook(file){
 if(file.size>5000000)throw new Error('El archivo Excel supera 5 MB.');
 const zip=await JSZip.loadAsync(file);
 if(Object.keys(zip.files).length>500)throw new Error('El archivo contiene demasiados elementos.');
 let total=0;
 for(const f of Object.values(zip.files)){total+=f._data?.uncompressedSize||0;if(total>15000000)throw new Error('El contenido del archivo supera el tamaño permitido.');}
 const parse=async name=>{
  const f=zip.file(name);if(!f)throw new Error('El archivo Excel no tiene la estructura requerida.');
  const xml=new DOMParser().parseFromString(await f.async('string'),'application/xml');
  if(xml.querySelector('parsererror'))throw new Error('El archivo Excel no es válido.');return xml;
 };
 const wb=await parse('xl/workbook.xml'),rels=await parse('xl/_rels/workbook.xml.rels');
 const first=wb.getElementsByTagNameNS('*','sheet')[0];if(!first)throw new Error('El libro no contiene hojas.');
 const rid=first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
 const rel=[...rels.getElementsByTagNameNS('*','Relationship')].find(x=>x.getAttribute('Id')===rid);
 let target=rel?.getAttribute('Target');if(!target)throw new Error('No se encontró la primera hoja.');
 target=target.startsWith('/')?target.slice(1):'xl/'+target;
 if(target.includes('..'))throw new Error('Ruta de hoja no válida.');
 const ss=zip.file('xl/sharedStrings.xml')?await parse('xl/sharedStrings.xml'):null;
 const strings=ss?[...ss.getElementsByTagNameNS('*','si')].map(si=>[...si.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join('')):[];
 const sheet=await parse(target),table=[];
 for(const row of sheet.getElementsByTagNameNS('*','row')){
  const cells=[];
  for(const c of row.getElementsByTagNameNS('*','c')){
   const address=c.getAttribute('r')||'';let col=0;
   for(const char of address.replace(/[0-9]/g,''))col=col*26+char.charCodeAt(0)-64;
   if(col>5)continue;
   if(c.getElementsByTagNameNS('*','f').length)throw new Error('No utilice fórmulas en las celdas de importación.');
   const type=c.getAttribute('t'),v=c.getElementsByTagNameNS('*','v')[0]?.textContent||'';
   let value=type==='s'?strings[Number(v)]:type==='inlineStr'?[...c.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join(''):type==='str'?v:v===''?'':Number(v);
   cells[col-1]=value;
  }
  if(cells.some(c=>c!==undefined&&c!==''))table.push({row:Number(row.getAttribute('r')),cells:Array.from({length:5},(_,i)=>cells[i]??'')});
 }
 if(!table.length)throw new Error('El archivo está vacío.');
 const headers=table.shift().cells;
 const expected=['identificacion','nombre','apellido1','apellido2','contrasena'];
 if(JSON.stringify(headers)!==JSON.stringify(expected))throw new Error('Los encabezados deben coincidir exactamente con la plantilla oficial.');
 return {headers,rows:table.map(x=>Object.fromEntries([...expected.map((h,i)=>[h,x.cells[i]]),['_row',x.row]]))};
}
function downloadFile(bytes,name,type='application/octet-stream'){
 const url=URL.createObjectURL(new Blob([bytes],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function downloadBackup(id){
 const data=await admissionRequest('/api/admin/backup/download?id='+encodeURIComponent(id));
 const zip=new JSZip();zip.file('manifest.json',JSON.stringify(data.manifest,null,2));zip.file('datos-cifrados.txt',data.payload);
 downloadFile(await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}),data.name,'application/zip');
}
async function readBackup(file){
 if(!file||file.size>15000000)throw new Error('Seleccione un respaldo ZIP de hasta 15 MB.');
 const zip=await JSZip.loadAsync(file);const manifest=zip.file('manifest.json'),payload=zip.file('datos-cifrados.txt');
 if(!manifest||!payload||(payload._data?.uncompressedSize||0)>15000000)throw new Error('Respaldo no compatible.');
 const meta=JSON.parse(await manifest.async('string'));
 if(meta.app!=='ctp-canas-admission'||meta.version!==2||!meta.encrypted)throw new Error('Versión del respaldo no compatible.');
 return {payload:await payload.async('string'),sha256:meta.sha256};
}
function downloadImportErrors(rows){
 // JSON avoids spreadsheet formula execution and omits all passwords.
 downloadFile(JSON.stringify(rows.filter(r=>r.issues.length),null,2),'Errores_Importacion.json','application/json');
}
