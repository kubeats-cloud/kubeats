begin;
create view public.audit_registry with (security_invoker = true) as
select i.*,p.name owner_name,
  concat_ws(' ',i.name,i.city,i.area) search_text,
  array(select distinct case when lower(trim(b)) in ('na','n/a','not applicable')
    then 'Not applicable' else upper(trim(b)) end
    from unnest(coalesce(i.boards,'{}'::text[])) b where trim(b) <> '') normalized_boards
from institutes i left join profiles p on p.id = i.registered_by where i.deleted_at is null;
grant select on public.audit_registry to authenticated;
create function public.audit_registry_facets() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'states',coalesce((select jsonb_agg(x order by x) from (select distinct state x from audit_registry where state is not null) t),'[]'::jsonb),
    'cities',coalesce((select jsonb_agg(x order by x) from (select distinct city x from audit_registry where city is not null) t),'[]'::jsonb),
    'areas',coalesce((select jsonb_agg(x order by x) from (select distinct area x from audit_registry where area is not null) t),'[]'::jsonb),
    'boards',coalesce((select jsonb_agg(x order by x) from (select distinct unnest(normalized_boards) x from audit_registry) t),'[]'::jsonb),
    'owners',jsonb_build_object('anyUnassigned',exists(select 1 from audit_registry where registered_by is null),
      'reps',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name)
        from (select distinct registered_by id,coalesce(owner_name,'Unnamed rep') name
          from audit_registry where registered_by is not null) t),'[]'::jsonb)));
$$;
revoke all on function public.audit_registry_facets() from public,anon;
grant execute on function public.audit_registry_facets() to authenticated;
commit;
