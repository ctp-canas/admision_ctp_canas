-- ================================================================
-- Sistema de resultados de admisión a sétimo año - CTP Cañas
-- Ejecute este archivo completo en Supabase > SQL Editor.
-- Diseñado para PostgreSQL/Supabase con RLS y funciones RPC seguras.
-- ================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tipos y funciones auxiliares ----------

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'estado_admision_tipo'
  ) then
    create type public.estado_admision_tipo as enum (
      'Admitido',
      'No Admitido',
      'En lista de espera'
    );
  end if;
end
$$;

create or replace function public.normalizar_cedula(p_valor text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.regexp_replace(pg_catalog.upper(pg_catalog.btrim(p_valor)), '[^0-9A-Z]', '', 'g');
$$;

-- ---------- Tablas ----------

create table if not exists public.estudiantes (
  cedula text primary key,
  contrasena_hash text not null,
  nombre text not null,
  primer_apellido text not null,
  segundo_apellido text not null default '',
  estado_admision public.estado_admision_tipo not null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint estudiantes_cedula_normalizada check (cedula = public.normalizar_cedula(cedula)),
  constraint estudiantes_cedula_longitud check (char_length(cedula) between 5 and 20),
  constraint estudiantes_nombre_longitud check (char_length(btrim(nombre)) between 1 and 80),
  constraint estudiantes_apellido_longitud check (char_length(btrim(primer_apellido)) between 1 and 80),
  constraint estudiantes_segundo_apellido_longitud check (char_length(segundo_apellido) <= 80)
);

create index if not exists estudiantes_nombre_busqueda_idx
  on public.estudiantes (primer_apellido, segundo_apellido, nombre);

create table if not exists public.administradores (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table if not exists public.configuracion_sistema (
  id boolean primary key default true check (id),
  ciclo_lectivo integer not null default 2027 check (ciclo_lectivo between 2027 and 2100),
  inicio timestamptz not null,
  fin timestamptz not null,
  habilitado boolean not null default false,
  zona_horaria text not null default 'America/Costa_Rica',
  hash_falso text not null,
  actualizado_por uuid references auth.users(id) on delete set null,
  actualizado_en timestamptz not null default now(),
  constraint configuracion_fechas_validas check (fin > inicio)
);

insert into public.configuracion_sistema (
  id,
  ciclo_lectivo,
  inicio,
  fin,
  habilitado,
  hash_falso
)
values (
  true,
  2027,
  '2026-11-01 08:00:00-06',
  '2026-12-20 17:00:00-06',
  false,
  extensions.crypt('credencial-inexistente', extensions.gen_salt('bf', 10))
)
on conflict (id) do nothing;

create table if not exists public.intentos_consulta (
  cedula_hash text primary key,
  intentos integer not null default 0,
  ventana_inicio timestamptz not null default now(),
  bloqueado_hasta timestamptz,
  actualizado_en timestamptz not null default now()
);

create table if not exists public.bitacora_administrativa (
  id bigint generated always as identity primary key,
  usuario_id uuid references auth.users(id) on delete set null,
  accion text not null,
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);

create index if not exists configuracion_sistema_actualizado_por_idx
  on public.configuracion_sistema (actualizado_por);

create index if not exists bitacora_administrativa_fecha_idx
  on public.bitacora_administrativa (creado_en desc);

create index if not exists bitacora_administrativa_usuario_id_idx
  on public.bitacora_administrativa (usuario_id);

-- ---------- Seguridad de tablas ----------

alter table public.estudiantes enable row level security;
alter table public.administradores enable row level security;
alter table public.configuracion_sistema enable row level security;
alter table public.intentos_consulta enable row level security;
alter table public.bitacora_administrativa enable row level security;

-- No se crean políticas de acceso directo. Toda operación se realiza por RPC.
revoke all on table public.estudiantes from anon, authenticated;
revoke all on table public.administradores from anon, authenticated;
revoke all on table public.configuracion_sistema from anon, authenticated;
revoke all on table public.intentos_consulta from anon, authenticated;
revoke all on table public.bitacora_administrativa from anon, authenticated;

-- ---------- Autorización administrativa ----------

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.administradores a
    where a.usuario_id = auth.uid()
      and a.activo = true
  );
$$;

-- ---------- Funciones públicas ----------

create or replace function public.estado_sistema()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.configuracion_sistema%rowtype;
  v_estado text;
begin
  select * into v_config
  from public.configuracion_sistema
  where id = true;

  if not found then
    return jsonb_build_object(
      'estado', 'deshabilitado',
      'mensaje', 'La publicación aún no ha sido configurada.'
    );
  end if;

  v_estado := case
    when not v_config.habilitado then 'deshabilitado'
    when pg_catalog.now() < v_config.inicio then 'programado'
    when pg_catalog.now() > v_config.fin then 'cerrado'
    else 'disponible'
  end;

  return jsonb_build_object(
    'estado', v_estado,
    'inicio', v_config.inicio,
    'fin', v_config.fin,
    'ciclo_lectivo', v_config.ciclo_lectivo,
    'zona_horaria', v_config.zona_horaria
  );
end;
$$;

create or replace function public.consultar_resultado(
  p_cedula text,
  p_contrasena text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_config public.configuracion_sistema%rowtype;
  v_cedula text;
  v_clave_intento text;
  v_intento public.intentos_consulta%rowtype;
  v_hash text;
  v_nombre text;
  v_primer_apellido text;
  v_segundo_apellido text;
  v_estado public.estado_admision_tipo;
  v_encontrado boolean := false;
  v_clave_valida boolean := false;
  v_nuevos_intentos integer;
begin
  select * into v_config
  from public.configuracion_sistema
  where id = true;

  if not found
     or not v_config.habilitado
     or pg_catalog.now() < v_config.inicio
     or pg_catalog.now() > v_config.fin then
    return jsonb_build_object(
      'codigo', 'no_disponible',
      'mensaje', 'La consulta no está disponible en este momento.'
    );
  end if;

  v_cedula := public.normalizar_cedula(coalesce(p_cedula, ''));
  if pg_catalog.char_length(v_cedula) not between 5 and 20
     or pg_catalog.char_length(coalesce(p_contrasena, '')) not between 1 and 72 then
    return jsonb_build_object('codigo', 'credenciales_invalidas');
  end if;

  v_clave_intento := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_cedula, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.intentos_consulta (cedula_hash)
  values (v_clave_intento)
  on conflict (cedula_hash) do nothing;

  select * into v_intento
  from public.intentos_consulta
  where cedula_hash = v_clave_intento
  for update;

  if v_intento.bloqueado_hasta is not null
     and v_intento.bloqueado_hasta > pg_catalog.now() then
    return jsonb_build_object(
      'codigo', 'bloqueado',
      'mensaje', 'Se alcanzó el máximo de intentos. Espere 15 minutos antes de volver a intentarlo.'
    );
  end if;

  if v_intento.ventana_inicio < pg_catalog.now() - interval '15 minutes' then
    update public.intentos_consulta
    set intentos = 0,
        ventana_inicio = pg_catalog.now(),
        bloqueado_hasta = null,
        actualizado_en = pg_catalog.now()
    where cedula_hash = v_clave_intento;
    v_intento.intentos := 0;
  end if;

  select
    e.contrasena_hash,
    e.nombre,
    e.primer_apellido,
    e.segundo_apellido,
    e.estado_admision
  into
    v_hash,
    v_nombre,
    v_primer_apellido,
    v_segundo_apellido,
    v_estado
  from public.estudiantes e
  where e.cedula = v_cedula;

  v_encontrado := found;
  v_hash := coalesce(v_hash, v_config.hash_falso);
  v_clave_valida := extensions.crypt(p_contrasena, v_hash) = v_hash;

  if not v_encontrado
     or not v_clave_valida then
    v_nuevos_intentos := v_intento.intentos + 1;
    update public.intentos_consulta
    set intentos = v_nuevos_intentos,
        bloqueado_hasta = case
          when v_nuevos_intentos >= 5 then pg_catalog.now() + interval '15 minutes'
          else null
        end,
        actualizado_en = pg_catalog.now()
    where cedula_hash = v_clave_intento;

    if v_nuevos_intentos >= 5 then
      return jsonb_build_object(
        'codigo', 'bloqueado',
        'mensaje', 'Se alcanzó el máximo de intentos. Espere 15 minutos antes de volver a intentarlo.'
      );
    end if;
    return jsonb_build_object('codigo', 'credenciales_invalidas');
  end if;

  delete from public.intentos_consulta where cedula_hash = v_clave_intento;

  return jsonb_build_object(
    'codigo', 'ok',
    'nombre_completo', pg_catalog.concat_ws(
      ' ',
      pg_catalog.btrim(v_nombre),
      pg_catalog.btrim(v_primer_apellido),
      nullif(pg_catalog.btrim(v_segundo_apellido), '')
    ),
    'estado_admision', v_estado::text
  );
end;
$$;

-- ---------- Funciones administrativas ----------

create or replace function public.admin_obtener_configuracion()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.configuracion_sistema%rowtype;
  v_estado text;
begin
  if not public.es_admin() then
    raise insufficient_privilege using message = 'No autorizado';
  end if;

  select * into strict v_config
  from public.configuracion_sistema
  where id = true;

  v_estado := case
    when not v_config.habilitado then 'deshabilitado'
    when pg_catalog.now() < v_config.inicio then 'programado'
    when pg_catalog.now() > v_config.fin then 'cerrado'
    else 'disponible'
  end;

  return jsonb_build_object(
    'inicio', v_config.inicio,
    'fin', v_config.fin,
    'habilitado', v_config.habilitado,
    'ciclo_lectivo', v_config.ciclo_lectivo,
    'zona_horaria', v_config.zona_horaria,
    'estado', v_estado
  );
end;
$$;

create or replace function public.admin_guardar_configuracion(
  p_inicio timestamptz,
  p_fin timestamptz,
  p_habilitado boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise insufficient_privilege using message = 'No autorizado';
  end if;

  if p_inicio is null or p_fin is null or p_fin <= p_inicio then
    return jsonb_build_object(
      'codigo', 'datos_invalidos',
      'mensaje', 'La fecha de cierre debe ser posterior a la fecha de inicio.'
    );
  end if;

  update public.configuracion_sistema
  set inicio = p_inicio,
      fin = p_fin,
      habilitado = coalesce(p_habilitado, false),
      actualizado_por = auth.uid(),
      actualizado_en = pg_catalog.now()
  where id = true;

  insert into public.bitacora_administrativa (usuario_id, accion, detalle)
  values (
    auth.uid(),
    'ACTUALIZAR_HORARIO',
    jsonb_build_object('inicio', p_inicio, 'fin', p_fin, 'habilitado', p_habilitado)
  );

  return jsonb_build_object('codigo', 'ok');
end;
$$;

create or replace function public.admin_listar_estudiantes(
  p_busqueda text default '',
  p_limite integer default 25,
  p_desde integer default 0
)
returns table (
  cedula text,
  nombre text,
  primer_apellido text,
  segundo_apellido text,
  estado_admision text,
  actualizado_en timestamptz,
  total_registros bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_busqueda text := pg_catalog.btrim(coalesce(p_busqueda, ''));
  v_limite integer := least(greatest(coalesce(p_limite, 25), 1), 100);
  v_desde integer := greatest(coalesce(p_desde, 0), 0);
begin
  if not public.es_admin() then
    raise insufficient_privilege using message = 'No autorizado';
  end if;

  return query
  select
    e.cedula,
    e.nombre,
    e.primer_apellido,
    e.segundo_apellido,
    e.estado_admision::text,
    e.actualizado_en,
    pg_catalog.count(*) over() as total_registros
  from public.estudiantes e
  where v_busqueda = ''
     or e.cedula ilike '%' || v_busqueda || '%'
     or e.nombre ilike '%' || v_busqueda || '%'
     or e.primer_apellido ilike '%' || v_busqueda || '%'
     or e.segundo_apellido ilike '%' || v_busqueda || '%'
     or pg_catalog.concat_ws(' ', e.nombre, e.primer_apellido, e.segundo_apellido)
        ilike '%' || v_busqueda || '%'
  order by e.primer_apellido, e.segundo_apellido, e.nombre
  limit v_limite
  offset v_desde;
end;
$$;

create or replace function public.admin_guardar_estudiante(
  p_cedula_original text,
  p_cedula text,
  p_contrasena text,
  p_nombre text,
  p_primer_apellido text,
  p_segundo_apellido text,
  p_estado_admision text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_original text := public.normalizar_cedula(coalesce(p_cedula_original, ''));
  v_cedula text := public.normalizar_cedula(coalesce(p_cedula, ''));
  v_estado public.estado_admision_tipo;
  v_es_nuevo boolean := v_original = '';
begin
  if not public.es_admin() then
    raise insufficient_privilege using message = 'No autorizado';
  end if;

  if pg_catalog.char_length(v_cedula) not between 5 and 20
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_nombre, ''))) not between 1 and 80
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_primer_apellido, ''))) not between 1 and 80
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_segundo_apellido, ''))) > 80 then
    return jsonb_build_object('codigo', 'datos_invalidos', 'mensaje', 'Revise la cédula, el nombre y los apellidos.');
  end if;

  begin
    v_estado := p_estado_admision::public.estado_admision_tipo;
  exception when invalid_text_representation then
    return jsonb_build_object('codigo', 'datos_invalidos', 'mensaje', 'El estado de admisión no es válido.');
  end;
  if v_estado is null then
    return jsonb_build_object('codigo', 'datos_invalidos', 'mensaje', 'El estado de admisión no es válido.');
  end if;

  if v_es_nuevo then
    if pg_catalog.char_length(coalesce(p_contrasena, '')) not between 6 and 72 then
      return jsonb_build_object('codigo', 'datos_invalidos', 'mensaje', 'La contraseña debe tener de 6 a 72 caracteres.');
    end if;

    if exists (select 1 from public.estudiantes e where e.cedula = v_cedula) then
      return jsonb_build_object('codigo', 'duplicado', 'mensaje', 'Ya existe un registro con esa cédula.');
    end if;

    insert into public.estudiantes (
      cedula, contrasena_hash, nombre, primer_apellido, segundo_apellido, estado_admision
    ) values (
      v_cedula,
      extensions.crypt(p_contrasena, extensions.gen_salt('bf', 10)),
      pg_catalog.btrim(p_nombre),
      pg_catalog.btrim(p_primer_apellido),
      pg_catalog.btrim(coalesce(p_segundo_apellido, '')),
      v_estado
    );
  else
    if p_contrasena is not null
       and pg_catalog.char_length(p_contrasena) not between 6 and 72 then
      return jsonb_build_object('codigo', 'datos_invalidos', 'mensaje', 'La contraseña debe tener de 6 a 72 caracteres.');
    end if;

    if v_cedula <> v_original
       and exists (select 1 from public.estudiantes e where e.cedula = v_cedula) then
      return jsonb_build_object('codigo', 'duplicado', 'mensaje', 'Ya existe otro registro con esa cédula.');
    end if;

    update public.estudiantes
    set cedula = v_cedula,
        contrasena_hash = case
          when p_contrasena is null then contrasena_hash
          else extensions.crypt(p_contrasena, extensions.gen_salt('bf', 10))
        end,
        nombre = pg_catalog.btrim(p_nombre),
        primer_apellido = pg_catalog.btrim(p_primer_apellido),
        segundo_apellido = pg_catalog.btrim(coalesce(p_segundo_apellido, '')),
        estado_admision = v_estado,
        actualizado_en = pg_catalog.now()
    where cedula = v_original;

    if not found then
      return jsonb_build_object('codigo', 'no_encontrado', 'mensaje', 'El registro que intenta editar ya no existe.');
    end if;
  end if;

  insert into public.bitacora_administrativa (usuario_id, accion, detalle)
  values (
    auth.uid(),
    case when v_es_nuevo then 'CREAR_ESTUDIANTE' else 'EDITAR_ESTUDIANTE' end,
    jsonb_build_object('cedula', v_cedula)
  );

  return jsonb_build_object('codigo', 'ok', 'cedula', v_cedula);
end;
$$;

create or replace function public.admin_eliminar_estudiante(p_cedula text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cedula text := public.normalizar_cedula(coalesce(p_cedula, ''));
begin
  if not public.es_admin() then
    raise insufficient_privilege using message = 'No autorizado';
  end if;

  delete from public.estudiantes where cedula = v_cedula;
  if not found then
    return jsonb_build_object('codigo', 'no_encontrado', 'mensaje', 'El registro ya no existe.');
  end if;

  insert into public.bitacora_administrativa (usuario_id, accion, detalle)
  values (auth.uid(), 'ELIMINAR_ESTUDIANTE', jsonb_build_object('cedula', v_cedula));

  return jsonb_build_object('codigo', 'ok');
end;
$$;

create or replace function public.admin_importar_estudiantes(p_registros jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_registro jsonb;
  v_cedula text;
  v_contrasena text;
  v_nombre text;
  v_primer_apellido text;
  v_segundo_apellido text;
  v_estado public.estado_admision_tipo;
  v_procesados integer := 0;
  v_fila integer := 0;
begin
  if not public.es_admin() then
    raise insufficient_privilege using message = 'No autorizado';
  end if;

  if p_registros is null
     or pg_catalog.jsonb_typeof(p_registros) <> 'array'
     or pg_catalog.jsonb_array_length(p_registros) not between 1 and 500 then
    return jsonb_build_object('codigo', 'datos_invalidos', 'mensaje', 'El lote debe contener entre 1 y 500 registros.');
  end if;

  for v_registro in select value from pg_catalog.jsonb_array_elements(p_registros)
  loop
    v_fila := v_fila + 1;
    v_cedula := public.normalizar_cedula(coalesce(v_registro->>'cedula', ''));
    v_contrasena := coalesce(v_registro->>'contrasena', '');
    v_nombre := pg_catalog.btrim(coalesce(v_registro->>'nombre', ''));
    v_primer_apellido := pg_catalog.btrim(coalesce(v_registro->>'primer_apellido', ''));
    v_segundo_apellido := pg_catalog.btrim(coalesce(v_registro->>'segundo_apellido', ''));

    if pg_catalog.char_length(v_cedula) not between 5 and 20
       or pg_catalog.char_length(v_contrasena) not between 6 and 72
       or pg_catalog.char_length(v_nombre) not between 1 and 80
       or pg_catalog.char_length(v_primer_apellido) not between 1 and 80
       or pg_catalog.char_length(v_segundo_apellido) > 80 then
      return jsonb_build_object(
        'codigo', 'datos_invalidos',
        'mensaje', pg_catalog.format('El registro %s contiene datos incompletos o fuera de los límites permitidos.', v_fila)
      );
    end if;

    begin
      v_estado := (v_registro->>'estado_admision')::public.estado_admision_tipo;
    exception when invalid_text_representation then
      return jsonb_build_object(
        'codigo', 'datos_invalidos',
        'mensaje', pg_catalog.format('El estado de admisión del registro %s no es válido.', v_fila)
      );
    end;
    if v_estado is null then
      return jsonb_build_object(
        'codigo', 'datos_invalidos',
        'mensaje', pg_catalog.format('El estado de admisión del registro %s no es válido.', v_fila)
      );
    end if;

    insert into public.estudiantes (
      cedula, contrasena_hash, nombre, primer_apellido, segundo_apellido, estado_admision
    ) values (
      v_cedula,
      extensions.crypt(v_contrasena, extensions.gen_salt('bf', 10)),
      v_nombre,
      v_primer_apellido,
      v_segundo_apellido,
      v_estado
    )
    on conflict (cedula) do update
    set contrasena_hash = excluded.contrasena_hash,
        nombre = excluded.nombre,
        primer_apellido = excluded.primer_apellido,
        segundo_apellido = excluded.segundo_apellido,
        estado_admision = excluded.estado_admision,
        actualizado_en = pg_catalog.now();

    v_procesados := v_procesados + 1;
  end loop;

  insert into public.bitacora_administrativa (usuario_id, accion, detalle)
  values (auth.uid(), 'IMPORTAR_ESTUDIANTES', jsonb_build_object('cantidad', v_procesados));

  return jsonb_build_object('codigo', 'ok', 'procesados', v_procesados);
end;
$$;

create or replace function public.admin_vaciar_estudiantes(p_confirmacion text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_eliminados bigint;
begin
  if not public.es_admin() then
    raise insufficient_privilege using message = 'No autorizado';
  end if;

  if p_confirmacion is distinct from 'ELIMINAR TODO' then
    return jsonb_build_object('codigo', 'confirmacion_invalida', 'mensaje', 'La frase de confirmación no coincide.');
  end if;

  delete from public.estudiantes;
  get diagnostics v_eliminados = row_count;
  delete from public.intentos_consulta;

  insert into public.bitacora_administrativa (usuario_id, accion, detalle)
  values (auth.uid(), 'VACIAR_ESTUDIANTES', jsonb_build_object('cantidad', v_eliminados));

  return jsonb_build_object('codigo', 'ok', 'eliminados', v_eliminados);
end;
$$;

-- ---------- Permisos de funciones ----------

revoke all on function public.normalizar_cedula(text) from public, anon, authenticated;
revoke all on function public.es_admin() from public, anon, authenticated;
revoke all on function public.estado_sistema() from public, anon, authenticated;
revoke all on function public.consultar_resultado(text, text) from public, anon, authenticated;
revoke all on function public.admin_obtener_configuracion() from public, anon, authenticated;
revoke all on function public.admin_guardar_configuracion(timestamptz, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.admin_listar_estudiantes(text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_guardar_estudiante(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_eliminar_estudiante(text) from public, anon, authenticated;
revoke all on function public.admin_importar_estudiantes(jsonb) from public, anon, authenticated;
revoke all on function public.admin_vaciar_estudiantes(text) from public, anon, authenticated;

grant execute on function public.estado_sistema() to anon, authenticated;
grant execute on function public.consultar_resultado(text, text) to anon, authenticated;

grant execute on function public.es_admin() to authenticated;
grant execute on function public.admin_obtener_configuracion() to authenticated;
grant execute on function public.admin_guardar_configuracion(timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.admin_listar_estudiantes(text, integer, integer) to authenticated;
grant execute on function public.admin_guardar_estudiante(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_eliminar_estudiante(text) to authenticated;
grant execute on function public.admin_importar_estudiantes(jsonb) to authenticated;
grant execute on function public.admin_vaciar_estudiantes(text) to authenticated;

commit;

-- ================================================================
-- PASO MANUAL PARA AUTORIZAR OTRO ADMINISTRADOR
-- 1. Cree el usuario en Authentication > Users > Add user. Para conservar
--    el acceso mediante nombre de usuario, use el correo interno:
--    USUARIO@admin.ctpcanas.invalid
-- 2. Copie el UUID de ese usuario.
-- 3. Ejecute, sustituyendo el valor de ejemplo:
--
-- insert into public.administradores (usuario_id)
-- values ('00000000-0000-0000-0000-000000000000');
--
-- No guarde la contraseña administrativa en ninguna tabla pública ni archivo
-- que vaya a publicarse en GitHub Pages.
-- ================================================================
