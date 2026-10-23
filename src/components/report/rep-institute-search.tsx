import { Input } from '@/components/ui/input';
import { RepInstituteTable } from '@/components/report/rep-institute-table';
import type { InstituteActivityRow, InstituteActivitySortKey } from '@/lib/institute-activity-counts';
import type { PipelineRange } from '@/lib/validation/pipeline-report';
import type { StatusCatalogue } from '@/lib/validation/institute';

/** Search submits to SQL before pagination; never filter only the current page. */
export function RepInstituteSearch({rows,sort,range,caption,basePath,extraParams,catalogue}: {
  rows: readonly InstituteActivityRow[];
  sort: {key: InstituteActivitySortKey; dir: 'asc' | 'desc'};
  range: PipelineRange; caption: string; basePath: string;
  extraParams?: Record<string,string>; catalogue: StatusCatalogue;
}) {
  return <>
    <form action={basePath} className="mb-4 flex flex-wrap items-end gap-3">
      <label className="grid flex-1 gap-1 text-sm">Search by name, city or area
        <Input name="q" defaultValue={extraParams?.q ?? ''} maxLength={120} className="min-h-11" />
      </label>
      {Object.entries({...extraParams,from:range.from,to:range.to,sort:sort.key,dir:sort.dir})
        .filter(([key,value]) => key !== 'q' && key !== 'page' && value)
        .map(([key,value]) => <input key={key} type="hidden" name={key} value={value} />)}
      <button className="bg-primary text-primary-foreground min-h-11 rounded-md px-4">Apply</button>
    </form>
    <RepInstituteTable rows={rows} sort={sort} range={range} caption={caption}
      basePath={basePath} extraParams={extraParams} catalogue={catalogue} />
  </>;
}
