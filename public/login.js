const form=document.querySelector('#loginForm'), msg=document.querySelector('#msg');
admissionRequest('/api/session').then(s=>{if(s.authenticated)location.href='admin.html'}).catch(()=>{});
form.addEventListener('submit',async e=>{
 e.preventDefault();const btn=form.querySelector('button');btn.disabled=true;msg.textContent='';
 try {await admissionRequest('/api/login',{method:'POST',body:{username:form.querySelector('#username').value,password:form.querySelector('#password').value}});location.href='admin.html';}
 catch(err){msg.className='notice error';msg.textContent=err.message;}finally{btn.disabled=false;}
});
