import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { METRICS,type MetricCounts } from '@/lib/validation/weekly';
import { WeekNavigator } from '@/components/weekly/week-navigator';
import { auditHref,auditWindow } from '@/lib/audit-pagination';

export async function AdminTargetRoster({week,page}: {week:string;page?:string}) {
  const client = await createClient();
  const count = await client.from('profiles').select('id',{count:'exact',head:true}).eq('role','rep');
  if (count.error) return <p role="alert">Rep targets could not be loaded.</p>;
  const window = auditWindow(page,count.count ?? 0);
  const reps = await client.from('profiles').select('id,name').eq('role','rep').order('name').order('id').range(window.from,window.to);
  if (reps.error) return <p role="alert">Rep targets could not be loaded.</p>;
  const ids = (reps.data ?? []).map(rep => rep.id);
  const result = ids.length ? await client.from('targets')
    .select('member,locked,meetings,sessions_set,sessions_done,campus_visits_set,campus_visits_done,olympiad,application,admission')
    .eq('period','weekly').eq('period_start',week).in('member',ids) : {data:[],error:null};
  if (result.error) return <p role="alert">Weekly target values could not be loaded.</p>;
  const records = new Map(((result.data ?? []) as unknown as (MetricCounts & {member:string;locked:boolean})[]).map(row => [row.member,row]));
  return <section className="mt-6 space-y-3" aria-label="Per-rep weekly targets">
    <h2 className="font-semibold">Per-rep weekly targets</h2>
    <WeekNavigator weekStart={week} />
    <div className="overflow-x-auto rounded-lg border"><table className="w-max min-w-full text-sm">
      <thead><tr><th className="p-3 text-left">Rep</th><th className="p-3 text-left">Submission</th>{METRICS.map(metric => <th key={metric.key} className="p-3 text-right">{metric.label}</th>)}</tr></thead>
      <tbody>{(reps.data ?? []).map(rep => {const record = records.get(rep.id);return <tr key={rep.id} className="border-t">
        <th className="bg-card sticky left-0 p-3 text-left"><Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={`/targets?member=${rep.id}&week=${week}`}>{rep.name ?? 'Unnamed rep'}</Link></th>
        <td className="p-3">{record ? record.locked ? 'Locked' : 'Draft' : 'Not set'}</td>
        {METRICS.map(metric => <td key={metric.key} className="p-3 text-right tabular-nums">{record?.[metric.key] ?? '—'}</td>)}
      </tr>;})}</tbody>
    </table></div>
    {!ids.length && <p>No reps found.</p>}
    <nav aria-label="Target roster pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p>{count.count ?? 0} reps · page {window.page} of {window.pages}</p>
      {window.page > 1 && <Link prefetch={false} className="min-h-11 p-3 underline" href={auditHref('/targets',{week},window.page-1)}>Previous</Link>}
      {window.page < window.pages && <Link prefetch={false} className="min-h-11 p-3 underline" href={auditHref('/targets',{week},window.page+1)}>Next</Link>}
    </nav>
  </section>;
}
