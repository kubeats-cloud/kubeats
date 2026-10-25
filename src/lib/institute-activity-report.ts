import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logError } from '@/lib/errors';
import { areasFor } from '@/lib/place-cache';
import { cellFor } from '@/lib/places';
import {
  isInstituteActivitySortKey,
  isStatusActivitySortKey,
  type ActivityOpenClosed,
  type InstituteActivityRow,
  type InstituteActivitySortKey,
  type InstituteStatusActivityRow,
  type StatusActivityVisit,
  type StatusColumn,
} from '@/lib/institute-activity-counts';
import { pipelineRangeSchema, rangeIsActive, type PipelineRange, type SortDirection } from '@/lib/validation/pipeline-report';
import type { ActivityType } from '@/lib/validation/weekly';

export interface InstituteActivitySort { key: InstituteActivitySortKey; dir: SortDirection }
export const DEFAULT_INSTITUTE_ACTIVITY_SORT: InstituteActivitySort = {key: 'institute', dir: 'asc'};
export interface InstituteActivityTotals {
  byActivity: Record<ActivityType, ActivityOpenClosed>;
  totalActivities: number;
  meetingsCompleted: number;
  followUpsOwned: number;
  followUpsPending: number;
  totalVisits: number;
}
export interface InstituteActivityModel {
  rows: InstituteActivityRow[];
  range: PipelineRange;
  rangeActive: boolean;
  sort: InstituteActivitySort;
  totalInstitutes: number;
  reconciliationFailed: boolean;
  /** SQL sum over EVERY matching institute, not just the displayed page. */
  totals: InstituteActivityTotals;
  page: number;
  pages: number;
  /** Export-only visit payload returned by the rep-scoped SQL RPC. */
  visits: StatusActivityVisit[];
  statuses: StatusColumn[];
  visitCount: number;
}
/**
 * The rep report reads its own RPC. It takes NO member id: the function derives
 * the rep from auth.uid(), so a forged URL cannot widen it.
 */
export interface InstituteActivityQuery {
  range?: PipelineRange;
  sort?: {key?: string; dir?: string};
  page?: string;
  /** Ask the RPC for every matching row (`p_page = 0`) instead of one page. */
  allRows?: boolean;
}
export interface InstituteStatusActivityQuery {
  range?: PipelineRange;
  sort?: {key?: string; dir?: string};
  page?: string;
  search?: string;
  member?: string;
  campus?: string;
  /** Export mode: every matching institute + every visit row. */
  allRows?: boolean;
}
export interface InstituteStatusActivitySort { key: string; dir: SortDirection }
export interface InstituteStatusActivityTotals {
  byStatus: Record<string, number>;
  totalVisits: number;
  meetingsCompleted: number;
  followUpsOwned: number;
  followUpsPending: number;
}
export interface InstituteStatusActivityModel {
  rows: InstituteStatusActivityRow[];
  statuses: StatusColumn[];
  range: PipelineRange;
  rangeActive: boolean;
  sort: InstituteStatusActivitySort;
  totalInstitutes: number;
  totals: InstituteStatusActivityTotals;
  visits: StatusActivityVisit[];
  visitCount: number;
  page: number;
  pages: number;
}
interface SqlRow extends InstituteActivityRow {
  checkinLat: number | null; checkinLng: number | null;
  checkoutLat: number | null; checkoutLng: number | null;
}
interface SqlTotals {
  meeting: ActivityOpenClosed; session: ActivityOpenClosed;
  campus_visit: ActivityOpenClosed; olympiad: ActivityOpenClosed;
  application: ActivityOpenClosed; admission: ActivityOpenClosed;
  totalActivities: number; meetingsCompleted: number;
  followUpsOwned: number; followUpsPending: number; totalVisits: number;
}
interface SqlRepResult {
  rows: SqlRow[];
  statuses?: StatusColumn[];
  visits?: SqlStatusVisit[];
  visitCount?: number | null;
  total: number;
  page: number;
  pages: number;
  reconciliationFailed: boolean;
  totals: SqlTotals;
}
interface SqlStatusRow extends Omit<InstituteStatusActivityRow, 'lastCheckinArea' | 'lastCheckoutArea'> {
  checkinLat: number | null; checkinLng: number | null;
  checkoutLat: number | null; checkoutLng: number | null;
}
interface SqlStatusVisit extends Omit<StatusActivityVisit, 'location'> {
  checkinLat: number | null; checkinLng: number | null;
}
interface SqlStatusResult {
  rows: SqlStatusRow[];
  statuses: StatusColumn[];
  totals: InstituteStatusActivityTotals;
  visits: SqlStatusVisit[];
  visitCount: number | null;
  total: number; page: number; pages: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same count model, SQL-aggregated before sort/LIMIT. Existing caller RLS applies. */
export async function getInstituteActivityModel(query: InstituteActivityQuery = {}): Promise<
  {ok: true; model: InstituteActivityModel} | {ok: false; error: string}
> {
  const parsed = pipelineRangeSchema.safeParse(query.range ?? {});
  if (!parsed.success) {
    return {ok: false, error: 'That activity filter is not valid.'};
  }
  const range = parsed.data;
  const sort: InstituteActivitySort = {
    key: isInstituteActivitySortKey(query.sort?.key) ? query.sort.key : 'institute',
    dir: query.sort?.dir === 'desc' ? 'desc' : 'asc',
  };
  const rawPage = Number(query.page);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 2147483647 ? rawPage : 1;
  const allRows = query.allRows === true;
  const client = await createClient();
  const {data,error} = await client.rpc('audit_rep_institute_activity', {
    p_from: range.from ?? null, p_to: range.to ?? null,
    p_sort: sort.key, p_desc: sort.dir === 'desc',
    // `0` is the RPC's all-rows mode; it ignores the page window and still
    // returns the same SQL totals either way.
    p_page: allRows ? 0 : page,
  });
  if (error || !data) {
    logError('institute-activity:rep-sql', error ?? 'Missing aggregate');
    return {ok: false, error: error?.message ?? 'We could not load activity. Check the audit query migration is installed.'};
  }
  const result = data as SqlRepResult;
  // Decoration is bounded to <=100 points on a 50-institute page, not the log.
  // An all-rows export never reads the area columns, so it skips the lookup.
  const areas = allRows ? new Map<string,string>() : await areasFor(result.rows.flatMap((row) => [
    {latitude: row.checkinLat, longitude: row.checkinLng},
    {latitude: row.checkoutLat, longitude: row.checkoutLng},
  ]));
  const areaAt = (lat: number | null, lng: number | null) =>
    lat === null || lng === null ? null : areas.get(cellFor(lat,lng)) ?? null;
  const rows = result.rows.map(({checkinLat,checkinLng,checkoutLat,checkoutLng,...row}) => ({
    ...row, lastCheckinArea: areaAt(checkinLat,checkinLng), lastCheckoutArea: areaAt(checkoutLat,checkoutLng),
  }));
  const visitAreas = allRows ? await areasFor((result.visits ?? []).map((visit) => ({
    latitude: visit.checkinLat,
    longitude: visit.checkinLng,
  }))) : new Map<string,string>();
  const visitAreaAt = (lat: number | null, lng: number | null) =>
    lat === null || lng === null ? null : visitAreas.get(cellFor(lat,lng)) ?? null;
  const visits = (result.visits ?? []).map(({checkinLat,checkinLng,...visit}) => ({
    ...visit,
    location: visitAreaAt(checkinLat,checkinLng),
  }));
  const {meeting,session,campus_visit,olympiad,application,admission,
    totalActivities,meetingsCompleted,followUpsOwned,followUpsPending,totalVisits} = result.totals;
  return {ok: true, model: {rows,range,sort,rangeActive: rangeIsActive(range),
    totals: {byActivity: {meeting,session,campus_visit,olympiad,application,admission},
      totalActivities,meetingsCompleted,followUpsOwned,followUpsPending,totalVisits},
    totalInstitutes: result.total, page: result.page, pages: result.pages,
    reconciliationFailed: result.reconciliationFailed,
    visits, statuses: result.statuses ?? [], visitCount: result.visitCount ?? visits.length}};
}

/**
 * Admin/team-lead status-wise report. The RPC checks the role again in SQL;
 * this reads only what it returns.
 */
export async function getInstituteStatusActivityModel(
  query: InstituteStatusActivityQuery = {},
): Promise<{ok: true; model: InstituteStatusActivityModel} | {ok: false; error: string}> {
  const parsed = pipelineRangeSchema.safeParse(query.range ?? {});
  if (!parsed.success || [query.member,query.campus].some((id) => id && !UUID.test(id))) {
    return {ok: false, error: 'That activity filter is not valid.'};
  }
  const range = parsed.data;
  const sort: InstituteStatusActivitySort = {
    key: isStatusActivitySortKey(query.sort?.key) ? query.sort.key : 'institute',
    dir: query.sort?.dir === 'desc' ? 'desc' : 'asc',
  };
  const rawPage = Number(query.page);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 2147483647 ? rawPage : 1;
  const allRows = query.allRows === true;
  const client = await createClient();
  const {data,error} = await client.rpc('audit_institute_activity', {
    p_from: range.from ?? null, p_to: range.to ?? null,
    p_search: (query.search ?? '').trim().slice(0,120),
    p_member: query.member || null, p_campus: query.campus || null,
    p_sort: sort.key, p_desc: sort.dir === 'desc',
    p_page: allRows ? 0 : page,
  });
  if (error || !data) {
    logError('institute-activity:sql', error ?? 'Missing aggregate');
    return {ok: false, error: error?.message ?? 'We could not load activity. Check the audit query migration is installed.'};
  }
  const result = data as SqlStatusResult;
  const rowAreas = await areasFor(result.rows.flatMap((row) => [
    {latitude: row.checkinLat, longitude: row.checkinLng},
    {latitude: row.checkoutLat, longitude: row.checkoutLng},
  ]));
  const visitAreas = await areasFor(result.visits.map((visit) => ({
    latitude: visit.checkinLat, longitude: visit.checkinLng,
  })));
  const areaAt = (map: Map<string,string|null>, lat: number | null, lng: number | null) =>
    lat === null || lng === null ? null : map.get(cellFor(lat,lng)) ?? null;
  const rows = result.rows.map(({checkinLat,checkinLng,checkoutLat,checkoutLng,...row}) => ({
    ...row,
    lastCheckinArea: areaAt(rowAreas,checkinLat,checkinLng),
    lastCheckoutArea: areaAt(rowAreas,checkoutLat,checkoutLng),
  }));
  const visits = result.visits.map(({checkinLat,checkinLng,...visit}) => ({
    ...visit,
    location: areaAt(visitAreas,checkinLat,checkinLng),
  }));
  return {ok: true, model: {
    rows, statuses: result.statuses, range, rangeActive: rangeIsActive(range),
    sort, totalInstitutes: result.total, totals: result.totals,
    visits, visitCount: result.visitCount ?? visits.length,
    page: result.page, pages: result.pages,
  }};
}

export {pipelineRangeSchema,rangeIsActive};
