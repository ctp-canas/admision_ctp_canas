-- Apply before update-public-result.sql. Existing students remain unassigned.
alter table admission_private.students
 add column if not exists exam_date date,
 add column if not exists exam_block smallint,
 add column if not exists exam_schedule_version integer not null default 0;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='admission_private.students'::regclass and conname='students_exam_schedule_check') then
  alter table admission_private.students add constraint students_exam_schedule_check check (
   (exam_date is null and exam_block is null) or
   (exam_date is not null and exam_block is not null and exam_block between 1 and 3
    and extract(month from exam_date)=10 and extract(day from exam_date) between 27 and 29));
 end if;
end; $$;

-- Invoked only by the authenticated admission_api gateway, never by a browser.
create or replace function admission_private.exam_schedule(method text, path text, payload jsonb, uid bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg jsonb; dates jsonb; blocks jsonb; groups jsonb; rows jsonb; item jsonb;
 target_date date; target_block smallint; old_row admission_private.students; changed int:=0;
begin
 select data into cfg from admission_private.config where id=1;
 select jsonb_agg(to_char(make_date((cfg->>'cycle_year')::int-1,10,d),'YYYY-MM-DD') order by d)
 into dates from generate_series(27,29) d;
 blocks:='[{"id":1,"label":"Primer bloque","start":"08:00","end":"10:00","time_label":"8:00 a.m. a 10:00 a.m."},
 {"id":2,"label":"Segundo bloque","start":"11:00","end":"13:00","time_label":"11:00 a.m. a 1:00 p.m."},
 {"id":3,"label":"Tercer bloque","start":"14:00","end":"16:00","time_label":"2:00 p.m. a 4:00 p.m."}]';
 if method='GET' and path='/api/admin/exam-schedule' then
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'identification',s.identification,
   'name',concat_ws(' ',s.first_name,s.last_name1,nullif(s.last_name2,'')),
   'date',s.exam_date,'block',s.exam_block,'version',s.exam_schedule_version)
   order by s.last_name1,s.last_name2,s.first_name,s.id),'[]') into rows from admission_private.students s;
  select jsonb_agg(jsonb_build_object('date',d.value,'block',b.value->'id','count',
   (select count(*) from admission_private.students s where s.exam_date=d.value::date and s.exam_block=(b.value->>'id')::int))
   order by d.value,(b.value->>'id')::int) into groups from jsonb_array_elements_text(dates) d cross join jsonb_array_elements(blocks) b;
  return jsonb_build_object('cycle_year',cfg->>'cycle_year','timezone','America/Costa_Rica','dates',dates,'blocks',blocks,'rows',rows,
   'summary',jsonb_build_object('total',jsonb_array_length(rows),'assigned',(select count(*) from admission_private.students where exam_date is not null),
   'unassigned',(select count(*) from admission_private.students where exam_date is null),'by_slot',groups));
 end if;
 if method='GET' and path='/api/admin/exam-attendance' then
  if nullif(payload->>'date','') is not null and not dates ? (payload->>'date') then raise exception 'Seleccione una fecha válida de la prueba.'; end if;
  if nullif(payload->>'block','') is not null and payload->>'block' not in ('1','2','3') then raise exception 'Seleccione un bloque válido.'; end if;
  select jsonb_agg(jsonb_build_object('date',d.value,'block',b.value->'id','label',b.value->>'label','time_label',b.value->>'time_label',
   'rows',(select coalesce(jsonb_agg(jsonb_build_object('identification',s.identification,
    'name',concat_ws(' ',s.first_name,s.last_name1,nullif(s.last_name2,''))) order by s.last_name1,s.last_name2,s.first_name,s.id),'[]')
    from admission_private.students s where s.exam_date=d.value::date and s.exam_block=(b.value->>'id')::int))
   order by d.value,(b.value->>'id')::int) into groups
   from jsonb_array_elements_text(dates) d cross join jsonb_array_elements(blocks) b
   where (nullif(payload->>'date','') is null or d.value=payload->>'date')
    and (nullif(payload->>'block','') is null or b.value->>'id'=payload->>'block');
  return jsonb_build_object('cycle_year',cfg->>'cycle_year','timezone','America/Costa_Rica','groups',groups);
 end if;
 if method='PUT' and path='/api/admin/exam-schedule' then
  if jsonb_typeof(payload->'students') is distinct from 'array' then raise exception 'Seleccione al menos un estudiante.'; end if;
  if jsonb_array_length(payload->'students') not between 1 and 2000 then raise exception 'Seleccione entre 1 y 2000 estudiantes.'; end if;
  if not (payload ? 'date' and payload ? 'block') then raise exception 'Indique la fecha y el bloque.'; end if;
  if (payload->>'date' is null)<>(payload->>'block' is null) then raise exception 'Indique la fecha y el bloque completos.'; end if;
  if payload->>'date' is not null then
   if not dates ? (payload->>'date') then raise exception 'Seleccione una fecha válida de la prueba.'; end if;
   if payload->>'block' not in ('1','2','3') then raise exception 'Seleccione un bloque válido.'; end if;
   target_date:=(payload->>'date')::date; target_block:=(payload->>'block')::smallint;
  end if;
  if exists(select 1 from jsonb_array_elements(payload->'students') a where
   jsonb_typeof(a->'id') is distinct from 'number' or coalesce(a->>'id','') !~ '^[1-9][0-9]{0,17}$'
   or jsonb_typeof(a->'version') is distinct from 'number' or coalesce(a->>'version','') !~ '^[0-9]{1,9}$') then
   raise exception 'La selección de estudiantes no es válida. Actualice la lista.';
  end if;
  if (select count(distinct a->>'id') from jsonb_array_elements(payload->'students') a)<>jsonb_array_length(payload->'students') then
   raise exception 'No repita estudiantes en la selección.';
  end if;
  if exists(select 1 from jsonb_array_elements(payload->'students') a where not exists(select 1 from admission_private.students s where s.id=(a->>'id')::bigint)) then
   return '{"_status":404,"error":"Un estudiante de la selección ya no existe. Actualice la lista."}';
  end if;
  if exists(select 1 from jsonb_array_elements(payload->'students') a join admission_private.students s on s.id=(a->>'id')::bigint
   where s.exam_schedule_version<>(a->>'version')::int) then
   return '{"_status":409,"error":"Otra persona modificó una asignación. Actualice la lista y vuelva a intentarlo."}';
  end if;
  for item in select value from jsonb_array_elements(payload->'students') loop
   select * into old_row from admission_private.students where id=(item->>'id')::bigint;
   if old_row.exam_date is distinct from target_date or old_row.exam_block is distinct from target_block then
    update admission_private.students set exam_date=target_date,exam_block=target_block,
     exam_schedule_version=exam_schedule_version+1,updated_at=now(),updated_by=uid where id=old_row.id;
    perform admission_private.log_event(uid,case when target_date is null then 'HORARIO_PRUEBA_ELIMINADO' else 'HORARIO_PRUEBA_ASIGNADO' end,
     old_row.id,jsonb_build_object('previous_date',old_row.exam_date,'previous_block',old_row.exam_block,'date',target_date,'block',target_block));
    changed:=changed+1;
   end if;
  end loop;
  return jsonb_build_object('ok',true,'updated',changed);
 end if;
 return '{"_status":405,"error":"Método no permitido"}';
end; $$;
revoke all on function admission_private.exam_schedule(text,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function admission_private.exam_schedule(text,text,jsonb,bigint) to service_role;
