async function createReport(data,{forceDraft=false}={}){
 const {PDFDocument,rgb}=PDFLib;
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const [regular,boldBytes]=await Promise.all(['assets/fonts/Vera.ttf','assets/fonts/VeraBd.ttf'].map(p=>fetch(p).then(r=>r.arrayBuffer())));
 const font=await pdf.embedFont(regular,{subset:true}),bold=await pdf.embedFont(boldBytes,{subset:true});
 const header=await pdf.embedPng(await fetch('assets/encabezado-institucional.png').then(r=>r.arrayBuffer()));
 const draft=forceDraft||data.draft,W=792,H=612,M=26,navy=rgb(.07,.25,.27),gray=rgb(.35,.44,.46),line=rgb(.82,.88,.86),gold=rgb(.74,.57,.19);
 let page,y;const pages=[];
 const plain=value=>String(value??'-').replace(/[\r\n]/g,' ').replace(/[^\x20-\x7e\xa0-\xff]/g,'-');
 const text=(value,x,yy,size=8,f=font,color=navy)=>page.drawText(plain(value),{x,y:yy,size,font:f,color});
 const width=(v,f,size)=>f.widthOfTextAtSize(plain(v),size);
 const centered=(value,yy,size=8,f=font,color=navy)=>text(value,(W-width(value,f,size))/2,yy,size,f,color);
 const fit=(v,w,size=8,f=font)=>{let s=plain(v);if(width(s,f,size)<=w)return s;while(s&&width(s+'...',f,size)>w)s=s.slice(0,-1);return s+'...';};
 const wrap=(v,w,size=8)=>{const result=[];let current='';for(const word of plain(v).split(/\s+/)){if(width((current?current+' ':'')+word,font,size)>w&&current){result.push(current);current=word;}else current+=(current?' ':'')+word;}result.push(current);return result.map(x=>fit(x,w,size));};
 const cols=[42,75,208,68,60,63,60,65,99],headers=['Puesto','Identificación','Nombre completo','Promedio','Aporte 60%','Prueba','Aporte 40%','Nota final','Estado'];
 const tableHead=()=>{page.drawRectangle({x:M,y:y-21,width:W-2*M,height:24,color:navy});let x=M;headers.forEach((h,i)=>{text(fit(h,cols[i]-8,7.2,bold),x+4,y-12,7.2,bold,rgb(1,1,1));x+=cols[i];});y-=28;};
 const addPage=(first=false,withTable=true)=>{
  page=pdf.addPage([W,H]);pages.push(page);
  const hw=470,hh=hw*header.height/header.width;page.drawImage(header,{x:(W-hw)/2,y:H-M-hh,width:hw,height:hh});
  page.drawLine({start:{x:(W-70)/2,y:H-91},end:{x:(W+70)/2,y:H-91},thickness:2,color:gold});
  centered((draft?'BORRADOR · ':'')+'Informe final de resultados de admisión',H-112,14,bold);
  centered('Sétimo año '+data.config.cycle_year+' · Colegio Técnico Profesional de Cañas',H-130,10);
  if(draft)centered('Proceso con expedientes incompletos o decisiones pendientes',H-145,8,font,gray);
  y=H-157;
  if(first){const rows=data.rows,counts=[['Registrados',rows.length],['Completos',rows.filter(r=>r.final_score!=null).length],['Incompletos',rows.filter(r=>r.final_score==null).length],['Cupos',data.config.slots],['Admitidos',rows.filter(r=>r.status==='ADMITIDO').length],['No admitidos',rows.filter(r=>r.status==='NO_ADMITIDO').length],['Renuncias',rows.filter(r=>r.status==='RENUNCIO').length],['Pendientes',rows.filter(r=>!r.status||r.status.startsWith('PENDIENTE')).length]];
   counts.forEach(([label,n],i)=>text(label+': '+n,M+(i%4)*180,y-Math.floor(i/4)*18,8,bold));y-=52;
  }if(withTable)tableHead();
 };
 addPage(true);const lastAdmitted=data.rows.findLastIndex(r=>r.status==='ADMITIDO');
 data.rows.forEach((r,index)=>{
  const names=wrap(r.name,cols[2]-8),states=wrap(r.status?.replaceAll('_',' ')||'INCOMPLETO',cols[8]-8,7),rowH=Math.max(25,Math.max(names.length,states.length)*11+9);
  if(y-rowH<95)addPage();
  if(index%2===0)page.drawRectangle({x:M,y:y-rowH+5,width:W-2*M,height:rowH,color:rgb(.96,.97,.98)});
  const values=[r.position,r.identification,r.name,r.academic_avg_display,r.academic_component_display,r.exam_display,r.exam_component_display,r.final_display,r.status?.replaceAll('_',' ')||'INCOMPLETO'];
  let x=M;values.forEach((v,i)=>{const lines=i===2?names:i===8?states:[fit(v,cols[i]-8,i===1?7.5:8)];lines.forEach((l,j)=>text(l,x+4,y-9-j*11,i===8?7:8,i===7?bold:font));x+=cols[i];});
  page.drawLine({start:{x:M,y:y-rowH+4},end:{x:W-M,y:y-rowH+4},thickness:.4,color:line});y-=rowH;
  if(index===lastAdmitted){if(y<110)addPage();text('FIN DE ESTUDIANTES ADMITIDOS',M+4,y-10,8,bold);y-=26;}
 });
 if(y<155)addPage(false,false);
 if(data.tie_resolved){text('El empate que afectaba el corte fue resuelto mediante una decisión administrativa registrada.',M,y-16,8);y-=28;}
 page.drawLine({start:{x:M+40,y:y-45},end:{x:M+280,y:y-45},thickness:.7,color:gray});page.drawLine({start:{x:W-M-280,y:y-45},end:{x:W-M-40,y:y-45},thickness:.7,color:gray});
 text('Dirección',M+115,y-59,9);text('Responsable del proceso',W-M-225,y-59,9);
 pages.forEach((p,i)=>{page=p;text('Colegio Técnico Profesional de Cañas',M,22,7,font,gray);text('Página '+(i+1)+' de '+pages.length,W-M-90,22,7,font,gray);});return pdf.save();
}
async function downloadReport(forceDraft){
 const data=await admissionRequest('/api/admin/report');
 if(data.draft&&!forceDraft)throw new Error('El informe definitivo requiere corte resuelto y todos los expedientes completos. Genere un borrador.');
 downloadFile(await createReport(data,{forceDraft}),'Informe_Admision_CTP_Canas_'+data.config.cycle_year+(forceDraft?'_Borrador':'')+'.pdf','application/pdf');
}
