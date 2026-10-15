-- Fourth and fifth: periods I/II. Sixth: period I, available at admission.
-- Legacy annual grades stay in the original JSON as references, never copied into periods.
create or replace function admission_private.grade_keys() returns text[] language sql immutable set search_path='' as $$
 select array['g4_p1_math','g4_p1_science','g4_p1_spanish','g4_p1_social','g4_p1_conduct',
 'g4_p2_math','g4_p2_science','g4_p2_spanish','g4_p2_social','g4_p2_conduct',
 'g5_p1_math','g5_p1_science','g5_p1_spanish','g5_p1_social','g5_p1_conduct',
 'g5_p2_math','g5_p2_science','g5_p2_spanish','g5_p2_social','g5_p2_conduct',
 'g6_p1_math','g6_p1_science','g6_p1_spanish','g6_p1_social','g6_p1_conduct']; $$;
create or replace function admission_private.academic(g jsonb) returns numeric language sql immutable set search_path='' as $$
 select case when count(v)=25 then round(sum(v)/25,4) end from
 (select admission_private.score(g->>k) as v from unnest(admission_private.grade_keys()) k) t; $$;
create or replace function admission_private.sync_period_model() returns void
language plpgsql security invoker set search_path='' as $$
begin
 if (select data->>'grade_period_model' from admission_private.config where id=1) is distinct from 'periods-25-v1' then
  if exists(select 1 from admission_private.students where grades ?| array['g4_math','g4_science','g4_spanish','g4_social','g4_conduct','g5_math','g5_science','g5_spanish','g5_social','g5_conduct','g6_math','g6_science','g6_spanish','g6_social','g6_conduct']) then
   perform admission_private.invalidate();
  end if;
  update admission_private.config set data=data||'{"grade_period_model":"periods-25-v1"}'::jsonb where id=1;
 end if;
end; $$;
revoke all on function admission_private.sync_period_model() from public,anon,authenticated;
grant execute on function admission_private.sync_period_model() to service_role;
select admission_private.sync_period_model();
