async function createAttendanceReport(data){
 const {PDFDocument,rgb}=PDFLib,pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const [regular,boldBytes,headerBytes]=await Promise.all(['assets/fonts/Vera.ttf','assets/fonts/VeraBd.ttf','assets/encabezado-institucional.png?v=20261005'].map(p=>fetch(p).then(r=>{if(!r.ok)throw new Error('No fue posible cargar los recursos del PDF.');return r.arrayBuffer();})));
 const font=await pdf.embedFont(regular,{subset:true}),bold=await pdf.embedFont(boldBytes,{subset:true}),header=await pdf.embedPng(headerBytes);
 const W=612,H=792,M=36,widths=[32,112,246,150],navy=rgb(.07,.25,.27),gray=rgb(.35,.42,.44),line=rgb(.65,.7,.7);
 let page,y;const pages=[];
 const plain=value=>String(value??'').replace(/[\r\n\t]/g,' ').replace(/[^\x20-\x7e\xa0-\xff]/g,'-');
 const text=(value,x,yy,size=9,f=font,color=navy)=>page.drawText(plain(value),{x,y:yy,size,font:f,color});
 const centered=(value,yy,size=10,f=font)=>text(value,(W-f.widthOfTextAtSize(plain(value),size))/2,yy,size,f);
 const wrap=(value,width,size=9)=>{const lines=[];let current='';for(const char of plain(value)){if(font.widthOfTextAtSize(current+char,size)>width){const space=current.lastIndexOf(' ');if(space>0){lines.push(current.slice(0,space));current=current.slice(space+1)+char;}else{lines.push(current);current=char;}}else current+=char;}if(current)lines.push(current);return lines.length?lines:[''];};
 const newPage=group=>{
  page=pdf.addPage([W,H]);pages.push(page);const hw=470,hh=hw*header.height/header.width;
  page.drawImage(header,{x:(W-hw)/2,y:H-M-hh,width:hw,height:hh});
  centered('LISTA DE ASISTENCIA - PRUEBA DE ADMISIÓN',H-94,12,bold);
  centered('Ingreso a sétimo año '+data.cycle_year,H-113,10);
  const date=new Intl.DateTimeFormat('es-CR',{day:'numeric',month:'long',year:'numeric',timeZone:'America/Costa_Rica'}).format(new Date(group.date+'T12:00:00-06:00'));
  centered(date+' - '+group.label,H-137,11,bold);centered(group.time_label+' - Hora de Costa Rica',H-155,10);
  centered(group.room||'Aula regular',H-175,12,bold);
  text('Estudiantes en esta lista: '+group.rows.length,M,H-196,9);
  y=H-211;page.drawRectangle({x:M,y:y-25,width:W-2*M,height:25,color:navy});
  let x=M;['N.º','Identificación','Nombre completo','Firma del estudiante'].forEach((label,i)=>{text(label,x+6,y-16,8,bold,rgb(1,1,1));x+=widths[i];});y-=25;
 };
 for(const group of data.groups){
  newPage(group);
  if(!group.rows.length){text('Sin estudiantes asignados a este bloque.',M+8,y-25,10);continue;}
  group.rows.forEach((student,index)=>{
   const names=wrap(student.name,widths[2]-14),ids=wrap(student.identification,widths[1]-14,8),height=Math.max(39,Math.max(names.length,ids.length)*12+18);
   if(y-height<86)newPage(group);
   let x=M;const top=y;
   page.drawRectangle({x:M,y:y-height,width:W-2*M,height,borderColor:line,borderWidth:.5});
   widths.slice(0,-1).forEach(w=>{x+=w;page.drawLine({start:{x,y:top},end:{x,y:top-height},thickness:.5,color:line});});
   text(index+1,M+7,y-23,9);ids.forEach((value,j)=>text(value,M+widths[0]+7,y-18-j*12,8));names.forEach((value,j)=>text(value,M+widths[0]+widths[1]+7,y-18-j*12,9));y-=height;
  });
 }
 pages.forEach((p,i)=>{page=p;text('Persona aplicadora: ____________________________________',M,52,9);text('Colegio Técnico Profesional de Cañas',M,25,7,font,gray);text('Página '+(i+1)+' de '+pages.length,W-M-85,25,7,font,gray);});
 return pdf.save();
}

async function createScheduleReport(data){
 const {PDFDocument,rgb}=PDFLib,pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const [regular,boldBytes,headerBytes]=await Promise.all(['assets/fonts/Vera.ttf','assets/fonts/VeraBd.ttf','assets/encabezado-institucional.png?v=20261005'].map(p=>fetch(p).then(r=>{if(!r.ok)throw new Error('No fue posible cargar los recursos del PDF.');return r.arrayBuffer();})));
 const font=await pdf.embedFont(regular,{subset:true}),bold=await pdf.embedFont(boldBytes,{subset:true}),header=await pdf.embedPng(headerBytes);
 const W=612,H=792,M=36,widths=[28,90,190,70,100,62],navy=rgb(.07,.25,.27),gray=rgb(.35,.42,.44),line=rgb(.65,.7,.7),pages=[];let page,y;
 const plain=v=>String(v??'').replace(/[\r\n\t]/g,' ').replace(/[^\x20-\x7e\xa0-\xff]/g,'-');
 const text=(v,x,yy,size=8,f=font,color=navy)=>page.drawText(plain(v),{x,y:yy,size,font:f,color});
 const center=(v,yy,size=10,f=font)=>text(v,(W-f.widthOfTextAtSize(plain(v),size))/2,yy,size,f);
 const wrap=(v,width)=>{const lines=[];let current='';for(const char of plain(v)){if(font.widthOfTextAtSize(current+char,8)>width){const at=current.lastIndexOf(' ');if(at>0){lines.push(current.slice(0,at));current=current.slice(at+1)+char;}else{lines.push(current);current=char;}}else current+=char;}return [...lines,current];};
 const dateLabel=date=>date?date.split('-').reverse().join('/'):'Sin cita';
 const time=v=>{if(!v)return '';const [h,m]=v.split(':').map(Number);return (h%12||12)+':'+String(m).padStart(2,'0')+(h<12?' a.m.':' p.m.');};
 const newPage=()=>{page=pdf.addPage([W,H]);pages.push(page);const hw=470,hh=hw*header.height/header.width;page.drawImage(header,{x:(W-hw)/2,y:H-M-hh,width:hw,height:hh});center('INFORME DE HORARIOS - PRUEBA DE ADMISIÓN',H-94,11,bold);center('Ingreso a sétimo año '+data.cycle_year+' - Hora de Costa Rica',H-114,9);center('Orden alfabético por primer apellido, segundo apellido y nombre',H-133,8);center((data.filter_date?'Fecha: '+dateLabel(data.filter_date):'Todas las fechas')+' - '+(data.filter_block==='custom'?'Reprogramados':data.filter_block?'Bloque '+data.filter_block:'Todos los bloques'),H-151,8);text('Estudiantes: '+data.rows.length,M,H-175);y=H-189;page.drawRectangle({x:M,y:y-24,width:W-2*M,height:24,color:navy});let x=M;['N.º','Identificación','Apellidos y nombre','Fecha','Horario','Aula'].forEach((v,i)=>{text(v,x+5,y-16,7.5,bold,rgb(1,1,1));x+=widths[i];});y-=24;};
 const collator=new Intl.Collator('es-CR',{sensitivity:'base',numeric:true});
 const rows=[...data.rows].sort((a,b)=>{for(const key of ['last_name1','last_name2','first_name']){const order=collator.compare(a[key]||'',b[key]||'');if(order)return order;}return collator.compare(a.name,b.name)||Number(a.id)-Number(b.id);});
 newPage();if(!rows.length)text('Sin estudiantes para la fecha y el bloque seleccionados.',M+6,y-25,9);
 rows.forEach((s,index)=>{const block=data.blocks.find(b=>b.id===s.block),name=[s.last_name1,s.last_name2,s.first_name].filter(Boolean).join(' ')||s.name,values=[index+1,s.identification,name,dateLabel(s.date),s.date?(block?block.time_label:time(s.start)+' a '+time(s.end)):'Pendiente',s.room||'Aula regular'];const cells=values.map((v,i)=>wrap(v,widths[i]-10)),height=Math.max(36,Math.max(...cells.map(c=>c.length))*11+14);if(y-height<64)newPage();let x=M;cells.forEach((lines,i)=>{page.drawRectangle({x,y:y-height,width:widths[i],height,borderColor:line,borderWidth:.4});lines.forEach((v,j)=>text(v,x+5,y-16-j*11));x+=widths[i];});y-=height;});
 pages.forEach((p,i)=>{page=p;text('Colegio Técnico Profesional de Cañas',M,25,7,font,gray);text('Página '+(i+1)+' de '+pages.length,W-M-85,25,7,font,gray);});return pdf.save();
}
