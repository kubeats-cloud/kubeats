import type { PipelineRange } from "@/lib/validation/pipeline-report";
import type { ActivityType } from "@/lib/validation/weekly";
import type { StatusCategory } from "@/lib/validation/institute";
import type { InstituteActivitySortKey } from "@/lib/institute-activity-counts";

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
}): string {
  const params = new URLSearchParams({
    institute: input.instituteId,
    activity: input.activity,
    category: input.category,
  });
  if (input.range.from) params.set("from", input.range.from);
  if (input.range.to) params.set("to", input.range.to);
  return `/review?${params.toString()}`;
}

export function instituteActivitySortHref(input: {
  key: InstituteActivitySortKey;
  currentKey: InstituteActivitySortKey;
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
  sortKey: InstituteActivitySortKey;
  sortDir: "asc" | "desc";
  page?: string;
}): string {
  const params = new URLSearchParams();
  if (input.range.from) params.set("from", input.range.from);
  if (input.range.to) params.set("to", input.range.to);
  params.set("sort", input.sortKey);
  params.set("dir", input.sortDir);
  if (input.page) params.set('page', input.page);
  return `/api/export/institute-activity?${params.toString()}`;
}
