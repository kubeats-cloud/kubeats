import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ZERO_COUNTS } from "@/lib/validation/weekly";
import type { RepRow, StatusColumn, StatusColumns } from "@/lib/exports/activity-grid";
import type { StatusCatalogue } from "@/lib/validation/institute";
import { totalsRow, type CallActivityTotals } from "@/lib/exports/call-activity-grid";

/** Re-exported so existing callers (the Review page, its tests) need no
 *  import-path change — the canonical definitions now live beside the
 *  .xlsx sheet builder in `exports/call-activity-grid.ts`, which is PURE
 *  and must not import this server-only module. */
export { totalsRow };
export type { CallActivityTotals };

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

/** Exported so `call-activity-export.ts` can call the same RPC and shape
 *  its answer the same way — one mapping, never two that could drift. */
export interface RpcPayload {
  total: number;
  pages: number;
  page: number;
  statuses: RpcStatus[];
  totals: CallActivityTotals;
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

/**
 * The ONE mapping from the RPC's jsonb answer to `RepRow[]`/`StatusColumns`
 * — shared by the screen (`getCallActivityReport`, one page) and the
 * export (`call-activity-export.ts`, every row via `p_page: 0`), so the two
 * can never shape the same answer two different ways.
 */
export function shapeRpcPayload(
  payload: RpcPayload,
): Pick<CallActivityReportModel, "reps" | "columns" | "totals" | "total" | "page" | "pages"> {
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
    reps,
    columns,
    totals: payload.totals,
    total: payload.total,
    page: payload.page,
    pages: payload.pages,
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

  return { ok: true, ...shapeRpcPayload(data as RpcPayload) };
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shape AND calendar validity — "2026-13-40" matches `ISO_DATE`'s shape but
 * is not a real day, and `Date.UTC()` would otherwise silently roll it over
 * into March. The round-trip through `getUTC*()` is what catches that.
 */
function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * The Call Activity Report's own filters, parsed from raw query-param
 * strings — LENIENTLY, per the client's instruction: "sane fallbacks and a
 * visible message, never a crash."
 *
 * Each field is validated on its own and, if it fails, dropped from the
 * filter (treated as absent) with a plain-English notice explaining why —
 * never a thrown error and never silence. `p_status`/`p_member` are typed
 * parameters on the RPC (text/uuid), so a malformed value sent straight
 * through would come back as a database error the reader never asked a
 * question that produced; catching the obvious cases here means that never
 * happens for a stale link, a hand-edited URL, or a status an admin retired
 * since the link was shared.
 *
 * `p_institute` is NAME-CONTAINS free text and takes no validation beyond
 * trimming to empty — there is no wrong way to spell a search term.
 */
export function parseCallActivityFilters(
  raw: {
    from?: string;
    to?: string;
    member?: string;
    institute?: string;
    status?: string;
  },
  catalogue: StatusCatalogue,
): { filters: CallActivityFilters; notices: string[] } {
  const notices: string[] = [];

  let from = raw.from && isValidDate(raw.from) ? raw.from : undefined;
  if (raw.from && !from) {
    notices.push("That From date was not valid, so it was ignored.");
  }

  let to = raw.to && isValidDate(raw.to) ? raw.to : undefined;
  if (raw.to && !to) {
    notices.push("That To date was not valid, so it was ignored.");
  }

  if (from && to && from > to) {
    notices.push(
      "The To date must not be before the From date, so the date range was ignored.",
    );
    from = undefined;
    to = undefined;
  }

  const member = raw.member && UUID.test(raw.member) ? raw.member : undefined;
  if (raw.member && !member) {
    notices.push("That representative could not be identified, so it was ignored.");
  }

  const status =
    raw.status && catalogue.some((row) => row.status === raw.status)
      ? raw.status
      : undefined;
  if (raw.status && !status) {
    notices.push("That status is no longer available, so it was ignored.");
  }

  const institute = raw.institute?.trim() ? raw.institute.trim() : undefined;

  return { filters: { from, to, member, institute, status }, notices };
}
