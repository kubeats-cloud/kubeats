import type { PipelineRange } from "@/lib/validation/pipeline-report";
import type { ActivityType } from "@/lib/validation/weekly";
import type { StatusCategory } from "@/lib/validation/institute";

/**
 * URL builders for the institute-wise Activity Report.
 *
 * Pure — safe for client components that rebuild sort links.
 */

export function reviewCohortHref(input: {
  instituteId: string;
  activity: ActivityType;
  category: StatusCategory;
  range: PipelineRange;
  member?: string;
}): string {
  const params = new URLSearchParams({
    institute: input.instituteId,
    activity: input.activity,
    category: input.category,
  });
  if (input.range.from) params.set("from", input.range.from);
  if (input.range.to) params.set("to", input.range.to);
  if (input.member) params.set('member',input.member);
  return `/review?${params.toString()}`;
}

/**
 * The Excel export's fixed maximum, in calendar days inclusive.
 *
 * Chosen rather than arbitrary: a month is the longest range an admin reads a
 * report over, and 31 days keeps the visit-level sheet to one screenful of
 * dates per rep while still allowing "this month". The RPC enforces the same
 * number in SQL (0060); this constant is what the screen and route use so the
 * message a reader sees before clicking matches the refusal they would get.
 */
export const MAX_ACTIVITY_EXPORT_DAYS = 31;

/**
 * Why this range cannot be exported, or null when it can.
 *
 * The message is the one the RPC raises, word for word, so a download that is
 * blocked in the browser and one refused by the database read the same.
 */
export function instituteActivityExportRangeProblem(
  range: PipelineRange,
): string | null {
  if (!range.from || !range.to) {
    return "Choose a From and To date for the Excel export.";
  }
  if (range.to < range.from) {
    return "The To date must not be before the From date.";
  }
  const [fy, fm, fd] = range.from.split("-").map(Number);
  const [ty, tm, td] = range.to.split("-").map(Number);
  const days =
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000 + 1;
  if (days > MAX_ACTIVITY_EXPORT_DAYS) {
    return `Choose a date range of ${MAX_ACTIVITY_EXPORT_DAYS} days or fewer for the Excel export.`;
  }
  return null;
}

export function instituteActivitySortHref(input: {
  key: string;
  currentKey: string;
  currentDir: "asc" | "desc";
  range: PipelineRange;
  basePath?: string;
  /**
   * Anything else already in the URL that must survive a sort click — same
   * purpose as `RangeControls`' own `extraParams`. Needed on `/institutes`,
   * which also carries the registry browser's own `?q=`/`?status=`/etc.;
   * without this, clicking a column header there would silently drop them.
   */
  extraParams?: Record<string, string>;
}): string {
  const nextDir =
    input.key === input.currentKey && input.currentDir === "asc"
      ? "desc"
      : "asc";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input.extraParams ?? {})) {
    params.set(key, value);
  }
  if (input.range.from) params.set("from", input.range.from);
  if (input.range.to) params.set("to", input.range.to);
  params.set("sort", input.key);
  params.set("dir", nextDir);
  const path = input.basePath ?? "/institutes/report";
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function instituteActivityExportHref(input: {
  range: PipelineRange;
  sortKey: string;
  sortDir: "asc" | "desc";
  page?: string;
  search?: string;
  member?: string;
  campus?: string;
  view?: 'rep' | 'presence';
}): string {
  const params = new URLSearchParams();
  if (input.range.from) params.set("from", input.range.from);
  if (input.range.to) params.set("to", input.range.to);
  params.set("sort", input.sortKey);
  params.set("dir", input.sortDir);
  if (input.page) params.set('page', input.page);
  if (input.search) params.set('q',input.search);
  if (input.member) params.set('member',input.member);
  if (input.campus) params.set('campus',input.campus);
  if (input.view) params.set('view',input.view);
  return `/api/export/institute-activity?${params.toString()}`;
}
