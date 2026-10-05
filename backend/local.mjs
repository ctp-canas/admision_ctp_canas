import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile} from 'node:fs/promises';
import {createHandler} from '../supabase/functions/admission/index.ts';
export async function localBackend({persist, password, fastHash=false, authFetch}={}){
 const db=new PGlite({dataDir:persist,extensions:{pgcrypto}});
 if(!(await db.query("select to_regclass('admission_private.config') as present")).rows[0].present){
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema extensions;");
  let migration=await readFile(new URL('../supabase/migrations/202609290001_admissions.sql',import.meta.url),'utf8');
  // Cost 4 is used only for synthetic automated tests. Deployed SQL always uses 12.
  if(fastHash)migration=migration.replaceAll("gen_salt('bf',12)","gen_salt('bf',4)");
  await db.exec(migration);
  if(password) await db.query('select public.admission_bootstrap($1)',[password]);
 }
 // Applies to existing previews as well as new databases; keeps records and credentials.
 await db.exec(await readFile(new URL('../supabase/password-recovery.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/update-public-result.sql',import.meta.url),'utf8'));
 const rpc=async(_url,options)=>{
  if(_url.includes('/auth/v1/'))return authFetch?authFetch(_url,options):Response.json({error:'Email is unavailable in the local preview'},{status:503});
  try{
   const a=JSON.parse(options.body);
   const result=_url.endsWith('/admission_password_recovery')
    ?await db.query('select public.admission_password_recovery($1,$2::jsonb,$3) as result',[a.action,JSON.stringify(a.payload),a.ip_hash])
    :await db.query('select public.admission_api($1,$2,$3::jsonb,$4,$5,$6,$7) as result',[a.method,a.path,JSON.stringify(a.body),a.session_hash,a.ip_hash,a.backup_key,a.login_hash]);
   return Response.json(result.rows[0].result);
  }catch(error){console.error('Error de base de datos en prueba local:',error.message);return Response.json({error:'Database error'},{status:500});}
 };
 const settings={SUPABASE_URL:'http://local-db',SUPABASE_SERVICE_ROLE_KEY:'local-only',BACKUP_ENCRYPTION_KEY:process.env.BACKUP_ENCRYPTION_KEY||'local-tests-only-backup-key-1234567890',ALLOWED_ORIGINS:'http://127.0.0.1:8080'};
 return {db,handler:createHandler(k=>settings[k]||'',rpc)};
}
