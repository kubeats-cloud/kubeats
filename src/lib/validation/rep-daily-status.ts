/**
 * The three daily statuses, and the shape of the report RPC's answer.
 *
 * Kept free of `server-only` and of any database import so the labelling and
 * the payload shaping can be unit tested without a Supabase project — the same
 * bargain `src/lib/exports/call-activity-grid.ts` makes for its own grid.
 */

export const DAILY_STATUSES = ["in_field", "in_office", "on_leave"] as const;

export type DailyStatus = (typeof DAILY_STATUSES)[number];

/**
 * The client's own wording. "On-Leave" keeps the hyphen so the three buttons
 * read as one vocabulary; the staff table's four columns use the shorter
 * "Leave" for the same value because its header row is a count, not a choice.
 */
export const DAILY_STATUS_LABELS: Record<DailyStatus, string> = {
  in_field: "In-Field",
  in_office: "In-Office",
  on_leave: "On-Leave",
};

export function isDailyStatus(value: unknown): value is DailyStatus {
  return (
    typeof value === "string" &&
    (DAILY_STATUSES as readonly string[]).includes(value)
  );
}

export interface DailyStatusCounts {
  inField: number;
  inOffice: number;
  onLeave: number;
  /**
   * Days that carry a stored status in the range. NOT the number of calendar
   * days: a day with no row is "not recorded" and appears in no count, here
   * or in any of the three above.
   */
  recorded: number;
}

export interface DailyStatusDay {
  /** YYYY-MM-DD in the Asia/Kolkata calendar. */
  date: string;
  status: DailyStatus;
}

export interface DailyStatusRepRow extends DailyStatusCounts {
  id: string;
  name: string;
  /** Every recorded day in range, oldest first. Days with no row are absent. */
  days: DailyStatusDay[];
}

export interface DailyStatusReport {
  start: string;
  end: string;
  /** Reps in the caller's scope, not just this page. */
  total: number;
  pages: number;
  page: number;
  totals: DailyStatusCounts;
  rows: DailyStatusRepRow[];
}

export const DAILY_STATUS_PAGE_SIZE = 50;

export const EMPTY_DAILY_STATUS_COUNTS: DailyStatusCounts = {
  inField: 0,
  inOffice: 0,
  onLeave: 0,
  recorded: 0,
};

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}

function asCounts(value: unknown): DailyStatusCounts {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    inField: asCount(raw.inField),
    inOffice: asCount(raw.inOffice),
    onLeave: asCount(raw.onLeave),
    recorded: asCount(raw.recorded),
  };
}

function asDay(value: unknown): DailyStatusDay | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.date !== "string" || !isDailyStatus(raw.status)) return null;
  return { date: raw.date, status: raw.status };
}

function asRow(value: unknown): DailyStatusRepRow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  const name =
    typeof raw.name === "string" && raw.name.trim() !== ""
      ? raw.name
      : "Unnamed rep";
  const days = Array.isArray(raw.days)
    ? raw.days.map(asDay).filter((day): day is DailyStatusDay => day !== null)
    : [];
  return { id: raw.id, name, ...asCounts(raw), days };
}

/**
 * The RPC's jsonb answer, validated and shaped.
 *
 * Returns null for anything that is not the contract (a missing rows array, a
 * non-object), so the caller shows its error state rather than an empty table
 * that reads like a quiet month. Individual malformed day entries are dropped
 * — the columns are CHECK-constrained, so this is defence, not expectation.
 */
export function shapeDailyStatusReport(
  payload: unknown,
): DailyStatusReport | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  if (!Array.isArray(raw.rows)) return null;
  if (typeof raw.start !== "string" || typeof raw.end !== "string") return null;

  return {
    start: raw.start,
    end: raw.end,
    total: asCount(raw.total),
    pages: Math.max(1, asCount(raw.pages)),
    page: Math.max(1, asCount(raw.page)),
    totals: asCounts(raw.totals),
    rows: raw.rows.map(asRow).filter((row): row is DailyStatusRepRow => row !== null),
  };
}

/** The one rep's row, or a zeroed shape when the RPC did not list them. */
export function rowForRep(
  report: DailyStatusReport,
  repId: string,
): DailyStatusRepRow {
  return (
    report.rows.find((row) => row.id === repId) ?? {
      id: repId,
      name: "",
      ...EMPTY_DAILY_STATUS_COUNTS,
      days: [],
    }
  );
}
