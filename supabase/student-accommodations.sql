-- Administrative accommodation data; legacy students default to NP.
alter table admission_private.students add column if not exists accommodation text not null default 'NP';
alter table admission_private.students drop constraint if exists students_accommodation_check;
alter table admission_private.students add constraint students_accommodation_check check (accommodation in ('NP','ACNS','ACS'));

-- Modern Spanish alphabet: accents/case do not change order; ñ follows n.
create or replace function admission_private.alphabetical_key(value text)
returns text language sql immutable security invoker set search_path='' as $$
 select replace(translate(lower(trim(coalesce(value,''))),'áéíóúü','aeiouu'),'ñ','n~'); $$;
revoke all on function admission_private.alphabetical_key(text) from public,anon,authenticated;
grant execute on function admission_private.alphabetical_key(text) to service_role;
