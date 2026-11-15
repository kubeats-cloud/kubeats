import Link from 'next/link';
import { listReps } from '@/lib/closing-report';
import { getCurrentUser } from '@/lib/auth';
import { permittedCampuses } from '@/lib/campuses';
import { CampusFilter } from '@/components/campus-filter';

export async function ActivityFilters({params,action='/',clearHref='/',preserve}: {
  params: Record<string,string>;
  /** Where Apply submits. The Institutes tab keeps its `?view=activity`. */
  action?: string;
  clearHref?: string;
  /**
   * Extra keys to carry forward as hidden fields, beyond the usual
   * `from`/`to`/`sort`/`dir`/`view`. The Activity tab is the only caller that
   * needs this: it hosts this report alongside three others on one URL, so
   * Apply must not drop `tab` or the other reports' own (differently-named)
   * params. Merged with the default list rather than replacing it, so the
   * Institutes page's own call site is unaffected.
   */
  preserve?: string[];
}) {
  const user = await getCurrentUser();
  const [reps,campuses] = await Promise.all([listReps(),permittedCampuses(user)]);
  const preserved = ['from','to','sort','dir','view',...(preserve ?? [])];
  return <form action={action} className="my-3 grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm md:grid-cols-4">
    <label className="grid min-w-0 gap-1">Rep<select name="member" defaultValue={params.member ?? ''} className="bg-card min-h-11 w-full min-w-0 rounded-md border px-2">
      <option value="">All reps</option>{reps.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
    </select></label>
    {/*
      THE SHARED CONTROL, so this form and every client-side filter ask the same
      question about the same list. A team lead's permitted list is their own
      campus alone, which the component hides — no campus to choose is not a
      filter, and their rows are already scoped by RLS.
    */}
    <CampusFilter
      campuses={campuses}
      name="campus"
      value={params.campus ?? ''}
      label="Campus"
      className="grid min-w-0 gap-1"
    />
    <label className="col-span-2 grid gap-1">Search<input name="q" defaultValue={params.q} maxLength={120} className="min-h-11 rounded-md border px-3" /></label>
    {preserved.filter(key => params[key]).map(key => <input key={key} type="hidden" name={key} value={params[key]} />)}
    <button className="bg-primary text-primary-foreground min-h-11 rounded-md px-4">Apply</button>
    <Link prefetch={false} href={clearHref} className="flex min-h-11 items-center justify-center rounded-md border">Clear</Link>
  </form>;
}
