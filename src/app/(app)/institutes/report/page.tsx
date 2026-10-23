import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin';

export default async function InstituteReportPage(props: PageProps<'/institutes/report'>) {
  const gate = await requireStaff();
  if (!gate.ok) redirect('/');
  const params = await props.searchParams;
  const query = new URLSearchParams(Object.fromEntries(Object.entries(params)
    .filter((entry): entry is [string,string] => typeof entry[1] === 'string'))).toString();
  redirect(query ? `/?${query}` : '/');
}
