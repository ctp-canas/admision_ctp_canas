-- Recovery proves email ownership through Supabase Auth; application passwords and
-- opaque administrative sessions remain in the existing private admission schema.
alter table admission_private.users add column if not exists email text;
alter table admission_private.users add column if not exists recovery_auth_id uuid;
create unique index if not exists admission_users_email_unique on admission_private.users(lower(email)) where email is not null;
create unique index if not exists admission_users_recovery_auth_unique on admission_private.users(recovery_auth_id) where recovery_auth_id is not null;
create table if not exists admission_private.password_recovery_pending (
 user_id bigint primary key references admission_private.users on delete cascade,
 requested_at timestamptz not null, expires_at timestamptz not null);
create table if not exists admission_private.password_recovery_used (
 session_hash text primary key check(session_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz not null);
alter table admission_private.password_recovery_pending enable row level security;
alter table admission_private.password_recovery_used enable row level security;
revoke all on admission_private.password_recovery_pending,admission_private.password_recovery_used from public,anon,authenticated;
grant all on admission_private.password_recovery_pending,admission_private.password_recovery_used to service_role;

create or replace function public.admission_password_recovery(action text, payload jsonb, ip_hash text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare u admission_private.users; pending admission_private.password_recovery_pending; k text; tries int; account text;
begin
 if action='request' then
  account:=left(trim(coalesce(payload->>'username','')),100);
  foreach k in array array['recovery:ip:'||ip_hash,'recovery:account:'||account] loop
   insert into admission_private.rate_limits(key,started_at,attempts) values(k,now(),1)
   on conflict(key) do update set
    attempts=case when admission_private.rate_limits.started_at<now()-interval '1 hour' then 1 else admission_private.rate_limits.attempts+1 end,
    started_at=case when admission_private.rate_limits.started_at<now()-interval '1 hour' then now() else admission_private.rate_limits.started_at end
   returning attempts into tries;
   if tries>(case when k like 'recovery:account:%' then 3 else 10 end) then
    return '{"_status":429,"error":"Demasiadas solicitudes. Espere una hora antes de solicitar otro enlace."}';
   end if;
  end loop;
  select * into u from admission_private.users where username=account and active
   and email=lower(trim(payload->>'email')) and email is not null;
  if u.id is null then return '{}'; end if;
  return jsonb_build_object('id',u.id,'email',u.email,'auth_id',u.recovery_auth_id);
 elsif action='verify' then
  insert into admission_private.rate_limits(key,started_at,attempts) values('recovery:verify:'||ip_hash,now(),1)
  on conflict(key) do update set
   attempts=case when admission_private.rate_limits.started_at<now()-interval '15 minutes' then 1 else admission_private.rate_limits.attempts+1 end,
   started_at=case when admission_private.rate_limits.started_at<now()-interval '15 minutes' then now() else admission_private.rate_limits.started_at end
  returning attempts into tries;
  if tries>20 then return '{"_status":429,"error":"Demasiados intentos de recuperación. Espere 15 minutos."}'; end if;
  return '{"ok":true}';
 elsif action='bind' then
  update admission_private.users set recovery_auth_id=(payload->>'auth_id')::uuid
   where id=(payload->>'id')::bigint and email=payload->>'email' and active and recovery_auth_id is null;
  select * into u from admission_private.users where id=(payload->>'id')::bigint and email=payload->>'email' and active;
  if u.recovery_auth_id is null then raise exception 'No fue posible vincular la recuperación.'; end if;
  return jsonb_build_object('auth_id',u.recovery_auth_id);
 elsif action='sent' then
  select * into u from admission_private.users where id=(payload->>'id')::bigint and email=payload->>'email' and active
   and recovery_auth_id=(payload->>'auth_id')::uuid;
  if u.id is null then return '{"_status":400,"error":"Los datos de recuperación cambiaron. Solicite otro enlace."}'; end if;
  insert into admission_private.password_recovery_pending(user_id,requested_at,expires_at)
   values(u.id,now(),now()+interval '30 minutes') on conflict(user_id) do update set requested_at=excluded.requested_at,expires_at=excluded.expires_at;
  perform admission_private.log_event(u.id,'RECUPERACION_SOLICITADA');
  return '{"ok":true}';
 elsif action='failed' then
  delete from admission_private.password_recovery_pending where user_id=(payload->>'id')::bigint;
  return '{"ok":true}';
 elsif action='complete' then
  if length(coalesce(payload->>'password',''))<12 or octet_length(payload->>'password')>72 then
   return '{"_status":400,"error":"La contraseña debe tener al menos 12 caracteres y un máximo de 72 bytes."}';
  end if;
  if coalesce(payload->>'session_hash','') !~ '^[a-f0-9]{64}$' then return '{"_status":401,"error":"Enlace de recuperación inválido."}'; end if;
  select * into u from admission_private.users where recovery_auth_id=(payload->>'auth_id')::uuid
   and email=lower(payload->>'email') and active for update;
  select * into pending from admission_private.password_recovery_pending where user_id=u.id for update;
  if u.id is null or pending.user_id is null or pending.expires_at<=now()
   or coalesce((payload->>'recovery_time')::numeric,0)<floor(extract(epoch from pending.requested_at))
   or (payload->>'recovery_time')::numeric>extract(epoch from now())+60
   or exists(select 1 from admission_private.password_recovery_used where session_hash=payload->>'session_hash') then
   return '{"_status":401,"error":"El enlace venció o ya fue utilizado. Solicite uno nuevo."}';
  end if;
  insert into admission_private.password_recovery_used values(payload->>'session_hash',now()+interval '1 day');
  update admission_private.users set password_hash=extensions.crypt(payload->>'password',extensions.gen_salt('bf',12)) where id=u.id;
  delete from admission_private.sessions where user_id=u.id;
  delete from admission_private.password_recovery_pending where user_id=u.id;
  delete from admission_private.password_recovery_used where expires_at<now();
  perform admission_private.log_event(u.id,'CONTRASENA_RECUPERADA');
  return '{"ok":true,"message":"Contraseña actualizada. Ingrese con su usuario y la contraseña nueva."}';
 end if;
 return '{"_status":404,"error":"Operación no encontrada"}';
exception when others then
 return '{"_status":400,"error":"No fue posible completar la recuperación. Solicite un enlace nuevo."}';
end; $$;
revoke all on function public.admission_password_recovery(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.admission_password_recovery(text,jsonb,text) to service_role;
