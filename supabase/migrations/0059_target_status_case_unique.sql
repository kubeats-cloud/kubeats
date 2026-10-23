-- Do not rewrite legacy data or edit applied migration 0047.
begin;
do $$ begin
  if exists (select 1 from public.target_statuses group by lower(trim(name)) having count(*) > 1) then
    raise exception 'Case-insensitive duplicate target statuses require owner review; no rows were changed'
      using errcode = '23505';
  end if;
end $$;
create unique index target_statuses_name_normalized_unique on public.target_statuses(lower(trim(name)));
commit;
