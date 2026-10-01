const $=s=>document.querySelector(s);let statusInfo=null;
function fmtDate(iso){return new Intl.DateTimeFormat('es-CR',{dateStyle:'long',timeStyle:'short',timeZone:'America/Costa_Rica'}).format(new Date(iso));}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function scoreCard(d){
 if(!['ADMITIDO','NO_ADMITIDO'].includes(d.status))return '';
 const score=typeof d.final_score==='string'&&/^\d{1,3}\.\d{4}$/.test(d.final_score)&&Number(d.final_score)<=100?d.final_score.replace('.',','):null;
 return '<div class="result-score"><p>Nota final de admisión</p><strong>'+ (score??'Nota no disponible')+'</strong>'+(score!==null?'<span>Sobre 100 puntos</span>':'')+'</div>';
}
async function loadStatus(){
 try{
  statusInfo=await admissionRequest('/api/public/status');$('#cycleYear').textContent=statusInfo.cycle_year;document.querySelectorAll('[data-cycle-year]').forEach(el=>el.textContent=statusInfo.cycle_year);
  const box=$('#availability');box.className='notice '+(statusInfo.available?'success':'info');
  box.textContent=statusInfo.available?'Los resultados se encuentran disponibles para consulta.':statusInfo.publication_at?'Los resultados podrán consultarse a partir del '+fmtDate(statusInfo.publication_at)+', una vez concluido el proceso.':'La institución informará la fecha de publicación de resultados.';
  $('#consultBtn').disabled=!statusInfo.available;
 }catch(err){$('#availability').className='notice warn';$('#availability').textContent=err.message;$('#consultBtn').disabled=true;}
}
$('#showPassword').addEventListener('change',e=>$('#password').type=e.target.checked?'text':'password');
$('#resultForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=$('#consultBtn'),box=$('#resultBox');btn.disabled=true;box.className='';box.textContent='Consultando resultado…';
 try{
  const d=await admissionRequest('/api/public/result',{method:'POST',body:{identification:$('#identification').value.trim(),password:$('#password').value.toUpperCase()}});
  let label='RESULTADO PENDIENTE',cls='pendiente',message='El resultado se encuentra pendiente de resolución administrativa.';
  if(d.status==='ADMITIDO'){label='ADMITIDO';cls='admitido';message='Usted ha obtenido un cupo para ingresar al Colegio Técnico Profesional de Cañas.\n\n'+d.instructions;}
  if(d.status==='NO_ADMITIDO'){label='NO ADMITIDO';cls='noadmitido';message=d.instructions;}
  if(d.status==='RENUNCIO'){label='CUPO RENUNCIADO';message='El expediente registra una renuncia al cupo asignado.';}
  box.innerHTML='<div class="result-state"><p class="muted small">Resultado del proceso de admisión</p><h3>'+escapeHtml(d.name)+'</h3><span class="badge-big '+cls+'">'+label+'</span>'+scoreCard(d)+'<div class="notice '+(cls==='admitido'?'success':'info')+'" style="text-align:left;white-space:pre-line">'+escapeHtml(message)+'</div></div>';
  $('#password').value='';box.focus({preventScroll:true});box.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
 }catch(err){box.className='notice error';box.textContent=err.message;}finally{btn.disabled=!statusInfo?.available;}
});
loadStatus();setInterval(loadStatus,60000);
