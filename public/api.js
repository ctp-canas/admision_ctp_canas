(function(){
 const configured=window.ADMISSION_CONFIG?.apiBase;
 const key='ctp-admission-session';
 window.admissionRequest=async function(path,options={}){
  if(!configured) throw new Error('La conexión del sistema todavía no está configurada. La institución informará cuando esté disponible.');
  const opt={...options,headers:{...options.headers}};
  const token=sessionStorage.getItem(key);
  if(token) opt.headers['X-Admission-Token']=token;
  if(opt.body && typeof opt.body==='object' && !(opt.body instanceof Blob)){
   opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(opt.body);
  }
  let response;
  try { response=await fetch(configured.replace(/\/$/,'')+path,opt); }
  catch { throw new Error('No se pudo conectar con el sistema. Compruebe su conexión e inténtelo nuevamente.'); }
  const data=await response.json();
  if(!response.ok) throw Object.assign(new Error(data.error||'No fue posible completar la operación'),{status:response.status,data});
  if(path==='/api/login') sessionStorage.setItem(key,data.token);
  if(path==='/api/logout') sessionStorage.removeItem(key);
  return data;
 };
 window.admissionClearSession=()=>sessionStorage.removeItem(key);
})();
