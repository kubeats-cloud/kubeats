import Link from 'next/link';

interface PagedActivity {
  totalInstitutes: number;
  rows: readonly unknown[];
  page: number;
  pages: number;
}

export function ActivityPages({model,basePath,params}: {
  model: PagedActivity; basePath: string; params: Record<string,string>;
}) {
  const href = (page: number) => `${basePath}?${new URLSearchParams({...params,page:String(page)})}`;
  return <nav aria-label="Activity report pages" className="my-3 flex flex-wrap items-center justify-between gap-3 text-sm">
    <p>{model.totalInstitutes} matching institutes · showing {model.rows.length} · page {model.page} of {model.pages}</p>
    <div className="flex gap-3">
      {model.page > 1 && <Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={href(model.page-1)}>Previous</Link>}
      {model.page < model.pages && <Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={href(model.page+1)}>Next</Link>}
    </div>
  </nav>;
}
