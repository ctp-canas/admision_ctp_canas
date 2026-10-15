window.ExamSchedule=(()=>{
 const el=id=>document.getElementById(id);
 let data=null,visible=[],selected=new Set(),generation=0;
 const dateLabel=date=>new Intl.DateTimeFormat('es-CR',{day:'numeric',month:'long',year:'numeric',timeZone:'America/Costa_Rica'}).format(new Date(date+'T12:00:00-06:00'));
 function notice(message,error=false){el('scheduleMsg').textContent=message;el('scheduleMsg').className=message?'notice '+(error?'error':'success'):'';}
 function filters(){return {date:el('scheduleDate').value,block:el('scheduleBlock').value,state:el('scheduleState').value,q:el('scheduleSearch').value.trim().toLocaleLowerCase('es')};}
 function selection(){el('assignSchedule').disabled=!selected.size;el('scheduleSelection').textContent=selected.size+' seleccionados';const all=el('selectScheduleAll');all.checked=visible.length>0&&selected.size===visible.length;all.indeterminate=selected.size>0&&selected.size<visible.length;all.disabled=!visible.length;}
 function render(){
  if(!data)return;
  const f=filters();selected.clear();
  visible=data.rows.filter(r=>(!f.date||r.date===f.date)&&(!f.block||String(r.block)===f.block)&&(!f.state||(f.state==='assigned'?r.date:!r.date))&&(!f.q||(r.identification+' '+r.name).toLocaleLowerCase('es').includes(f.q)));
  el('scheduleRows').innerHTML=visible.map(r=>{const block=data.blocks.find(b=>b.id===r.block);return `<tr><td><input type="checkbox" data-schedule-check="${r.id}" aria-label="Seleccionar a ${esc(r.name)}"></td><td>${esc(r.identification)}</td><td class="wrap"><strong>${esc(r.name)}</strong></td><td>${r.date?esc(dateLabel(r.date)):'<span class="badge gray">Sin asignar</span>'}</td><td class="wrap">${block?esc(block.label)+'<br><span class="small muted">'+esc(block.time_label)+'</span>':'—'}</td><td><button class="btn btn-outline" data-schedule-edit="${r.id}">${r.date?'Cambiar':'Asignar'}</button></td></tr>`;}).join('')||'<tr><td colspan="6" class="muted">No hay estudiantes que coincidan con estos filtros.</td></tr>';
  el('scheduleCount').textContent=visible.length+' de '+data.rows.length+' estudiantes';selection();
 }
 async function load(){
  const request=++generation;el('refreshSchedule').disabled=true;
  try{
   const result=await api('/api/admin/exam-schedule');if(request!==generation)return;data=result;notice('');
   const f=filters();
   el('scheduleDate').innerHTML='<option value="">Todos los días</option>'+data.dates.map(d=>`<option value="${d}">${esc(dateLabel(d))}</option>`).join('');
   el('scheduleBlock').innerHTML='<option value="">Todos los bloques</option>'+data.blocks.map(b=>`<option value="${b.id}">${esc(b.label)} · ${esc(b.time_label)}</option>`).join('');
   el('scheduleDate').value=data.dates.includes(f.date)?f.date:'';el('scheduleBlock').value=data.blocks.some(b=>String(b.id)===f.block)?f.block:'';
   el('scheduleSummary').innerHTML=[['Estudiantes registrados',data.summary.total],['Con horario asignado',data.summary.assigned],['Sin asignar',data.summary.unassigned]].map(([label,n])=>`<div class="stat-card"><div class="value">${n}</div><div class="label">${label}</div></div>`).join('');
   el('scheduleSlots').innerHTML=data.dates.map(date=>`<div class="schedule-day"><h4>${esc(dateLabel(date))}</h4>${data.blocks.map(b=>{const count=data.summary.by_slot.find(s=>s.date===date&&s.block===b.id)?.count||0;return `<button type="button" class="schedule-slot" data-slot-date="${date}" data-slot-block="${b.id}"><strong>${esc(b.label)}</strong><span>${esc(b.time_label)}</span><span>${count} estudiantes</span></button>`;}).join('')}</div>`).join('');render();
  }catch(error){if(request===generation){data=null;selected.clear();visible=[];el('scheduleRows').innerHTML='<tr><td colspan="6">No fue posible cargar los horarios. Pulse Actualizar lista.</td></tr>';selection();notice(error.message,true);}}
  finally{if(request===generation)el('refreshSchedule').disabled=false;}
 }
 function edit(rows){
  if(!rows.length)return;
  const same=rows.every(r=>r.date===rows[0].date&&r.block===rows[0].block),f=filters();
  const date=same&&rows[0].date?rows[0].date:f.date||data.dates[0],block=same&&rows[0].block?rows[0].block:Number(f.block)||1;
  const versions=rows.map(r=>({id:r.id,version:r.version}));
  modal(`${head(rows.length===1?'Horario de '+rows[0].name:'Asignar horario a '+rows.length+' estudiantes')}<div class="modal-body"><p>Seleccione la fecha y el bloque. Horarios de Costa Rica.</p><div class="form-grid"><div class="field"><label for="assignExamDate">Fecha de la prueba</label><select id="assignExamDate">${data.dates.map(d=>`<option value="${d}" ${d===date?'selected':''}>${esc(dateLabel(d))}</option>`).join('')}</select></div><div class="field"><label for="assignExamBlock">Bloque</label><select id="assignExamBlock">${data.blocks.map(b=>`<option value="${b.id}" ${b.id===block?'selected':''}>${esc(b.label)} · ${esc(b.time_label)}</option>`).join('')}</select></div></div><div id="assignExamMsg" aria-live="polite"></div></div><div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>${rows.some(r=>r.date)?'<button class="btn btn-outline" id="clearExamSchedule">Quitar asignación</button>':''}<button class="btn btn-primary" id="saveExamSchedule">Guardar horario</button></div>`,true);
  async function save(clear=false){
   if(clear&&!confirm('¿Desea quitar la asignación de '+rows.length+' estudiante(s)?'))return;
   const buttons=[el('saveExamSchedule'),el('clearExamSchedule')].filter(Boolean);buttons.forEach(b=>b.disabled=true);
   try{const result=await api('/api/admin/exam-schedule',{method:'PUT',body:{students:versions,date:clear?null:el('assignExamDate').value,block:clear?null:Number(el('assignExamBlock').value)}});closeModal();await load();if(data)notice(result.updated+' asignación(es) '+(clear?'eliminada(s).':'guardada(s).'));}
   catch(error){const msg=el('assignExamMsg');if(msg){msg.textContent=error.message;msg.className='notice error';buttons.forEach(b=>b.disabled=false);}}
  }
  el('saveExamSchedule').onclick=()=>save();if(el('clearExamSchedule'))el('clearExamSchedule').onclick=()=>save(true);
 }
 el('refreshSchedule').addEventListener('click',load);
 ['scheduleDate','scheduleBlock','scheduleState'].forEach(id=>el(id).addEventListener('change',render));el('scheduleSearch').addEventListener('input',render);
 el('selectScheduleAll').addEventListener('change',event=>{selected=new Set(event.target.checked?visible.map(r=>r.id):[]);el('scheduleRows').querySelectorAll('[data-schedule-check]').forEach(c=>c.checked=event.target.checked);selection();});
 el('scheduleRows').addEventListener('change',event=>{const id=event.target.dataset.scheduleCheck;if(!id)return;event.target.checked?selected.add(Number(id)):selected.delete(Number(id));selection();});
 el('scheduleRows').addEventListener('click',event=>{const b=event.target.closest('[data-schedule-edit]');if(b&&data)edit(data.rows.filter(r=>r.id===Number(b.dataset.scheduleEdit)));});
 el('assignSchedule').addEventListener('click',()=>{if(data)edit(data.rows.filter(r=>selected.has(r.id)));});
 el('scheduleSlots').addEventListener('click',event=>{const b=event.target.closest('[data-slot-date]');if(!b)return;el('scheduleDate').value=b.dataset.slotDate;el('scheduleBlock').value=b.dataset.slotBlock;el('scheduleState').value='';el('scheduleSearch').value='';render();el('scheduleDate').focus();});
 el('printAttendance').addEventListener('click',async()=>{
  const button=el('printAttendance');button.disabled=true;notice('Preparando las listas de asistencia…');
  try{const f=filters(),params=new URLSearchParams();if(f.date)params.set('date',f.date);if(f.block)params.set('block',f.block);const report=await api('/api/admin/exam-attendance?'+params);downloadFile(await createAttendanceReport(report),'Listas_Asistencia_Admision_'+report.cycle_year+'_'+(f.date||'Todos_los_dias')+(f.block?'_Bloque_'+f.block:'')+'.pdf','application/pdf');notice('PDF listo. Abra el archivo descargado e imprímalo para recoger las firmas.');}
  catch(error){notice(error.message,true);}finally{button.disabled=false;}
 });
 return {load};
})();
