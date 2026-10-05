const message='Si el usuario y el correo coinciden con una cuenta activa, recibirá un enlace para recuperar su contraseña. Revise también la carpeta de correo no deseado.';
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
export async function passwordRecovery(path:string,body:Record<string,unknown>,env:(name:string)=>string,http:typeof fetch,serverHeaders:Record<string,string>,ipHash:string):Promise<{status:number,data:Record<string,unknown>}> {
 const base=env('SUPABASE_URL');
 const rpc=async(action:string,payload:Record<string,unknown>)=>{
  const r=await http(base+'/rest/v1/rpc/admission_password_recovery',{method:'POST',headers:serverHeaders,body:JSON.stringify({action,payload,ip_hash:ipHash}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('Recovery database unavailable');
  return await r.json();
 };
 const output=(data:Record<string,unknown>)=>{const status=Number(data._status)||200;delete data._status;return {status,data};};
 const auth=async(endpoint:string,payload?:Record<string,unknown>,accessToken?:string)=>{
  const headers={...serverHeaders};if(accessToken)headers.Authorization='Bearer '+accessToken;
  const r=await http(base+'/auth/v1/'+endpoint,{method:payload?'POST':'GET',headers,body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(15000)});
  return {ok:r.ok,status:r.status,data:await r.json()};
 };
 if(path==='/api/password/request'){
  const candidate=await rpc('request',{username:body.username,email:body.email});
  if(candidate._status)return output(candidate);
  if(!candidate.id)return {status:200,data:{ok:true,message}};
  let authId=candidate.auth_id;
  if(!authId){
   const created=await auth('admin/users',{email:candidate.email,password:randomToken(),email_confirm:true});
   let user=created.data;
   if(!created.ok){
    if(created.status!==422 && created.status!==400)return {status:503,data:{error:'No fue posible preparar la recuperación por correo. Contacte a la administración.'}};
    const listed=await auth('admin/users?page=1&per_page=1000');
    user=listed.data.users?.find((u:{email:string})=>u.email?.toLowerCase()===candidate.email);
   }
   if(!user?.id)return {status:503,data:{error:'No fue posible preparar la recuperación por correo. Contacte a la administración.'}};
   const bound=await rpc('bind',{id:candidate.id,email:candidate.email,auth_id:user.id});
   if(bound._status)return output(bound);authId=bound.auth_id;
  }
  const redirect=env('RECOVERY_REDIRECT_URL')||'https://ctp-canas.github.io/admision_ctp_canas/admin-login.html?recover=1';
  // Check the allowlist without sending an email containing a broken localhost link.
  const generated=await auth('admin/generate_link',{type:'recovery',email:candidate.email,redirect_to:redirect});
  const actionLink=generated.data.action_link||generated.data.properties?.action_link;
  if(!generated.ok||!actionLink)return {status:503,data:{error:'No fue posible preparar el enlace de recuperación. Contacte a la administración.'}};
  if(new URL(actionLink).searchParams.get('redirect_to')!==redirect)return {status:503,data:{error:'La recuperación necesita que la administración configure la dirección del sitio en Supabase Authentication → URL Configuration.'}};
  const pending=await rpc('sent',{id:candidate.id,email:candidate.email,auth_id:authId});
  if(pending._status)return output(pending);
  const sent=await auth('recover?redirect_to='+encodeURIComponent(redirect),{email:candidate.email});
  if(!sent.ok){
   await rpc('failed',{id:candidate.id});
   return {status:sent.status===429?429:503,data:{error:sent.status===429?'Se alcanzó el límite de correos. Espere una hora antes de solicitar otro enlace.':'No fue posible enviar el correo de recuperación. La administración debe revisar el servicio de correo de Supabase.'}};
  }
  return {status:200,data:{ok:true,message}};
 }
 const access=typeof body.recovery_token==='string'?body.recovery_token:'';
 const password=typeof body.password==='string'?body.password:'';
 if([...password].length<12||new TextEncoder().encode(password).length>72)return {status:400,data:{error:'La contraseña debe tener al menos 12 caracteres y un máximo de 72 bytes.'}};
 if(access.length>8192||access.split('.').length!==3)return {status:401,data:{error:'Enlace de recuperación inválido. Solicite uno nuevo.'}};
 const attempts=await rpc('verify',{});if(attempts._status)return output(attempts);
 const verified=await auth('user',undefined,access);
 if(!verified.ok)return {status:401,data:{error:'El enlace venció o ya fue utilizado. Solicite uno nuevo.'}};
 let claims;
 try{const raw=access.split('.')[1].replaceAll('-','+').replaceAll('_','/');claims=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw),c=>c.charCodeAt(0))));}catch{return {status:401,data:{error:'Enlace de recuperación inválido.'}};}
 const recovery=Array.isArray(claims.amr)?claims.amr.find((v:{method:string,timestamp:number})=>v.method==='recovery'):null;
 if(claims.sub!==verified.data.id||claims.iss!==base+'/auth/v1'||!verified.data.email_confirmed_at||!recovery||!Number.isFinite(recovery.timestamp)||!/^([a-f0-9]{8}-)([a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(claims.session_id||''))return {status:401,data:{error:'Este enlace no permite recuperar la contraseña. Solicite uno nuevo.'}};
 const result=await rpc('complete',{auth_id:verified.data.id,email:verified.data.email,session_hash:await hash(claims.session_id),recovery_time:recovery.timestamp,password});
 if(!result._status){
  // Application session revocation is atomic in SQL; the email proof is also single-use.
  await http(base+'/auth/v1/logout?scope=global',{method:'POST',headers:{...serverHeaders,Authorization:'Bearer '+access},signal:AbortSignal.timeout(15000)}).catch(()=>{});
 }
 return output(result);
}
