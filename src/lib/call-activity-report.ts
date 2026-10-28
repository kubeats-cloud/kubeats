import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ZERO_COUNTS } from "@/lib/validation/weekly";
import type { RepRow, StatusColumn, StatusColumns } from "@/lib/exports/activity-grid";

/**
 * The Call Activity Report (0064) — one row per rep, call counts by CURRENT
 * status_set_to, split Open/Closed. The RPC does the aggregation, the
 * pagination (50 reps/page) and the sort; this module only shapes its answer
 * into the `RepRow`/`StatusColumns` the Rep Activity Report's own grid
 * already renders — see `src/lib/exports/activity-grid.ts`.
 *
 * NO "activity" FILTER AND NO "activity" COLUMN, deliberately. A call has one
 * activity, "Call" — the client's own decision — so this report counts by
 * status only. `p_member`/`p_institute`/`p_status`/`p_from`/`p_to` stay in the
 * RPC's signature from the start (Part 3 wires their filter controls to the
 * same parameters) so the function never needs a second signature.
 */

export interface CallActivityFilters {
  from?: string;
  to?: string;
  member?: string;
  institute?: string;
  status?: string;
}

export interface CallActivitySort {
  /** "rep" | "total" | "open_total" | "closed_total" | "status:<name>" — the
   *  exact vocabulary `activity-grid.ts`'s SORT_BY_* constants and column
   *  keys already use, so a sort link needs no translation either side. */
  key: string;
  dir: "asc" | "desc";
}

export interface CallActivityTotals {
  byStatus: Record<string, number>;
  openTotal: number;
  closedTotal: number;
  total: number;
}

export interface CallActivityReportModel {
  reps: RepRow[];
  columns: StatusColumns;
  totals: CallActivityTotals;
  total: number;
  page: number;
  pages: number;
}

interface RpcStatus {
  status: string;
  category: "open" | "closed";
  sortOrder: number;
}

interface RpcRow {
  id: string;
  name: string;
  statuses: Record<string, number>;
  openTotal: number;
  closedTotal: number;
  total: number;
}

interface RpcPayload {
  total: number;
  pages: number;
  page: number;
  statuses: RpcStatus[];
  totals: {
    byStatus: Record<string, number>;
    openTotal: number;
    closedTotal: number;
    total: number;
  };
  rows: RpcRow[];
}

/** `RpcStatus[]`, already in catalogue order, split into the two bands. */
function columnsFrom(statuses: RpcStatus[]): StatusColumns {
  const toColumn = (s: RpcStatus): StatusColumn => ({
    status: s.status,
    label: s.status,
    // Only active statuses are ever offered here — see the RPC's header for
    // why "configured" means the live catalogue and not retired history.
    retired: false,
  });
  return {
    closed: statuses.filter((s) => s.category === "closed").map(toColumn),
    open: statuses.filter((s) => s.category === "open").map(toColumn),
  };
}

export async function getCallActivityReport(
  filters: CallActivityFilters,
  sort: CallActivitySort,
  page: number,
): Promise<
  ({ ok: true } & CallActivityReportModel) | { ok: false; error: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("call_activity_report", {
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_member: filters.member ?? null,
    p_institute: filters.institute ?? null,
    p_status: filters.status ?? null,
    p_sort: sort.key,
    p_desc: sort.dir === "desc",
    p_page: page,
  });

  if (error) {
    return {
      ok: false,
      error:
        error.code === "42501"
          ? "Only an admin or a team lead can read the Call Activity Report."
          : "We could not load the Call Activity Report just now.",
    };
  }

  const payload = data as RpcPayload;
  const columns = columnsFrom(payload.statuses);

  const reps: RepRow[] = payload.rows.map((row) => ({
    id: row.id,
    name: row.name,
    // Unused — showActivities is always false for this report — but
    // RepRow.activities is required, so a zeroed shape costs nothing and
    // adds nothing to any cell this screen renders.
    activities: ZERO_COUNTS,
    statuses: row.statuses,
  }));

  return {
    ok: true,
    reps,
    columns,
    totals: payload.totals,
    total: payload.total,
    page: payload.page,
    pages: payload.pages,
  };
}

/**
 * The footer's "All reps" row, as a single `RepRow` — fed to
 * `CustomisableGrid`'s `totalsReps` in place of every rep's own row.
 *
 * `buildActivityGrid()` recomputes the Open/Closed/Total subtotals from
 * `.statuses` itself (see `activity-grid.ts`'s `showGroupTotals` body), so
 * summing a SINGLE row whose `.statuses` is already the server's full-
 * population sum (`totals.byStatus`, computed over every matching rep, not
 * only the visible page) reproduces exactly the same footer a true
 * "all reps" totals-row reduction would — without this screen ever holding
 * more than one page of individual `RepRow`s at a time.
 */
export function totalsRow(totals: CallActivityTotals): RepRow {
  return { name: "", activities: ZERO_COUNTS, statuses: totals.byStatus };
}

/**
 * The sort, parsed leniently — same bargain `parsePipelineSort()` makes: a
 * wrong SORT produces the right numbers in a different order, which is not
 * worth refusing a page over.
 *
 * NO CATALOGUE-AWARE ALLOW-LIST, unlike the pipeline report's own parser.
 * The RPC's own `p_sort` CASE already degrades an unrecognised key to a
 * name sort (see `call_activity_report()`'s `packed` CTE, `else` branch), so
 * validating here too would just be a second place that could disagree with
 * the SQL about what counts as a real sort key.
 */
export function parseCallActivitySort(
  rawKey: string | undefined,
  rawDir: string | undefined,
): CallActivitySort {
  const key = rawKey && rawKey.trim() !== "" ? rawKey : "rep";
  const dir: "asc" | "desc" =
    rawDir === "asc" || rawDir === "desc" ? rawDir : key === "rep" ? "asc" : "desc";
  return { key, dir };
}
