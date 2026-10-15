function renderStudentProgress(student){
 const p=student.progress||{},id=Number(student.id);
 const steps=[['password','Contraseña',p.password],['grades','Notas '+(p.grades_filled??0)+'/'+(p.grades_total??25),p.grades],['exam','Prueba',p.exam],['appointment','Cita',p.appointment]];
 const pending=steps.filter(step=>!step[2]).map(step=>({password:'contraseña',grades:'notas',exam:'nota de la prueba',appointment:'cita'})[step[0]]);
 return `<div class="student-progress" data-progress-student="${id}" aria-label="Avance del proceso"><div class="progress-steps">${steps.map(([step,label,complete])=>`<button type="button" class="process-step ${complete?'complete':'pending'}" data-progress-id="${id}" data-progress-step="${step}" title="${complete?'Registrado':'Pendiente'}: ${label}. Pulse para abrir." aria-label="${label}: ${complete?'registrado':'pendiente'}. Abrir."><span aria-hidden="true">${complete?'✓':'○'}</span> ${label}</button>`).join('')}</div><span class="small progress-caption">${pending.length?'Pendiente: '+pending.join(', '):'Registro completo · 4/4'}</span></div>`;
}
