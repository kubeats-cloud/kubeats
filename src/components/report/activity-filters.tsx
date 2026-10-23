import Link from 'next/link';
import { listReps } from '@/lib/closing-report';
import { listCampuses } from '@/lib/campuses';

export async function ActivityFilters({params}: {params:Record<string,string>}) {
  const [reps,campuses] = await Promise.all([listReps(),listCampuses(true)]);
  return <form action="/" className="my-3 grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm md:grid-cols-4">
    <label className="grid gap-1">Rep<select name="member" defaultValue={params.member ?? ''} className="bg-card min-h-11 rounded-md border px-2">
      <option value="">All reps</option>{reps.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
    </select></label>
    <label className="grid gap-1">Campus<select name="campus" defaultValue={params.campus ?? ''} className="bg-card min-h-11 rounded-md border px-2">
      <option value="">All campuses</option>{campuses.map(campus => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
    </select></label>
    <label className="col-span-2 grid gap-1">Search<input name="q" defaultValue={params.q} maxLength={120} className="min-h-11 rounded-md border px-3" /></label>
    {['from','to','sort','dir'].filter(key => params[key]).map(key => <input key={key} type="hidden" name={key} value={params[key]} />)}
    <button className="bg-primary text-primary-foreground min-h-11 rounded-md px-4">Apply</button>
    <Link prefetch={false} href="/" className="flex min-h-11 items-center justify-center rounded-md border">Clear</Link>
  </form>;
}
