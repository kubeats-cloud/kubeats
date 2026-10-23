import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logError } from '@/lib/errors';
import { areasFor } from '@/lib/place-cache';
import { cellFor } from '@/lib/places';
import { isInstituteActivitySortKey, type InstituteActivityRow, type InstituteActivitySortKey } from '@/lib/institute-activity-counts';
import { pipelineRangeSchema, rangeIsActive, type PipelineRange, type SortDirection } from '@/lib/validation/pipeline-report';

export interface InstituteActivitySort { key: InstituteActivitySortKey; dir: SortDirection }
export const DEFAULT_INSTITUTE_ACTIVITY_SORT: InstituteActivitySort = {key: 'institute', dir: 'asc'};
export interface InstituteActivityModel {
  rows: InstituteActivityRow[];
  range: PipelineRange;
  rangeActive: boolean;
  sort: InstituteActivitySort;
  totalInstitutes: number;
  reconciliationFailed: boolean;
  page: number;
  pages: number;
}
export interface InstituteActivityQuery {
  range?: PipelineRange;
  sort?: {key?: string; dir?: string};
  page?: string;
  search?: string;
  member?: string;
  campus?: string;
}
interface SqlRow extends InstituteActivityRow {
  checkinLat: number | null; checkinLng: number | null;
  checkoutLat: number | null; checkoutLng: number | null;
}

/** Same count model, SQL-aggregated before sort/LIMIT. Existing caller RLS applies. */
export async function getInstituteActivityModel(query: InstituteActivityQuery = {}): Promise<
  {ok: true; model: InstituteActivityModel} | {ok: false; error: string}
> {
  const parsed = pipelineRangeSchema.safeParse(query.range ?? {});
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!parsed.success || [query.member,query.campus].some((id) => id && !uuid.test(id))) {
    return {ok: false, error: 'That activity filter is not valid.'};
  }
  const range = parsed.data;
  const sort: InstituteActivitySort = {
    key: isInstituteActivitySortKey(query.sort?.key) ? query.sort.key : 'institute',
    dir: query.sort?.dir === 'desc' ? 'desc' : 'asc',
  };
  const rawPage = Number(query.page);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 2147483647 ? rawPage : 1;
  const client = await createClient();
  const {data,error} = await client.rpc('audit_institute_activity', {
    p_from: range.from ?? null, p_to: range.to ?? null,
    p_search: (query.search ?? '').trim().slice(0,120), p_member: query.member || null,
    p_campus: query.campus || null, p_sort: sort.key, p_desc: sort.dir === 'desc', p_page: page,
  });
  if (error || !data) {
    logError('institute-activity:sql', error ?? 'Missing aggregate');
    return {ok: false, error: 'We could not load activity. Check the audit query migration is installed.'};
  }
  const result = data as {rows: SqlRow[]; total: number; page: number; pages: number; reconciliationFailed: boolean};
  // Decoration is bounded to <=100 points on a 50-institute page, not the log.
  const areas = await areasFor(result.rows.flatMap((row) => [
    {latitude: row.checkinLat, longitude: row.checkinLng},
    {latitude: row.checkoutLat, longitude: row.checkoutLng},
  ]));
  const areaAt = (lat: number | null, lng: number | null) =>
    lat === null || lng === null ? null : areas.get(cellFor(lat,lng)) ?? null;
  const rows = result.rows.map(({checkinLat,checkinLng,checkoutLat,checkoutLng,...row}) => ({
    ...row, lastCheckinArea: areaAt(checkinLat,checkinLng), lastCheckoutArea: areaAt(checkoutLat,checkoutLng),
  }));
  return {ok: true, model: {rows,range,sort,rangeActive: rangeIsActive(range),
    totalInstitutes: result.total, page: result.page, pages: result.pages, reconciliationFailed: result.reconciliationFailed}};
}
export {pipelineRangeSchema,rangeIsActive};
