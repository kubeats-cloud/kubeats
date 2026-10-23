import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logError } from '@/lib/errors';
import type { Institute } from '@/lib/institutes';
import { auditWindow } from '@/lib/audit-pagination';

export interface RegistryFacets {
  states: string[]; cities: string[]; areas: string[]; boards: string[];
  owners: {reps: {id:string;name:string}[]; anyUnassigned:boolean};
}
export async function getRegistryPage(params: Record<string,string>) {
  const client = await createClient();
  const build = (head: boolean) => {
    let q = client.from('audit_registry').select(
      'id,name,type,area,city,state,status,registered_by,ownerName:owner_name,boards:normalized_boards,principal_name,decision_maker_name,decision_maker_designation,class11,class12',
      {count:'exact',head});
    if (params.q?.trim()) q = q.ilike('search_text',`%${params.q.trim().slice(0,120).replace(/[\\%_]/g,'\\$&')}%`);
    for (const key of ['state','city','area','type'] as const) if (params[key] && params[key] !== '__all__') q = q.eq(key,params[key]);
    if (params.status === '__none__') q = q.is('status',null);
    else if (params.status && params.status !== '__all__') q = q.eq('status',params.status);
    if (params.owner === '__unassigned__') q = q.is('registered_by',null);
    else if (params.owner && params.owner !== '__all__') q = q.eq('registered_by',params.owner);
    if (params.board) q = q.overlaps('normalized_boards',params.board.split('|'));
    return q;
  };
  const [counted,facets] = await Promise.all([build(true),client.rpc('audit_registry_facets')]);
  if (counted.error || facets.error) {
    logError('registry:count',counted.error ?? facets.error); return {ok:false as const};
  }
  const total = counted.count ?? 0;
  const window = auditWindow(params.page,total);
  const result = total ? await build(false).order('name').order('id').range(window.from,window.to) : {data:[],error:null};
  if (result.error) {logError('registry:page',result.error); return {ok:false as const};}
  return {ok:true as const,institutes:(result.data ?? []) as unknown as Institute[],
    total,...window,facets:facets.data as RegistryFacets};
}
