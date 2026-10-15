window.ExamSchedule=(()=>{
 const el=id=>document.getElementById(id);
 let data=null,visible=[],selected=new Set(),generation=0;
 const dateLabel=date=>new Intl.DateTimeFormat('es-CR',{day:'numeric',month:'long',year:'numeric',timeZone:'America/Costa_Rica'}).format(new Date(date+'T12:00:00-06:00'));
 const isCustom=r=>r.kind==='custom'||Boolean(r.date&&r.block==null);
 const timeLabel=value=>{if(!value)return '';const [hour,minute]=value.split(':').map(Number);return (hour%12||12)+':'+String(minute).padStart(2,'0')+(hour<12?' a.m.':' p.m.');};
 function notice(message,error=false){el('scheduleMsg').textContent=message;el('scheduleMsg').className=message?'notice '+(error?'error':'success'):'';}
 function filters(){return {date:el('scheduleDate').value,block:el('scheduleBlock').value,state:el('scheduleState').value,q:el('scheduleSearch').value.trim().toLocaleLowerCase('es')};}
 function selection(){el('assignSchedule').disabled=!selected.size;el('scheduleSelection').textContent=selected.size+' seleccionados';const all=el('selectScheduleAll');all.checked=visible.length>0&&selected.size===visible.length;all.indeterminate=selected.size>0&&selected.size<visible.length;all.disabled=!visible.length;}
 function render(){
  if(!data)return;
  const f=filters();selected.clear();
  visible=data.rows.filter(r=>(!f.date||r.date===f.date)&&(!f.block||(f.block==='custom'?isCustom(r):String(r.block)===f.block))&&(!f.state||(f.state==='assigned'?r.date:!r.date))&&(!f.q||(r.identification+' '+r.name).toLocaleLowerCase('es').includes(f.q)));
  el('scheduleRows').innerHTML=visible.map(r=>{const block=data.blocks.find(b=>b.id===r.block);return `<tr><td><input type="checkbox" data-schedule-check="${r.id}" aria-label="Seleccionar a ${esc(r.name)}"></td><td>${esc(r.identification)}</td><td class="wrap"><strong>${esc(r.name)}</strong></td><td>${r.date?esc(dateLabel(r.date)):'<span class="badge gray">Sin asignar</span>'}</td><td class="wrap">${isCustom(r)?'<span class="badge amber">Reprogramada</span><br>'+esc(timeLabel(r.start)+' a '+timeLabel(r.end)):block?esc(block.label)+'<br><span class="small muted">'+esc(block.time_label)+'</span>':'—'}</td><td class="wrap">${esc(r.reason||'—')}</td><td><button class="btn btn-outline" data-schedule-edit="${r.id}">${r.date?'Cambiar':'Asignar'}</button></td></tr>`;}).join('')||'<tr><td colspan="7" class="muted">No hay estudiantes que coincidan con estos filtros.</td></tr>';
  el('scheduleCount').textContent=visible.length+' de '+data.rows.length+' estudiantes';selection();
 }
 async function load(){
  const request=++generation;el('refreshSchedule').disabled=true;
  try{
   const result=await api('/api/admin/exam-schedule');if(request!==generation)return;data=result;notice('');
   const f=filters();
   el('scheduleDate').innerHTML='<option value="">Todos los días</option>'+data.dates.map(d=>`<option value="${d}">${esc(dateLabel(d))}</option>`).join('');
   el('scheduleBlock').innerHTML='<option value="">Todos los bloques</option>'+data.blocks.map(b=>`<option value="${b.id}">${esc(b.label)} · ${esc(b.time_label)}</option>`).join('')+'<option value="custom">Horarios reprogramados</option>';
   el('scheduleDate').value=data.dates.includes(f.date)?f.date:'';el('scheduleBlock').value=f.block==='custom'||data.blocks.some(b=>String(b.id)===f.block)?f.block:'';
   el('scheduleSummary').innerHTML=[['Estudiantes registrados',data.summary.total],['Con horario asignado',data.summary.assigned],['Sin asignar',data.summary.unassigned],['Reprogramados',data.summary.reprogrammed||0]].map(([label,n])=>`<div class="stat-card"><div class="value">${n}</div><div class="label">${label}</div></div>`).join('');
   el('scheduleSlots').innerHTML=(data.regular_dates||data.dates).map(date=>`<div class="schedule-day"><h4>${esc(dateLabel(date))}</h4>${data.blocks.map(b=>{const count=data.summary.by_slot.find(s=>s.date===date&&s.block===b.id)?.count||0;return `<button type="button" class="schedule-slot" data-slot-date="${date}" data-slot-block="${b.id}"><strong>${esc(b.label)}</strong><span>${esc(b.time_label)}</span><span>${count} estudiantes</span></button>`;}).join('')}</div>`).join('')+(data.custom_slots?.length?'<div class="schedule-day"><h4>Horarios reprogramados</h4>'+data.custom_slots.map(slot=>`<button type="button" class="schedule-slot" data-slot-date="${slot.date}" data-slot-block="custom"><strong>${esc(dateLabel(slot.date))}</strong><span>${esc(slot.time_label)}</span><span>${slot.count} estudiantes</span></button>`).join('')+'</div>':'');render();
  }catch(error){if(request===generation){data=null;selected.clear();visible=[];el('scheduleRows').innerHTML='<tr><td colspan="7">No fue posible cargar los horarios. Pulse Actualizar lista.</td></tr>';selection();notice(error.message,true);}}
  finally{if(request===generation)el('refreshSchedule').disabled=false;}
 }
 function edit(rows){
  if(!rows.length)return;
  const first=rows[0],same=rows.every(r=>r.date===first.date&&r.block===first.block&&r.start===first.start&&r.end===first.end),f=filters();
  const custom=same&&isCustom(first),regularDates=data.regular_dates||data.dates;
  const date=same&&regularDates.includes(first.date)?first.date:regularDates.includes(f.date)?f.date:regularDates[0],block=same&&first.block?first.block:Number(f.block)||1;
  const versions=rows.map(r=>({id:r.id,version:r.version}));
  modal(`${head(rows.length===1?'Horario de '+first.name:'Asignar horario a '+rows.length+' estudiantes')}<div class="modal-body"><p>Horarios de Costa Rica. La reprogramación permite otra fecha y hora y requiere un motivo.</p><div class="field"><label for="assignExamMode">Tipo de horario</label><select id="assignExamMode"><option value="regular" ${custom?'':'selected'}>Bloque establecido</option><option value="custom" ${custom?'selected':''}>Reprogramación: otra fecha y hora</option></select></div><div class="form-grid" id="assignRegularFields"><div class="field"><label for="assignExamDate">Fecha de la prueba</label><select id="assignExamDate">${regularDates.map(d=>`<option value="${d}" ${d===date?'selected':''}>${esc(dateLabel(d))}</option>`).join('')}</select></div><div class="field"><label for="assignExamBlock">Bloque</label><select id="assignExamBlock">${data.blocks.map(b=>`<option value="${b.id}" ${b.id===block?'selected':''}>${esc(b.label)} · ${esc(b.time_label)}</option>`).join('')}</select></div></div><div id="assignCustomFields" class="form-grid"><div class="field span2"><label for="assignCustomDate">Nueva fecha de la prueba</label><input id="assignCustomDate" type="date" value="${custom?first.date:date}"></div><div class="field"><label for="assignCustomStart">Hora de inicio</label><input id="assignCustomStart" type="time" value="${custom?first.start:'08:00'}"></div><div class="field"><label for="assignCustomEnd">Hora de finalización</label><input id="assignCustomEnd" type="time" value="${custom?first.end:'10:00'}"></div><div class="field span2"><label for="assignCustomReason">Motivo de la reprogramación (obligatorio)</label><textarea id="assignCustomReason" rows="3" minlength="5" maxlength="2000">${esc(custom&&rows.every(r=>r.reason===first.reason)?first.reason:'')}</textarea></div></div><div id="assignExamMsg" aria-live="polite"></div></div><div class="modal-foot"><button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>${rows.some(r=>r.date)?'<button class="btn btn-outline" id="clearExamSchedule">Quitar asignación</button>':''}<button class="btn btn-primary" id="saveExamSchedule">Guardar horario</button></div>`,true);
  function toggleMode(){const special=el('assignExamMode').value==='custom';el('assignRegularFields').hidden=special;el('assignCustomFields').hidden=!special;}
  el('assignExamMode').onchange=toggleMode;toggleMode();
  el('assignCustomStart').onchange=()=>{const value=el('assignCustomStart').value;if(!value)return;const [h,m]=value.split(':').map(Number),end=Math.min(h*60+m+120,1439);el('assignCustomEnd').value=String(Math.floor(end/60)).padStart(2,'0')+':'+String(end%60).padStart(2,'0');};
  async function save(clear=false){
   if(clear&&!confirm('¿Desea quitar la asignación de '+rows.length+' estudiante(s)?'))return;
   const special=!clear&&el('assignExamMode').value==='custom';
   const body=special?{students:versions,mode:'custom',date:el('assignCustomDate').value,block:null,start:el('assignCustomStart').value,end:el('assignCustomEnd').value,reason:el('assignCustomReason').value.trim()}:{students:versions,mode:'regular',date:clear?null:el('assignExamDate').value,block:clear?null:Number(el('assignExamBlock').value)};
   const msg=el('assignExamMsg');
   if(special&&(!body.date||!body.start||!body.end||body.end<=body.start||body.reason.length<5)){msg.textContent='Complete la nueva fecha, las horas de inicio y finalización y un motivo de al menos 5 caracteres.';msg.className='notice error';return;}
   const buttons=[el('saveExamSchedule'),el('clearExamSchedule')].filter(Boolean);buttons.forEach(b=>b.disabled=true);
   try{const result=await api('/api/admin/exam-schedule',{method:'PUT',body});closeModal();await load();if(data)notice(result.updated+' asignación(es) '+(clear?'eliminada(s).':special?'reprogramada(s).':'guardada(s).'));}
   catch(error){const errorBox=el('assignExamMsg');if(errorBox){errorBox.textContent=error.message;errorBox.className='notice error';buttons.forEach(b=>b.disabled=false);}}
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
  try{const f=filters(),params=new URLSearchParams();if(f.date)params.set('date',f.date);if(f.block)params.set('block',f.block);const report=await api('/api/admin/exam-attendance?'+params);downloadFile(await createAttendanceReport(report),'Listas_Asistencia_Admision_'+report.cycle_year+'_'+(f.date||'Todos_los_dias')+(f.block==='custom'?'_Reprogramados':f.block?'_Bloque_'+f.block:'')+'.pdf','application/pdf');notice('PDF listo. Abra el archivo descargado e imprímalo para recoger las firmas.');}
  catch(error){notice(error.message,true);}finally{button.disabled=false;}
 });
 return {load};
})();
