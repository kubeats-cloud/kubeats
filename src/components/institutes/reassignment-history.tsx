import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/dates';
import { auditWindow } from '@/lib/audit-pagination';

export async function ReassignmentHistory({instituteId,page}: {instituteId:string;page?:string}) {
  const client = await createClient();
  const build = (head:boolean) => client.from('institute_reassignment_history')
    .select('id,from_rep,to_rep,changed_by,changed_at',{count:'exact',head}).eq('institute_id',instituteId);
  const counted = await build(true);
  if (counted.error) return <p role="alert">Reassign history could not be loaded.</p>;
  const total = counted.count ?? 0;
  const window = auditWindow(page,total);
  const result = total ? await build(false).order('changed_at',{ascending:false}).order('id').range(window.from,window.to) : {data:[],error:null};
  if (result.error) return <p role="alert">Reassign history could not be loaded.</p>;
  const rows = result.data ?? [];
  const ids = [...new Set(rows.flatMap(row => [row.from_rep,row.to_rep,row.changed_by]).filter(Boolean))];
  const names = ids.length ? await client.from('profiles').select('id,name').in('id',ids) : {data:[]};
  const label = new Map((names.data ?? []).map(row => [row.id,row.name]));
  const rep = (id:string|null) => id ? label.get(id) ?? 'Unavailable rep' : 'Not recorded';
  const href = (n:number) => `/institutes/${instituteId}?historyPage=${n}`;
  return <section className="mt-6 space-y-3" aria-labelledby="reassign-history-title">
    <h2 id="reassign-history-title" className="font-semibold">Reassign history</h2>
    <p className="text-muted-foreground text-xs">Future ownership changes only; earlier events are not invented. Existing logged visits retain the original rep&apos;s credit.</p>
    <p className="text-sm">{total} changes · page {window.page} of {window.pages}</p>
    {rows.length ? <ul className="divide-y rounded-lg border">{rows.map(row => <li key={row.id} className="p-3 text-sm">
      {rep(row.from_rep)} → {rep(row.to_rep)}<p className="text-muted-foreground text-xs">By {rep(row.changed_by)} · {formatDateTime(row.changed_at)}</p>
    </li>)}</ul> : <p className="text-sm">No recorded reassignments.</p>}
    <nav aria-label="Reassign history pages" className="flex justify-between gap-3 text-sm">
      {window.page > 1 && <Link prefetch={false} className="min-h-11 p-3 underline" href={href(window.page-1)}>Previous</Link>}
      {window.page < window.pages && <Link prefetch={false} className="min-h-11 p-3 underline" href={href(window.page+1)}>Next</Link>}
    </nav>
  </section>;
}
