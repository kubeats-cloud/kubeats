-- Owner-run READ ONLY. Output counts and IDs only, never names/phones/emails.
begin transaction read only;
select 'duplicate_active_institutes' kind,campus_id,count(*) n,array_agg(id order by id) ids
from public.institutes where deleted_at is null
group by campus_id,lower(trim(name)) having count(*) > 1;

select 'test_looking_institutes' kind,count(*) n,coalesce(array_agg(id order by id),'{}'::uuid[]) ids
from public.institutes
where regexp_replace(lower(trim(name)),'\s+','','g') ~ '^(abctest|abcdtest1|zztest|qa1831)';

select 'test_looking_profiles' kind,count(*) n,coalesce(array_agg(id order by id),'{}'::uuid[]) ids
from public.profiles
where regexp_replace(lower(trim(name)),'\s+','','g') in ('test1','testteamlead');
rollback;
