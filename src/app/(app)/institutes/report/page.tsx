import { redirect } from 'next/navigation';

/**
 * The old standalone Activity Report screen is now the Institutes tab's
 * Institute Activity view (`?view=activity`). Bookmarks and links already in
 * the wild keep working and land on the table the client asked for.
 *
 * Query parameters are carried over, so a filtered report URL still opens that
 * filter; `view` is set last so a stale `?view=` cannot take the reader back to
 * the registry instead of the report.
 */
export default async function InstituteReportPage(props: PageProps<'/institutes/report'>) {
  const params = await props.searchParams;
  const query = new URLSearchParams(Object.fromEntries(Object.entries(params)
    .filter((entry): entry is [string,string] => typeof entry[1] === 'string')));
  query.set('view', 'activity');
  redirect(`/institutes?${query.toString()}`);
}
