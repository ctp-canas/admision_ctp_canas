(()=>{
 const $=s=>document.querySelector(s), login=$('#loginForm'), request=$('#recoveryForm'), reset=$('#resetForm');
 const heading=$('#loginHeading'), intro=$('#loginIntro');
 let recoveryToken='';
 function notice(el,text,error=false){el.className='notice '+(error?'error':'info');el.textContent=text;}
 function show(mode){
  login.hidden=mode!=='login';$('#recoveryPanel').hidden=mode!=='request';$('#resetPanel').hidden=mode!=='reset';$('#forgotPassword').hidden=mode!=='login';
  heading.textContent=mode==='login'?'Área Administrativa':mode==='request'?'Recuperar contraseña':'Crear contraseña nueva';
  intro.textContent=mode==='login'?'Proceso de Admisión a Sétimo Año · CTP Cañas':mode==='request'?'Ingrese su usuario administrativo y el correo registrado.':'Defina una contraseña nueva para su cuenta administrativa.';
 }
 const fragment=new URLSearchParams(location.hash.slice(1));
 const returnedForRecovery=fragment.get('type')==='recovery'||new URLSearchParams(location.search).get('recover')==='1';
 if(location.hash)history.replaceState(null,'',location.pathname);
 if(returnedForRecovery){
  admissionClearSession();
  recoveryToken=fragment.get('access_token')||'';
  if(recoveryToken)show('reset');else{show('request');notice($('#recoveryMsg'),'El enlace venció o ya fue utilizado. Solicite uno nuevo.',true);}
 }else{
  show('login');admissionRequest('/api/session').then(s=>{if(s.authenticated)location.href='admin.html'}).catch(()=>{});
 }
 login.addEventListener('submit',async e=>{
  e.preventDefault();const btn=login.querySelector('button');btn.disabled=true;$('#msg').textContent='';
  try{await admissionRequest('/api/login',{method:'POST',body:{username:$('#username').value,password:$('#password').value}});location.href='admin.html';}
  catch(err){notice($('#msg'),err.message,true);}finally{btn.disabled=false;}
 });
 $('#forgotPassword').addEventListener('click',()=>{$('#recoveryUsername').value=$('#username').value;show('request');$('#recoveryUsername').focus();});
 $('#backToLogin').addEventListener('click',()=>{show('login');$('#username').focus();});
 $('#resetBackToLogin').addEventListener('click',()=>{recoveryToken='';reset.reset();show('login');});
 request.addEventListener('submit',async e=>{
  e.preventDefault();const btn=request.querySelector('button');btn.disabled=true;$('#recoveryMsg').textContent='';
  try{const data=await admissionRequest('/api/password/request',{method:'POST',body:{username:$('#recoveryUsername').value.trim(),email:$('#recoveryEmail').value.trim()}});notice($('#recoveryMsg'),data.message);}
  catch(err){notice($('#recoveryMsg'),err.message,true);}finally{btn.disabled=false;}
 });
 reset.addEventListener('submit',async e=>{
  e.preventDefault();const password=$('#newPassword').value;
  if(password!==$('#confirmPassword').value){notice($('#resetMsg'),'Las contraseñas no coinciden.',true);return;}
  if([...password].length<12||new TextEncoder().encode(password).length>72){notice($('#resetMsg'),'Use al menos 12 caracteres y un máximo de 72 bytes.',true);return;}
  const btn=reset.querySelector('button');btn.disabled=true;$('#resetMsg').textContent='';
  try{const data=await admissionRequest('/api/password/reset',{method:'POST',body:{recovery_token:recoveryToken,password}});recoveryToken='';reset.reset();admissionClearSession();show('login');notice($('#msg'),data.message);$('#username').focus();}
  catch(err){notice($('#resetMsg'),err.message,true);}finally{btn.disabled=false;}
 });
})();
