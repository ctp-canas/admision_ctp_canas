const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,BOOTSTRAP_ADMIN_PASSWORD}=process.env;
if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY||!BOOTSTRAP_ADMIN_PASSWORD)throw new Error('Configure las variables del servidor indicadas en README');
const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/admission_bootstrap',{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+SUPABASE_SERVICE_ROLE_KEY},body:JSON.stringify({password:BOOTSTRAP_ADMIN_PASSWORD})});
if(!r.ok)throw new Error('No se pudo crear el administrador. Revise la conexión y si ya existe.');
console.log('Administrador inicial creado. No se muestran sus credenciales.');
