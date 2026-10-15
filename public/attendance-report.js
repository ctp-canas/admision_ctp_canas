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
  text('Estudiantes asignados al bloque: '+group.rows.length,M,H-179,9);
  y=H-194;page.drawRectangle({x:M,y:y-25,width:W-2*M,height:25,color:navy});
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
