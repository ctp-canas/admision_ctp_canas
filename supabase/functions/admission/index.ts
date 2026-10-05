/** Custom opaque sessions are authenticated by admission_api before any private operation. */
import {passwordRecovery} from './recovery.ts';
const env = (name: string) => Deno.env.get(name) || '';
const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2,'0')).join('');
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
export function createHandler(env: (name: string)=>string, rpcFetch: typeof fetch = fetch) {
return async function handler(req: Request): Promise<Response> {
 const origin = req.headers.get('origin') || '';
 const allowed = (env('ALLOWED_ORIGINS') || 'https://ctp-canas.github.io').split(',').map(x=>x.trim());
 const headers: Record<string,string> = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
 if (origin && !allowed.includes(origin)) return new Response('{"error":"Origen no permitido"}',{status:403,headers});
 if (origin) headers['Access-Control-Allow-Origin']=origin;
 headers['Access-Control-Allow-Headers']='Content-Type, X-Admission-Token';
 headers['Access-Control-Allow-Methods']='GET, POST, PUT, OPTIONS';
 if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
 const url=new URL(req.url);
 const path=url.pathname.slice(url.pathname.indexOf('/api/'));
 if (!path.startsWith('/api/')) return new Response('{"error":"Operación no encontrada"}',{status:404,headers});
 const token=req.headers.get('x-admission-token')||'';
 if (token && !/^[a-f0-9]{64}$/.test(token)) return new Response('{"error":"Sesión no válida"}',{status:401,headers});
 try {
  if (Number(req.headers.get('content-length')||0)>16000000) return new Response('{"error":"Solicitud demasiado grande"}',{status:413,headers});
  let body: Record<string,unknown>={};
  if(req.method==='GET') body=Object.fromEntries(url.searchParams);
  else { const raw=await req.text(); if(raw.length>16000000) return new Response('{"error":"Solicitud demasiado grande"}',{status:413,headers}); body=raw?JSON.parse(raw):{}; }
  const loginToken=path==='/api/login' && req.method==='POST'?randomToken():'';
  const configuredKeys=env('SUPABASE_SECRET_KEYS');
  const serverKey=(configuredKeys?JSON.parse(configuredKeys).default:'')||env('SUPABASE_SERVICE_ROLE_KEY');
  if(typeof serverKey!=='string'||!serverKey) return new Response('{"error":"El servicio aún no está configurado"}',{status:503,headers});
  const rpcHeaders: Record<string,string>={'Content-Type':'application/json','apikey':serverKey};
  if(!serverKey.startsWith('sb_secret_')) rpcHeaders['Authorization']='Bearer '+serverKey;
  const ipHash=await sha(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown');
  if(path==='/api/password/request'||path==='/api/password/reset'){
   if(req.method!=='POST')return new Response('{"error":"Método no permitido"}',{status:405,headers});
   const result=await passwordRecovery(path,body,env,rpcFetch,rpcHeaders,ipHash);
   return new Response(JSON.stringify(result.data),{status:result.status,headers});
  }
  const response=await rpcFetch(env('SUPABASE_URL')+'/rest/v1/rpc/admission_api',{
   method:'POST',headers:rpcHeaders,
   body:JSON.stringify({method:req.method,path,body,session_hash:token?await sha(token):'',
    ip_hash:ipHash,
    backup_key:env('BACKUP_ENCRYPTION_KEY'),login_hash:loginToken?await sha(loginToken):''})
  });
  if(!response.ok) return new Response('{"error":"No fue posible completar la operación. Contacte a la administración."}',{status:503,headers});
  const data=await response.json(); const status=data._status||200; delete data._status;
  if(loginToken && status===200) data.token=loginToken;
  return new Response(JSON.stringify(data),{status,headers});
 } catch { return new Response('{"error":"No fue posible procesar la solicitud"}',{status:400,headers}); }
};
}
if(typeof Deno!=='undefined') Deno.serve(createHandler(env));
