-- Apply before update-public-result.sql. Existing students remain unassigned.
alter table admission_private.students
 add column if not exists exam_date date,
 add column if not exists exam_block smallint,
 add column if not exists exam_schedule_version integer not null default 0;
alter table admission_private.students
 add column if not exists exam_start time,
 add column if not exists exam_end time,
 add column if not exists exam_reschedule_reason text not null default '';
alter table admission_private.students drop constraint if exists students_exam_schedule_check;
alter table admission_private.students add constraint students_exam_schedule_check check (
 (exam_date is null and exam_block is null and exam_start is null and exam_end is null and exam_reschedule_reason='') or
 (exam_date is not null and exam_block is not null and exam_block between 1 and 3
  and extract(month from exam_date)=10 and extract(day from exam_date) between 27 and 29
  and exam_start is null and exam_end is null and exam_reschedule_reason='') or
 (exam_date is not null and exam_block is null and exam_start is not null and exam_end is not null
  and exam_end>exam_start and length(trim(exam_reschedule_reason)) between 5 and 2000));

-- Invoked only by the authenticated admission_api gateway, never by a browser.
create or replace function admission_private.exam_schedule(method text, path text, payload jsonb, uid bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg jsonb; dates jsonb; regular_dates jsonb; blocks jsonb; groups jsonb; custom_groups jsonb; rows jsonb; item jsonb;
 target_date date; target_block smallint; target_start time; target_end time; target_reason text:='';
 mode text:=coalesce(payload->>'mode','regular'); old_row admission_private.students; changed int:=0;
begin
 select data into cfg from admission_private.config where id=1;
 select jsonb_agg(to_char(make_date((cfg->>'cycle_year')::int-1,10,d),'YYYY-MM-DD') order by d)
 into regular_dates from generate_series(27,29) d;
 select jsonb_agg(d order by d) into dates from (select value d from jsonb_array_elements_text(regular_dates)
 union select to_char(exam_date,'YYYY-MM-DD') from admission_private.students where exam_date is not null) all_dates;
 blocks:='[{"id":1,"label":"Primer bloque","start":"08:00","end":"10:00","time_label":"8:00 a.m. a 10:00 a.m."},
 {"id":2,"label":"Segundo bloque","start":"11:00","end":"13:00","time_label":"11:00 a.m. a 1:00 p.m."},
 {"id":3,"label":"Tercer bloque","start":"14:00","end":"16:00","time_label":"2:00 p.m. a 4:00 p.m."}]';
 -- Every exceptional date/time gets its own attendance group.
 select coalesce(jsonb_agg(jsonb_build_object('date',c.exam_date,'block',null,'kind','custom',
  'start',to_char(c.exam_start,'HH24:MI'),'end',to_char(c.exam_end,'HH24:MI'),'label','Horario reprogramado',
  'time_label',to_char(c.exam_start,'FMHH12:MI')||case when extract(hour from c.exam_start)<12 then ' a.m.' else ' p.m.' end||' a '||
   to_char(c.exam_end,'FMHH12:MI')||case when extract(hour from c.exam_end)<12 then ' a.m.' else ' p.m.' end,
  'rows',(select jsonb_agg(jsonb_build_object('identification',s.identification,
   'name',concat_ws(' ',s.first_name,s.last_name1,nullif(s.last_name2,''))) order by admission_private.alphabetical_key(s.last_name1) collate "C",admission_private.alphabetical_key(s.last_name2) collate "C",admission_private.alphabetical_key(s.first_name) collate "C",s.id)
   from admission_private.students s where s.exam_date=c.exam_date and s.exam_block is null and s.exam_start=c.exam_start and s.exam_end=c.exam_end))
  order by c.exam_date,c.exam_start,c.exam_end),'[]') into custom_groups
 from (select distinct exam_date,exam_start,exam_end from admission_private.students where exam_date is not null and exam_block is null) c;
 if method='GET' and path='/api/admin/exam-schedule' then
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'identification',s.identification,
   'name',concat_ws(' ',s.first_name,s.last_name1,nullif(s.last_name2,'')),
   'first_name',s.first_name,'last_name1',s.last_name1,'last_name2',s.last_name2,
   'room',case when s.accommodation='NP' then 'Aula regular' else 'Aula Específica' end,
   'date',s.exam_date,'block',s.exam_block,'version',s.exam_schedule_version,
   'kind',case when s.exam_date is null then 'unassigned' when s.exam_block is null then 'custom' else 'regular' end,
   'start',to_char(s.exam_start,'HH24:MI'),'end',to_char(s.exam_end,'HH24:MI'),'reason',s.exam_reschedule_reason,
   'progress',admission_private.student_progress(s))
   order by admission_private.alphabetical_key(s.last_name1) collate "C",admission_private.alphabetical_key(s.last_name2) collate "C",admission_private.alphabetical_key(s.first_name) collate "C",s.id),'[]') into rows from admission_private.students s;
  select jsonb_agg(jsonb_build_object('date',d.value,'block',b.value->'id','count',
   (select count(*) from admission_private.students s where s.exam_date=d.value::date and s.exam_block=(b.value->>'id')::int))
   order by d.value,(b.value->>'id')::int) into groups from jsonb_array_elements_text(regular_dates) d cross join jsonb_array_elements(blocks) b;
  return jsonb_build_object('cycle_year',cfg->>'cycle_year','timezone','America/Costa_Rica','dates',dates,'regular_dates',regular_dates,'blocks',blocks,'rows',rows,
   'custom_slots',(select coalesce(jsonb_agg((g-'rows')||jsonb_build_object('count',jsonb_array_length(g->'rows'))),'[]') from jsonb_array_elements(custom_groups) g),
   'summary',jsonb_build_object('total',jsonb_array_length(rows),'assigned',(select count(*) from admission_private.students where exam_date is not null),
   'unassigned',(select count(*) from admission_private.students where exam_date is null),
   'reprogrammed',(select count(*) from admission_private.students where exam_date is not null and exam_block is null),'by_slot',groups));
 end if;
 if method='GET' and path='/api/admin/exam-attendance' then
  if nullif(payload->>'date','') is not null and not dates ? (payload->>'date') then raise exception 'Seleccione una fecha válida de la prueba.'; end if;
  if nullif(payload->>'block','') is not null and payload->>'block' not in ('1','2','3','custom') then raise exception 'Seleccione un bloque válido.'; end if;
  select jsonb_agg(jsonb_build_object('date',d.value,'block',b.value->'id','kind','regular',
   'start',b.value->>'start','end',b.value->>'end','label',b.value->>'label','time_label',b.value->>'time_label',
   'rows',(select coalesce(jsonb_agg(jsonb_build_object('identification',s.identification,
    'name',concat_ws(' ',s.first_name,s.last_name1,nullif(s.last_name2,''))) order by admission_private.alphabetical_key(s.last_name1) collate "C",admission_private.alphabetical_key(s.last_name2) collate "C",admission_private.alphabetical_key(s.first_name) collate "C",s.id),'[]')
    from admission_private.students s where s.exam_date=d.value::date and s.exam_block=(b.value->>'id')::int))
   order by d.value,(b.value->>'id')::int) into groups
   from jsonb_array_elements_text(regular_dates) d cross join jsonb_array_elements(blocks) b;
  -- Each student appears exactly once per date/time, separated only by room.
  -- Attendance payloads intentionally contain no accommodation codes or reasons.
  select coalesce(jsonb_agg((g-'rows')||jsonb_build_object('room',room.label,'rows',att.rows)
   order by g->>'date',g->>'start',g->>'end',room.specific),'[]') into groups
  from jsonb_array_elements(groups||custom_groups) g
  cross join (values ('Aula regular',false),('Aula Específica',true)) room(label,specific)
  cross join lateral (select coalesce(jsonb_agg(jsonb_build_object('identification',s.identification,
   'name',concat_ws(' ',s.last_name1,nullif(s.last_name2,''),s.first_name))
   order by admission_private.alphabetical_key(s.last_name1) collate "C",admission_private.alphabetical_key(s.last_name2) collate "C",admission_private.alphabetical_key(s.first_name) collate "C",s.id),'[]') rows
   from admission_private.students s where s.exam_date=(g->>'date')::date
    and ((g->>'kind'='regular' and s.exam_block=(g->>'block')::int) or
     (g->>'kind'='custom' and s.exam_block is null and s.exam_start=(g->>'start')::time and s.exam_end=(g->>'end')::time))
    and (s.accommodation<>'NP')=room.specific) att
  where (not room.specific or jsonb_array_length(att.rows)>0)
   and (nullif(payload->>'date','') is null or g->>'date'=payload->>'date')
   and (nullif(payload->>'block','') is null or g->>'block'=payload->>'block' or (payload->>'block'='custom' and g->>'kind'='custom'));
  return jsonb_build_object('cycle_year',cfg->>'cycle_year','timezone','America/Costa_Rica','groups',groups);
 end if;
 if method='PUT' and path='/api/admin/exam-schedule' then
  if jsonb_typeof(payload->'students') is distinct from 'array' then raise exception 'Seleccione al menos un estudiante.'; end if;
  if jsonb_array_length(payload->'students') not between 1 and 2000 then raise exception 'Seleccione entre 1 y 2000 estudiantes.'; end if;
  if mode not in ('regular','custom') then raise exception 'Tipo de horario no válido.'; end if;
  if mode='custom' then
   if coalesce(payload->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Indique una fecha válida para la reprogramación.'; end if;
   if payload->>'block' is not null then raise exception 'El horario reprogramado debe indicar horas propias.'; end if;
   if coalesce(payload->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(payload->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Indique la hora de inicio y finalización.';
   end if;
   target_date:=(payload->>'date')::date;target_start:=(payload->>'start')::time;target_end:=(payload->>'end')::time;
   if target_end<=target_start then raise exception 'La hora de finalización debe ser posterior a la hora de inicio.'; end if;
   target_reason:=trim(coalesce(payload->>'reason',''));
   if length(target_reason) not between 5 and 2000 then raise exception 'Escriba el motivo de la reprogramación, entre 5 y 2000 caracteres.'; end if;
  else
   if not (payload ? 'date' and payload ? 'block') then raise exception 'Indique la fecha y el bloque.'; end if;
   if (payload->>'date' is null)<>(payload->>'block' is null) then raise exception 'Indique la fecha y el bloque completos.'; end if;
   if payload->>'date' is not null then
    if not regular_dates ? (payload->>'date') then raise exception 'Seleccione una fecha válida de la prueba.'; end if;
    if payload->>'block' not in ('1','2','3') then raise exception 'Seleccione un bloque válido.'; end if;
    target_date:=(payload->>'date')::date; target_block:=(payload->>'block')::smallint;
   end if;
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
   if old_row.exam_date is distinct from target_date or old_row.exam_block is distinct from target_block
    or old_row.exam_start is distinct from target_start or old_row.exam_end is distinct from target_end or old_row.exam_reschedule_reason is distinct from target_reason then
    update admission_private.students set exam_date=target_date,exam_block=target_block,exam_start=target_start,exam_end=target_end,exam_reschedule_reason=target_reason,
     exam_schedule_version=exam_schedule_version+1,updated_at=now(),updated_by=uid where id=old_row.id;
    perform admission_private.log_event(uid,case when target_date is null then 'HORARIO_PRUEBA_ELIMINADO' when mode='custom' then 'PRUEBA_REPROGRAMADA' else 'HORARIO_PRUEBA_ASIGNADO' end,
     old_row.id,jsonb_build_object('previous_date',old_row.exam_date,'previous_block',old_row.exam_block,'previous_start',old_row.exam_start,'previous_end',old_row.exam_end,
      'previous_reason',old_row.exam_reschedule_reason,'date',target_date,'block',target_block,'start',target_start,'end',target_end,'reason',target_reason));
    changed:=changed+1;
   end if;
  end loop;
  return jsonb_build_object('ok',true,'updated',changed);
 end if;
 return '{"_status":405,"error":"Método no permitido"}';
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'La fecha de reprogramación no es válida.';
end; $$;
revoke all on function admission_private.exam_schedule(text,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function admission_private.exam_schedule(text,text,jsonb,bigint) to service_role;
