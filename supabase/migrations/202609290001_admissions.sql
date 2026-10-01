-- All private data is accessible only to the server's service_role.
create schema if not exists admission_private;
create extension if not exists pgcrypto with schema extensions;
revoke all on schema admission_private from public, anon, authenticated;
grant usage on schema admission_private to service_role;

create table admission_private.config (id int primary key check(id=1), data jsonb not null);
insert into admission_private.config values (1, '{"cycle_year":"2027","slots":"150","publication_at":"","published":"0","cut_valid":false,"admitted_instructions":"La institución comunicará las fechas de matrícula y los documentos que debe presentar.","not_admitted_message":"Agradecemos su participación en el proceso. En esta oportunidad, los resultados y la disponibilidad de cupos no permitieron asignarle un espacio de ingreso."}');
update admission_private.config set data=data||jsonb_build_object('dummy_password_hash',
 extensions.crypt(encode(extensions.gen_random_bytes(24),'hex'),extensions.gen_salt('bf',12))) where id=1;
create table admission_private.users (
 id bigserial primary key, username text unique not null, display_name text not null,
 password_hash text not null, role text not null check(role in ('principal','admin','digitador')),
 active boolean not null default true, created_at timestamptz not null default now());
create table admission_private.sessions (
 token_hash text primary key, user_id bigint not null references admission_private.users on delete cascade,
 expires_at timestamptz not null, created_at timestamptz not null default now());
create table admission_private.students (
 id bigserial primary key, identification text unique not null check(length(identification) between 1 and 40),
 first_name text not null check(length(trim(first_name)) between 1 and 100),
 last_name1 text not null check(length(trim(last_name1)) between 1 and 100), last_name2 text not null default '',
 password_hash text not null, grades jsonb not null default '{}', exam numeric(7,4),
 version integer not null default 0, decision text not null default 'PENDIENTE'
 check(decision in ('PENDIENTE','ADMITIDO','NO_ADMITIDO','PENDIENTE_EMPATE','RENUNCIO')),
 reason text not null default '', created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), updated_by bigint,
 check(exam is null or exam between 0 and 100));
create table admission_private.locks (
 student_id bigint primary key references admission_private.students on delete cascade,
 user_id bigint not null references admission_private.users on delete cascade,
 session_hash text not null references admission_private.sessions on delete cascade,
 locked_at timestamptz not null default now(), heartbeat timestamptz not null default now(),
 expires_at timestamptz not null);
create table admission_private.audit (
 id bigserial primary key, user_id bigint, username text, action text not null, student_id bigint,
 detail_json jsonb not null default '{}', created_at timestamptz not null default now());
create table admission_private.imports (
 token text primary key, user_id bigint not null references admission_private.users on delete cascade,
 rows jsonb not null, expires_at timestamptz not null);
create table admission_private.backups (
 id bigserial primary key, name text unique not null, payload text not null, sha256 text not null,
 cycle_year text not null, students int not null, label text not null,
 created_at timestamptz not null default now());
create table admission_private.rate_limits (key text primary key, started_at timestamptz not null, attempts int not null);

create function admission_private.grade_keys() returns text[] language sql immutable as $$
 select array['g4_math','g4_science','g4_spanish','g4_social','g4_conduct','g5_math','g5_science','g5_spanish','g5_social','g5_conduct','g6_math','g6_science','g6_spanish','g6_social','g6_conduct']; $$;
create function admission_private.score(v text) returns numeric language plpgsql immutable as $$
begin
 if v is null or trim(v)='' then return null; end if;
 v:=replace(trim(v),',','.');
 if v !~ '^[0-9]{1,3}(\.[0-9]{1,4})?$' or v::numeric>100 then
  raise exception 'La nota debe estar entre 0 y 100, con un máximo de cuatro decimales.';
 end if;
 return v::numeric;
end; $$;
create function admission_private.academic(g jsonb) returns numeric language sql immutable as $$
 select case when count(v)=15 then round(sum(v)/15,4) end from
 (select admission_private.score(g->>k) as v from unnest(admission_private.grade_keys()) k) t; $$;
create view admission_private.records with (security_invoker=true) as
 with scores as (
 select s.*, concat_ws(' ',first_name,last_name1,nullif(last_name2,'')) as name,
 admission_private.academic(grades) as avg from admission_private.students s),
 components as (select *, round(avg*0.6,4) as ac, round(exam*0.4,4) as ec from scores),
 totals as (select *, ac+ec as total from components),
 ranked as (select id,row_number() over(order by total desc,
 translate(lower(name),'áéíóúüñ','aeiouun') collate "C",id) as pos from totals where total is not null)
 select t.*,r.pos as position,(avg*10000)::bigint as academic_avg,(ac*10000)::bigint as academic_component,
 (ec*10000)::bigint as exam_component,(total*10000)::bigint as final_score,
 to_char(avg,'FM990.0000') as academic_avg_display,to_char(ac,'FM990.0000') as academic_component_display,
 to_char(ec,'FM990.0000') as exam_component_display,to_char(exam,'FM990.0000') as exam_display,to_char(total,'FM990.0000') as final_display,
 case when decision='RENUNCIO' then 'RENUNCIO' when total is null then null else decision end as status
 from totals t left join ranked r on r.id=t.id;
create function admission_private.student_json(s admission_private.records) returns jsonb language sql stable as $$
 select to_jsonb(s)-array['password_hash','grades','exam','decision','avg','ac','ec','total']; $$;
create function admission_private.log_event(uid bigint, a text, sid bigint default null, detail jsonb default '{}') returns void language sql as $$
 insert into admission_private.audit(user_id,username,action,student_id,detail_json)
 select uid,username,a,sid,detail from admission_private.users where id=uid; $$;
create function admission_private.invalidate() returns void language plpgsql as $$
begin
 update admission_private.config set data=data||'{"cut_valid":false}'::jsonb where id=1;
 update admission_private.students set decision='PENDIENTE',reason='' where decision<>'RENUNCIO';
end; $$;
create function admission_private.tie_info() returns jsonb language sql stable as $$
 with c as (select (data->>'slots')::int as n from admission_private.config where id=1),
 ranked as (select *,row_number() over(order by position) as eligible from admission_private.records
 where total is not null and decision<>'RENUNCIO'),
 boundary as (select final_score from ranked,c where eligible=c.n
 and exists(select 1 from ranked x where x.eligible=c.n+1 and x.final_score=ranked.final_score))
 select jsonb_build_object('score',min(r.final_display),'remaining',
 (select n from c)-min(r.eligible)+1,'group',jsonb_agg(jsonb_build_object('id',r.id,'student_id',r.id,
 'position',r.position,'name',r.name) order by r.position)) from ranked r,boundary b
 where r.final_score=b.final_score having count(*)>0; $$;
create function admission_private.apply_cut() returns jsonb language plpgsql as $$
declare t jsonb; sc bigint; n int;
begin
 select (data->>'slots')::int into n from admission_private.config where id=1;
 t:=admission_private.tie_info();
 if t is null then
  update admission_private.students s set decision=case when r.eligible<=n then 'ADMITIDO' else 'NO_ADMITIDO' end
  from (select id,row_number() over(order by position) eligible from admission_private.records
  where total is not null and decision<>'RENUNCIO') r where r.id=s.id;
 else
  select final_score into sc from admission_private.records where id=(t->'group'->0->>'id')::bigint;
  update admission_private.students s set decision=case when r.final_score>sc then 'ADMITIDO'
  when r.final_score<sc then 'NO_ADMITIDO' else 'PENDIENTE_EMPATE' end
  from admission_private.records r where r.id=s.id and r.total is not null and s.decision<>'RENUNCIO';
 end if;
 update admission_private.config set data=data||jsonb_build_object('cut_valid',t is null) where id=1;
 return t;
end; $$;
create function admission_private.snapshot() returns jsonb language sql stable as $$
 select jsonb_build_object('app','ctp-canas-admission','version',2,'created_at',now(),
 'config',(select data from admission_private.config where id=1),
 'students',coalesce((select jsonb_agg(to_jsonb(s) order by id) from admission_private.students s),'[]'),
 'users',coalesce((select jsonb_agg(to_jsonb(u) order by id) from admission_private.users u),'[]'),
 'audit',coalesce((select jsonb_agg(to_jsonb(a) order by id) from admission_private.audit a),'[]'),
 'backup_history',coalesce((select jsonb_agg(to_jsonb(b)-'payload') from admission_private.backups b),'[]')); $$;
create function admission_private.make_backup(label text, secret text, uid bigint) returns jsonb language plpgsql as $$
declare p text; bid bigint; snap jsonb; cfg jsonb; nm text;
begin
 if length(secret)<32 or secret is null then raise exception 'No se ha configurado la clave de cifrado de respaldos.'; end if;
 snap:=admission_private.snapshot(); cfg:=snap->'config';
 p:=encode(extensions.pgp_sym_encrypt(snap::text,secret,'cipher-algo=aes256,compress-algo=1'),'base64');
 nm:='Respaldo_Admision_CTP_Canas_'||(cfg->>'cycle_year')||'_'||label||'_'||to_char(clock_timestamp(),'YYYYMMDD_HH24MISS_MS')||'.zip';
 insert into admission_private.backups(name,payload,sha256,cycle_year,students,label)
 values(nm,p,encode(extensions.digest(p,'sha256'),'hex'),cfg->>'cycle_year',jsonb_array_length(snap->'students'),label) returning id into bid;
 perform admission_private.log_event(uid,'BACKUP_CREADO',null,jsonb_build_object('id',bid,'label',label));
 return jsonb_build_object('id',bid,'name',nm,'download','/api/admin/backup/download?id='||bid);
end; $$;
create function admission_private.restore_payload(payload text, secret text) returns jsonb language plpgsql as $$
declare snap jsonb; item jsonb; k text; ids bigint[];
begin
 if length(payload)>15000000 then raise exception 'Respaldo demasiado grande.'; end if;
 snap:=extensions.pgp_sym_decrypt(decode(payload,'base64'),secret)::jsonb;
 if snap->>'app'<>'ctp-canas-admission' or snap->>'version'<>'2'
 or jsonb_typeof(snap->'students')<>'array' or jsonb_typeof(snap->'users')<>'array'
 or jsonb_typeof(snap->'audit')<>'array' or jsonb_typeof(snap->'config')<>'object' then
  raise exception 'Versión o estructura del respaldo no compatible.';
 end if;
 if not exists(select 1 from jsonb_array_elements(snap->'users') u where u->>'role'='principal' and (u->>'active')::boolean) then
  raise exception 'El respaldo no contiene un administrador principal activo.';
 end if;
 for item in select value from jsonb_array_elements(snap->'students') loop
  if item->>'identification' is null or trim(item->>'identification')='' or
  trim(coalesce(item->>'first_name',''))='' or trim(coalesce(item->>'last_name1',''))='' or
  item->>'password_hash' !~ '^\$2[aby]\$' then raise exception 'Respaldo con estudiantes inválidos.'; end if;
  for k in select unnest(admission_private.grade_keys()) loop perform admission_private.score(item->'grades'->>k); end loop;
  perform admission_private.score(item->>'exam');
 end loop;
 if (select count(*) from jsonb_array_elements(snap->'students')) <>
 (select count(distinct value->>'identification') from jsonb_array_elements(snap->'students')) then raise exception 'Identificaciones repetidas en el respaldo.'; end if;
 if (snap->'config'->>'slots')::int<1 or (snap->'config'->>'cycle_year')::int<2027 then raise exception 'Configuración inválida en el respaldo.'; end if;
 return snap;
end; $$;

-- Only the server can invoke this gateway. Each call is a single transaction.
create function public.admission_api(method text, path text, body jsonb default '{}', session_hash text default '',
 ip_hash text default '', backup_key text default '', login_hash text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare u admission_private.users; s admission_private.students; cfg jsonb; out jsonb; rows jsonb;
 t jsonb; rec admission_private.records; sid bigint; k text; g jsonb; v numeric; n int; tries int;
 preview jsonb; valid jsonb:='[]'; seen text[]:=array[]::text[]; issues jsonb; item jsonb; report jsonb:='[]';
 tok text; cnt int:=0; errs int:=0; dups int:=0; idx int:=1; snap jsonb; bk jsonb; snap_hash text; current_uid bigint; auth_hash text; auth_ok boolean;
begin
 select data into cfg from admission_private.config where id=1;
 if path in ('/api/login','/api/public/result') then
  foreach k in array array[path||':'||ip_hash,path||':account:'||coalesce(body->>'username',body->>'identification','')] loop
   insert into admission_private.rate_limits(key,started_at,attempts) values(k,now(),1)
   on conflict(key) do update set attempts=case when admission_private.rate_limits.started_at<now()-interval '15 minutes' then 1 else admission_private.rate_limits.attempts+1 end,
   started_at=case when admission_private.rate_limits.started_at<now()-interval '15 minutes' then now() else admission_private.rate_limits.started_at end
   returning attempts into tries;
   if tries>30 then return jsonb_build_object('_status',429,'error','Demasiados intentos. Espere 15 minutos.'); end if;
  end loop;
 end if;
 if path='/api/login' and method='POST' then
  select * into u from admission_private.users where username=trim(body->>'username') and active;
  auth_hash:=coalesce(u.password_hash,cfg->>'dummy_password_hash');
  auth_ok:=extensions.crypt(left(coalesce(body->>'password',''),200),auth_hash)=auth_hash and octet_length(coalesce(body->>'password',''))<=72;
  if u.id is null or not coalesce(auth_ok,false) then
   return '{"_status":401,"error":"Credenciales incorrectas"}'; end if;
  if login_hash !~ '^[a-f0-9]{64}$' then raise exception 'Sesión inválida.'; end if;
  delete from admission_private.sessions where expires_at<now();
  delete from admission_private.imports where expires_at<now();
  delete from admission_private.rate_limits where started_at<now()-interval '1 day';
  insert into admission_private.sessions(token_hash,user_id,expires_at) values(login_hash,u.id,now()+interval '8 hours');
  perform admission_private.log_event(u.id,'LOGIN');
  return jsonb_build_object('ok',true,'user',to_jsonb(u)-'password_hash');
 end if;
 if path='/api/public/status' and method='GET' then
  return jsonb_build_object('cycle_year',cfg->>'cycle_year','publication_at',nullif(cfg->>'publication_at',''),
  'available',coalesce(cfg->>'published'='1' and (cfg->>'cut_valid')::boolean and nullif(cfg->>'publication_at','')::timestamptz<=now(),false));
 end if;
 if path='/api/public/result' and method='POST' then
  if not coalesce(cfg->>'published'='1' and (cfg->>'cut_valid')::boolean and nullif(cfg->>'publication_at','')::timestamptz<=now(),false) then
   return '{"_status":403,"error":"Los resultados todavía no se encuentran disponibles."}'; end if;
  select * into s from admission_private.students where identification=trim(body->>'identification');
  auth_hash:=coalesce(s.password_hash,cfg->>'dummy_password_hash');
  auth_ok:=extensions.crypt(left(coalesce(body->>'password',''),200),auth_hash)=auth_hash and coalesce(body->>'password','')~'^[A-Z0-9]{6}$';
  if s.id is null or not coalesce(auth_ok,false) then
   return '{"_status":401,"error":"Revise la identificación y la contraseña e inténtelo nuevamente."}'; end if;
  select * into rec from admission_private.records where id=s.id;
  return jsonb_build_object('name',rec.name,'status',coalesce(rec.status,'PENDIENTE'),
  'instructions',case when rec.status='ADMITIDO' then cfg->>'admitted_instructions' when rec.status='NO_ADMITIDO' then cfg->>'not_admitted_message' else '' end);
 end if;
 select x.* into u from admission_private.users x join admission_private.sessions ss on ss.user_id=x.id
 where ss.token_hash=session_hash and ss.expires_at>now() and x.active;
 if path='/api/session' and method='GET' then
  return jsonb_build_object('authenticated',u.id is not null,'user',case when u.id is not null then to_jsonb(u)-'password_hash' end);
 end if;
 if u.id is null then return '{"_status":401,"error":"Sesión finalizada"}'; end if;
 if path='/api/logout' and method='POST' then
  perform admission_private.log_event(u.id,'LOGOUT'); delete from admission_private.sessions where token_hash=session_hash; return '{"ok":true}';
 end if;
 if method not in ('GET','POST','PUT') then return '{"_status":405,"error":"Método no permitido"}'; end if;
 -- Serialize mutations against cut, restore, reset, and concurrent imports.
 if method<>'GET' then perform pg_advisory_xact_lock(202709); end if;
 if u.role='digitador' and (path !~ '^/api/admin/(students|locks|import|stats)' and not (method='GET' and path='/api/admin/ranking')) then
  return '{"_status":403,"error":"No tiene permisos para esta operación"}'; end if;
 if path ~ '^/api/admin/(backup|backups|restore|reset-cycle|users)' and u.role<>'principal' then
  return '{"_status":403,"error":"Se requiere el administrador principal"}'; end if;
 if path='/api/admin/stats' and method='GET' then
  select jsonb_build_object('registered',count(*),'complete',count(total),'incomplete',count(*)-count(total),
  'admitted',count(*) filter(where status='ADMITIDO'),'not_admitted',count(*) filter(where status='NO_ADMITIDO'),
  'resigned',count(*) filter(where status='RENUNCIO'),'pending',count(*) filter(where status in ('PENDIENTE','PENDIENTE_EMPATE')),
  'academic_complete',count(avg),'exam_complete',count(exam),'config',cfg-'dummy_password_hash',
  'active_users',(select count(distinct user_id) from admission_private.sessions where expires_at>now())) into out from admission_private.records;
  return out;
 end if;
 if path='/api/admin/students' and method='GET' then
  select coalesce(jsonb_agg(admission_private.student_json(r) order by name),'[]') into rows from admission_private.records r
  where coalesce(body->>'q','')='' or strpos(lower(r.name||' '||r.identification),lower(body->>'q'))>0;
  return jsonb_build_object('rows',rows);
 end if;
 if path ~ '^/api/admin/students/[0-9]+' then sid:=split_part(path,'/',5)::bigint;
  select * into s from admission_private.students where id=sid;
  if s.id is null then return '{"_status":404,"error":"Estudiante no encontrado"}'; end if;
 end if;
 if (path='/api/admin/students' and method='POST') or (path ~ '^/api/admin/students/[0-9]+$' and method='PUT') then
  if trim(coalesce(body->>'identification',''))='' or length(body->>'identification')>40
  or trim(coalesce(body->>'first_name',''))='' or trim(coalesce(body->>'last_name1',''))=''
  or length(body->>'first_name')>100 or length(body->>'last_name1')>100 or length(body->>'last_name2')>100 then
   raise exception 'Revise identificación, nombre y apellidos.'; end if;
  if method='POST' or coalesce(body->>'password','')<>'' then
   if body->>'password' !~ '^[A-Z0-9]{6}$' or body->>'password' is null then raise exception 'La contraseña debe tener 6 caracteres A-Z o 0-9.'; end if;
  end if;
  if method='POST' then
   insert into admission_private.students(identification,first_name,last_name1,last_name2,password_hash,updated_by)
   values(trim(body->>'identification'),trim(body->>'first_name'),trim(body->>'last_name1'),trim(coalesce(body->>'last_name2','')),
   extensions.crypt(body->>'password',extensions.gen_salt('bf',12)),u.id) returning id into sid;
  else
   if (body->>'version')::int is distinct from s.version then return '{"_status":409,"error":"El expediente cambió. Vuelva a abrirlo."}'; end if;
   update admission_private.students set identification=trim(body->>'identification'),first_name=trim(body->>'first_name'),
   last_name1=trim(body->>'last_name1'),last_name2=trim(coalesce(body->>'last_name2','')),
   password_hash=case when coalesce(body->>'password','')<>'' then extensions.crypt(body->>'password',extensions.gen_salt('bf',12)) else password_hash end,
   version=version+1,updated_by=u.id,updated_at=now() where id=sid;
  end if;
  perform admission_private.invalidate(); perform admission_private.log_event(u.id,'ESTUDIANTE_GUARDADO',sid);
  return jsonb_build_object('ok',true,'id',sid);
 end if;
 if path ~ '^/api/admin/students/[0-9]+/academic$' and method='GET' then
  select * into rec from admission_private.records where id=sid; g:='{}';
  foreach k in array admission_private.grade_keys() loop
   g:=g||jsonb_build_object(k,case when s.grades->>k is not null then to_char((s.grades->>k)::numeric,'FM990.0000') end);
  end loop;
  return jsonb_build_object('student',admission_private.student_json(rec),'grades',g,'version',s.version,
  'exam',case when s.exam is not null then to_char(s.exam,'FM990.0000') end,
  'result',jsonb_build_object('academic_avg',rec.academic_avg_display,'academic_component',rec.academic_component_display,
  'exam_component',rec.exam_component_display,'final_score',rec.final_display,'position',rec.position,'status',rec.status));
 end if;
 if path ~ '^/api/admin/locks/(acquire|heartbeat|release)$' and method='POST' then
  sid:=(body->>'student_id')::bigint;
  delete from admission_private.locks where expires_at<=now();
  if path='/api/admin/locks/release' then
   delete from admission_private.locks where student_id=sid and admission_private.locks.session_hash=admission_api.session_hash; return '{"ok":true}';
  end if;
  if exists(select 1 from admission_private.locks l where l.student_id=sid and l.session_hash<>admission_api.session_hash) then
   return jsonb_build_object('_status',409,'error','Expediente en edición por otro usuario','holder',
   (select display_name from admission_private.users where id=(select user_id from admission_private.locks where student_id=sid)));
  end if;
  if path='/api/admin/locks/heartbeat' and not exists(select 1 from admission_private.locks l where l.student_id=sid and l.session_hash=admission_api.session_hash) then
   return '{"_status":409,"error":"El permiso de edición venció. Vuelva a abrir el expediente."}'; end if;
  insert into admission_private.locks(student_id,user_id,session_hash,expires_at) values(sid,u.id,session_hash,now()+interval '90 seconds')
  on conflict(student_id) do update set heartbeat=now(),expires_at=now()+interval '90 seconds'; return '{"ok":true}';
 end if;
 if path ~ '^/api/admin/students/[0-9]+/(grades|exam)$' and method='PUT' then
  if (body->>'version')::int is distinct from s.version then return '{"_status":409,"error":"El expediente cambió. Vuelva a abrirlo."}'; end if;
  if path like '%/grades' then
   if not exists(select 1 from admission_private.locks l where l.student_id=sid and l.session_hash=admission_api.session_hash and expires_at>now()) then
    return '{"_status":409,"error":"El permiso de edición venció. Vuelva a abrir el expediente."}'; end if;
   g:='{}'; foreach k in array admission_private.grade_keys() loop g:=g||jsonb_build_object(k,admission_private.score(body->'grades'->>k)); end loop;
   update admission_private.students set grades=g where id=sid;
   delete from admission_private.locks where student_id=sid;
  else update admission_private.students set exam=admission_private.score(body->>'score') where id=sid; end if;
  update admission_private.students set version=version+1,updated_by=u.id,updated_at=now() where id=sid;
  perform admission_private.invalidate(); perform admission_private.log_event(u.id,case when path like '%/grades' then 'NOTAS_GUARDADAS' else 'PRUEBA_GUARDADA' end,sid);
  return '{"ok":true}';
 end if;
 if path='/api/admin/ranking' and method='GET' then
  select coalesce(jsonb_agg(admission_private.student_json(r) order by position),'[]') into rows from admission_private.records r where total is not null;
  return jsonb_build_object('rows',rows,'config',cfg-'dummy_password_hash','tie',case when (cfg->>'cut_valid')::boolean then null else admission_private.tie_info() end);
 end if;
 if path='/api/admin/ranking/recalculate' and method='POST' then return '{"ok":true}'; end if;
 if path='/api/admin/cutoff/apply' and method='POST' then
  n:=(body->>'slots')::int; if n<1 or n>10000 or n is null then raise exception 'Defina entre 1 y 10000 cupos.'; end if;
  update admission_private.config set data=data||jsonb_build_object('slots',n::text) where id=1;
  t:=admission_private.apply_cut(); perform admission_private.log_event(u.id,'CORTE_APLICADO',null,jsonb_build_object('slots',n,'tie',t is not null));
  return jsonb_build_object('ok',true,'tie',t);
 end if;
 if path='/api/admin/cutoff/resolve' and method='POST' then
  t:=admission_private.tie_info();
  if t is null then raise exception 'No hay empate vigente en el punto de corte.'; end if;
  if body->>'strategy' not in ('alphabetical','all','manual','pending') then raise exception 'Decisión no válida.'; end if;
  if body->>'strategy'='pending' then return '{"ok":true,"pending":true}'; end if;
  if body->>'strategy'='manual' then
   if length(trim(coalesce(body->>'justification','')))<5 then raise exception 'Indique una justificación para la selección manual.'; end if;
   if jsonb_typeof(body->'selected_ids')<>'array' or jsonb_array_length(body->'selected_ids')<>(t->>'remaining')::int then raise exception 'Seleccione exactamente los cupos disponibles del grupo empatado.'; end if;
   if (select count(distinct value) from jsonb_array_elements(body->'selected_ids'))<>jsonb_array_length(body->'selected_ids') then raise exception 'Selección repetida.'; end if;
   if exists(select 1 from jsonb_array_elements(body->'selected_ids') x where not exists(select 1 from jsonb_array_elements(t->'group') y where (y->>'id')::bigint=x::text::bigint)) then raise exception 'Seleccione solo estudiantes del empate.'; end if;
  end if;
  perform admission_private.apply_cut(); idx:=0;
  for item in select value from jsonb_array_elements(t->'group') loop
   idx:=idx+1;
   update admission_private.students set decision=case when body->>'strategy'='all' or
   (body->>'strategy'='alphabetical' and idx<=(t->>'remaining')::int) or
   (body->>'strategy'='manual' and body->'selected_ids' @> jsonb_build_array((item->>'id')::bigint)) then 'ADMITIDO' else 'NO_ADMITIDO' end,
   reason=coalesce(body->>'justification','') where id=(item->>'id')::bigint;
  end loop;
  update admission_private.config set data=data||'{"cut_valid":true}'::jsonb where id=1;
  perform admission_private.log_event(u.id,'EMPATE_RESUELTO',null,body);
  return '{"ok":true}';
 end if;
 if path ~ '^/api/admin/results/[0-9]+/status$' and method='PUT' then
  sid:=split_part(path,'/',5)::bigint;
  if body->>'status'<>'RENUNCIO' or length(trim(coalesce(body->>'reason','')))<5 then raise exception 'Solo se registra la renuncia, con un motivo obligatorio.'; end if;
  select * into s from admission_private.students where id=sid;
  if s.decision<>'ADMITIDO' then raise exception 'Solo puede renunciar un estudiante admitido.'; end if;
  update admission_private.students set decision='RENUNCIO',reason=body->>'reason',version=version+1,updated_at=now(),updated_by=u.id where id=sid;
  t:=admission_private.apply_cut(); perform admission_private.log_event(u.id,'RENUNCIA_REGISTRADA',sid,jsonb_build_object('reason',body->>'reason','replacement_tie',t));
  return jsonb_build_object('ok',true,'tie',t);
 end if;
 if path='/api/admin/config' and method='GET' then return cfg-'dummy_password_hash'; end if;
 if path='/api/admin/config' and method='PUT' then
  if coalesce(body->>'publication_at','')<>'' then perform (body->>'publication_at')::timestamptz; end if;
  if length(coalesce(body->>'admitted_instructions',''))>10000 or length(coalesce(body->>'not_admitted_message',''))>10000 then raise exception 'Mensaje demasiado largo.'; end if;
  update admission_private.config set data=data||jsonb_build_object('publication_at',coalesce(body->>'publication_at',''),
  'published',case when (body->>'published')::boolean then '1' else '0' end,
  'admitted_instructions',body->>'admitted_instructions','not_admitted_message',body->>'not_admitted_message') where id=1;
  perform admission_private.log_event(u.id,'PUBLICACION_CONFIGURADA',null,jsonb_build_object('publication_at',body->>'publication_at','published',body->>'published')); return '{"ok":true}';
 end if;
 if path='/api/admin/users' and method='GET' then return jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(x)-'password_hash' order by id),'[]') from admission_private.users x)); end if;
 if path='/api/admin/users' and method='POST' then
  if trim(coalesce(body->>'username',''))='' or trim(coalesce(body->>'display_name',''))='' or length(coalesce(body->>'password',''))<12
  or octet_length(body->>'password')>72 or body->>'role' not in ('admin','digitador') then raise exception 'Revise los datos. La contraseña debe tener al menos 12 caracteres y hasta 72 bytes.'; end if;
  insert into admission_private.users(username,display_name,password_hash,role) values(trim(body->>'username'),trim(body->>'display_name'),extensions.crypt(body->>'password',extensions.gen_salt('bf',12)),body->>'role');
  perform admission_private.log_event(u.id,'USUARIO_CREADO',null,jsonb_build_object('username',body->>'username','role',body->>'role')); return '{"ok":true}';
 end if;
 if path='/api/admin/audit' and method='GET' then return jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(x) order by id desc),'[]') from (select * from admission_private.audit order by id desc limit 1000) x)); end if;
 if path='/api/admin/import/preview' and method='POST' then
  if jsonb_typeof(body->'rows') is distinct from 'array' or jsonb_array_length(body->'rows')>2000 then raise exception 'El archivo debe contener hasta 2000 estudiantes.'; end if;
  if body->'headers' is distinct from '["identificacion","nombre","apellido1","apellido2","contrasena"]'::jsonb then raise exception 'Los encabezados deben coincidir con la plantilla oficial.'; end if;
  for item in select value from jsonb_array_elements(body->'rows') loop
   idx:=idx+1; issues:='[]';
   if jsonb_typeof(item->'identificacion')<>'string' or jsonb_typeof(item->'contrasena')<>'string' then issues:=issues||'"Identificación y contraseña deben ser texto"'::jsonb; end if;
   if trim(coalesce(item->>'identificacion',''))='' or length(item->>'identificacion')>40 or
   trim(coalesce(item->>'nombre',''))='' or trim(coalesce(item->>'apellido1',''))='' or
   length(item->>'nombre')>100 or length(item->>'apellido1')>100 or length(item->>'apellido2')>100 then issues:=issues||'"Revise identificación, nombre y apellidos"'::jsonb; end if;
   if coalesce(item->>'contrasena','') !~ '^[A-Z0-9]{6}$' then issues:=issues||'"Contraseña inválida"'::jsonb; end if;
   if trim(item->>'identificacion')=any(seen) or exists(select 1 from admission_private.students where identification=trim(item->>'identificacion')) then issues:=issues||'"Identificación duplicada"'::jsonb; dups:=dups+1; end if;
   seen:=array_append(seen,trim(item->>'identificacion'));
   report:=report||jsonb_build_array((item-'contrasena')||jsonb_build_object('row',coalesce((item->>'_row')::int,idx),'issues',issues));
   if jsonb_array_length(issues)=0 then valid:=valid||jsonb_build_array((item-'contrasena')||jsonb_build_object('password_hash',extensions.crypt(item->>'contrasena',extensions.gen_salt('bf',12)))); cnt:=cnt+1;
   else errs:=errs+1; end if;
  end loop;
  tok:=encode(extensions.gen_random_bytes(24),'hex');
  delete from admission_private.imports where expires_at<now();
  insert into admission_private.imports values(tok,u.id,valid,now()+interval '15 minutes');
  return jsonb_build_object('token',tok,'summary',jsonb_build_object('total',idx-1,'ok',cnt,'errors',errs,'duplicates',dups),'rows',report);
 end if;
 if path='/api/admin/import/confirm' and method='POST' then
  select x.rows into rows from admission_private.imports x where token=body->>'token' and user_id=u.id and expires_at>now() for update;
  if rows is null then raise exception 'La validación venció. Vuelva a cargar el archivo.'; end if;
  if exists(select 1 from admission_private.students) then bk:=admission_private.make_backup('preimportacion',backup_key,u.id); end if;
  for item in select value from jsonb_array_elements(rows) loop
   insert into admission_private.students(identification,first_name,last_name1,last_name2,password_hash,updated_by)
   values(trim(item->>'identificacion'),trim(item->>'nombre'),trim(item->>'apellido1'),trim(coalesce(item->>'apellido2','')),item->>'password_hash',u.id)
   on conflict(identification) do nothing; if found then cnt:=cnt+1; end if;
  end loop;
  delete from admission_private.imports where token=body->>'token';
  perform admission_private.invalidate(); perform admission_private.log_event(u.id,'IMPORTACION_COMPLETADA',null,jsonb_build_object('inserted',cnt));
  return jsonb_build_object('inserted',cnt,'skipped',jsonb_array_length(rows)-cnt,'backup',bk);
 end if;
 if path='/api/admin/backup/create' and method='POST' then return admission_private.make_backup('manual',backup_key,u.id); end if;
 if path='/api/admin/backups' and method='GET' then return jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(x) order by id desc),'[]') from (select id,name,cycle_year,students,label,created_at,length(payload) as size from admission_private.backups) x)); end if;
 if path='/api/admin/backup/download' and method='GET' then
  select jsonb_build_object('name',name,'payload',payload,'manifest',jsonb_build_object('app','ctp-canas-admission','version',2,'sha256',sha256,'cycle_year',cycle_year,'students',students,'created_at',created_at,'encrypted',true)) into out from admission_private.backups where id=(body->>'id')::bigint;
  if out is null then return '{"_status":404,"error":"Respaldo no encontrado"}'; end if; return out;
 end if;
 if path in ('/api/admin/restore/preview','/api/admin/restore') and method='POST' then
  snap_hash:=encode(extensions.digest(body->>'payload','sha256'),'hex');
  if snap_hash is distinct from body->>'sha256' then raise exception 'La integridad del respaldo no es válida.'; end if;
  snap:=admission_private.restore_payload(body->>'payload',backup_key);
  if path='/api/admin/restore/preview' then return jsonb_build_object('cycle_year',snap->'config'->>'cycle_year','students',jsonb_array_length(snap->'students'),'users',jsonb_array_length(snap->'users'),'created_at',snap->>'created_at','sha256',snap_hash); end if;
  if body->>'confirmation'<>'RESTAURAR' then raise exception 'Escriba RESTAURAR para confirmar.'; end if;
  current_uid:=u.id; bk:=admission_private.make_backup('prerestauracion',backup_key,u.id);
  delete from admission_private.sessions; delete from admission_private.imports; delete from admission_private.students; delete from admission_private.users;
  insert into admission_private.users select * from jsonb_populate_recordset(null::admission_private.users,snap->'users');
  insert into admission_private.students select * from jsonb_populate_recordset(null::admission_private.students,snap->'students');
  update admission_private.config set data=snap->'config' where id=1;
  -- Keep the audit trail of the state being replaced and incorporate missing restored entries.
  insert into admission_private.audit select * from jsonb_populate_recordset(null::admission_private.audit,snap->'audit') on conflict(id) do nothing;
  perform setval(pg_get_serial_sequence('admission_private.students','id'),coalesce((select max(id) from admission_private.students),1),exists(select 1 from admission_private.students));
  perform setval(pg_get_serial_sequence('admission_private.users','id'),coalesce((select max(id) from admission_private.users),1),exists(select 1 from admission_private.users));
  perform setval(pg_get_serial_sequence('admission_private.audit','id'),coalesce((select max(id) from admission_private.audit),1),exists(select 1 from admission_private.audit));
  if (select count(*) from admission_private.students)<>jsonb_array_length(snap->'students') then raise exception 'Falló la verificación posterior a la restauración.'; end if;
  insert into admission_private.audit(user_id,username,action,detail_json) values(current_uid,u.username,'RESTAURACION_COMPLETADA',jsonb_build_object('prebackup',bk,'sha256',snap_hash));
  return jsonb_build_object('ok',true,'backup',bk);
 end if;
 if path='/api/admin/reset-cycle' and method='POST' then
  if body->>'confirmation'<>'REINICIAR '||(cfg->>'cycle_year') then raise exception 'Escriba la confirmación del ciclo activo.'; end if;
  if (body->>'new_year')::int<=(cfg->>'cycle_year')::int or (body->>'slots')::int<1 or coalesce(body->>'publication_at','')='' or trim(coalesce(body->>'admitted_instructions',''))='' then raise exception 'Defina el nuevo ciclo, cupos, publicación e indicaciones.'; end if;
  perform (body->>'publication_at')::timestamptz;
  bk:=admission_private.make_backup('final_ciclo',backup_key,u.id);
  delete from admission_private.students; delete from admission_private.imports;
  update admission_private.config set data=data||jsonb_build_object('cycle_year',body->>'new_year','slots',body->>'slots',
  'publication_at',body->>'publication_at','published','0','cut_valid',false,'admitted_instructions',body->>'admitted_instructions') where id=1;
  perform admission_private.log_event(u.id,'CICLO_REINICIADO',null,jsonb_build_object('previous',cfg->>'cycle_year','new',body->>'new_year','backup',bk));
  return jsonb_build_object('ok',true,'new_year',body->>'new_year','backup',bk->>'name');
 end if;
 if path='/api/admin/report' and method='GET' then
  select coalesce(jsonb_agg(admission_private.student_json(r) order by position nulls last,name),'[]') into rows from admission_private.records r;
  return jsonb_build_object('rows',rows,'config',cfg-'dummy_password_hash','draft',not (cfg->>'cut_valid')::boolean or exists(select 1 from admission_private.records where total is null or status in ('PENDIENTE','PENDIENTE_EMPATE')),
  'tie_resolved',exists(select 1 from admission_private.audit where action='EMPATE_RESUELTO'));
 end if;
 return '{"_status":404,"error":"Operación no encontrada"}';
exception when unique_violation then return '{"_status":409,"error":"La identificación o el usuario ya existe"}';
 when invalid_text_representation or check_violation or not_null_violation then return '{"_status":400,"error":"Datos no válidos"}';
 when raise_exception then return jsonb_build_object('_status',400,'error',sqlerrm);
end; $$;

create function public.admission_bootstrap(password text) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(202709);
 if exists(select 1 from admission_private.users) then raise exception 'El administrador inicial ya existe.'; end if;
 if password is null or length(password)<12 or octet_length(password)>72 then raise exception 'La contraseña debe tener al menos 12 caracteres y hasta 72 bytes.'; end if;
 insert into admission_private.users(username,display_name,password_hash,role)
 values('Admi2026','Administración principal',extensions.crypt(password,extensions.gen_salt('bf',12)),'principal');
end; $$;

do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='admission_private' loop
  execute format('alter table admission_private.%I enable row level security',t);
 end loop;
end $$;
revoke all on all tables in schema admission_private from public,anon,authenticated;
revoke all on all sequences in schema admission_private from public,anon,authenticated;
revoke all on all functions in schema admission_private from public,anon,authenticated;
grant all on all tables in schema admission_private to service_role;
grant usage,select on all sequences in schema admission_private to service_role;
grant execute on all functions in schema admission_private to service_role;
revoke all on function public.admission_api(text,text,jsonb,text,text,text,text) from public,anon,authenticated;
revoke all on function public.admission_bootstrap(text) from public,anon,authenticated;
grant execute on function public.admission_api(text,text,jsonb,text,text,text,text) to service_role;
grant execute on function public.admission_bootstrap(text) to service_role;
