-- Readiness is calculated from stored data; zero is a registered grade/exam.
create or replace function admission_private.student_progress(s admission_private.students)
returns jsonb language sql stable security invoker set search_path='' as $$
 with marks as (select count(*) filter(where (s).grades->>k is not null and trim((s).grades->>k)<>'')::int as filled
  from unnest(admission_private.grade_keys()) k),
 flags as (select coalesce((s).password_hash~'^\$2[aby]\$',false) as password,
  filled,filled=25 as grades,(s).exam is not null as exam,(s).exam_date is not null as appointment from marks)
 select jsonb_build_object('password',password,'grades',grades,'grades_filled',filled,'grades_total',25,
  'exam',exam,'appointment',appointment,'completed',password::int+grades::int+exam::int+appointment::int)
 from flags; $$;
revoke all on function admission_private.student_progress(admission_private.students) from public,anon,authenticated;
grant execute on function admission_private.student_progress(admission_private.students) to service_role;

create or replace function admission_private.student_json(s admission_private.records)
returns jsonb language sql stable security invoker set search_path='' as $$
 select (to_jsonb(s)-array['password_hash','grades','exam','decision','avg','ac','ec','total'])||
  jsonb_build_object('progress',(select admission_private.student_progress(st) from admission_private.students st where st.id=(s).id)); $$;
