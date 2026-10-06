import { z } from "zod";
import { SORT_BY_REP } from "@/lib/exports/activity-grid";

/**
 * The pipeline report's URL state: an optional date range, and a sort.
 *
 * WHY NOT `exportRangeSchema`. That schema is `/team/report`'s and the Excel
 * endpoint's, and it does two things this screen must not: it DEFAULTS to the
 * current month, and it caps a range at `MAX_RANGE_DAYS`. Both are right there
 * and wrong here — see `pipelineRangeSchema` below for why this report's
 * default has to be "no range at all". Sharing it would have meant one of the
 * two screens getting a default it did not want, so the real-date refinement is
 * reproduced and the defaults are not.
 *
 * `from` / `to` rather than `start` / `end`, matching `/review`'s filter
 * vocabulary rather than `/team/report`'s range vocabulary. The two spellings
 * coexist deliberately: `/team/report` cannot rename its parameters without
 * breaking the export links already in the wild, and this screen has no
 * bookmarks to honour because it has never taken a parameter. Said here so the
 * next reader does not "fix" the inconsistency into a breaking change.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar date, not merely ten characters in the right shape.
 *
 * The same refinement `exportRangeSchema` carries, for the same reason:
 * `2026-02-31` matches the pattern and is not a day, and PostgREST answers a
 * malformed date with a 400 an admin cannot act on.
 */
const isoDate = z
  .string()
  .regex(ISO_DATE, "Use a date in YYYY-MM-DD form.")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    );
  }, "That is not a real date.");

/** Absent, blank or whitespace all mean "no bound". */
const optionalIsoDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : v))
  .pipe(isoDate.optional());

/**
 * The range, with NO DEFAULT — and the absence is the decision.
 *
 * THE REPORT'S CONTRACT IS "RIGHT NOW". It is titled "where every registered
 * institute stands right now", and its own page comment explains at length
 * that it deliberately has no date controls because an institute has exactly
 * one current status. A default window would quietly hide every institute
 * whose status has not moved this month — which is precisely the stalled
 * pipeline an admin opens this screen to find. So an unparameterised URL means
 * every institute, exactly as it does today, and a range is something the
 * reader asks for.
 *
 * NO `MAX_RANGE_DAYS` CAP either, unlike the export schema. That cap exists to
 * stop a ten-year export being built row by row; this filter only narrows a
 * read the screen was going to do in full anyway, so a wide range is cheaper
 * than a narrow one rather than more expensive.
 *
 * ONE BOUND IS VALID. "Everything since 1 April" and "everything up to 30
 * June" are both real questions, so neither end requires the other.
 */
export const pipelineRangeSchema = z
  .object({
    from: optionalIsoDate,
    to: optionalIsoDate,
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "The start date has to be on or before the end date.",
    path: ["from"],
  });

export type PipelineRange = z.infer<typeof pipelineRangeSchema>;

/** Whether a parsed range actually narrows anything. */
export function rangeIsActive(range: PipelineRange): boolean {
  return Boolean(range.from || range.to);
}

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface PipelineSort {
  key: string;
  dir: SortDirection;
}

/** Today's order, and what an unparameterised URL still resolves to. */
export const DEFAULT_PIPELINE_SORT: PipelineSort = {
  key: SORT_BY_REP,
  dir: "asc",
};

/**
 * The sort, parsed LENIENTLY — an unknown value falls back to the default
 * rather than raising.
 *
 * THIS IS DELIBERATELY UNLIKE `/team/report`, which hard-errors on a bad range
 * and offers a "back to this month" button. The difference is what a wrong
 * value costs: a wrong RANGE produces wrong NUMBERS under a heading that does
 * not mention it, which has to be refused. A wrong SORT produces the right
 * numbers in a different order, which is a presentation fault and not a
 * correctness one.
 *
 * So this follows `/institutes`'s documented stance for presentation
 * parameters instead — "a status that no longer exists, a city nobody is in:
 * each lands on a readable answer with its own filter visible and clearable.
 * Rejecting them would turn a stale bookmark into an error page." A status
 * column that was renamed or retired since somebody saved a sorted link is
 * exactly that case, and it is not rare.
 *
 * `allowed` is the sort keys the grid actually emitted this render, so a key
 * naming a column that is not on the page is treated as unknown — which is the
 * renamed-status case arriving by its other door.
 */
export function parsePipelineSort(
  rawKey: string | undefined,
  rawDir: string | undefined,
  allowed: readonly string[],
): PipelineSort {
  // An unrecognised key takes the default DIRECTION with it, rather than
  // leaving "rep, descending" behind from a URL that was only half understood.
  if (!rawKey || !allowed.includes(rawKey)) return DEFAULT_PIPELINE_SORT;

  const dir = (SORT_DIRECTIONS as readonly string[]).includes(rawDir ?? "")
    ? (rawDir as SortDirection)
    : DEFAULT_PIPELINE_SORT.dir;

  return { key: rawKey, dir };
}

/**
 * The report's whole URL state, as one object.
 *
 * Built in one place so the sort links carry the range and the range control
 * carries the sort — the two parameter sets cannot drift apart if there is only
 * one function that writes them.
 */
export function pipelineHref(state: {
  range: PipelineRange;
  sort: PipelineSort;
}): string {
  const params = new URLSearchParams();
  if (state.range.from) params.set("from", state.range.from);
  if (state.range.to) params.set("to", state.range.to);
  // The default sort is never written: an unparameterised URL and an explicitly
  // default-sorted one are the same report, and the shorter link is the one
  // worth sharing.
  if (
    state.sort.key !== DEFAULT_PIPELINE_SORT.key ||
    state.sort.dir !== DEFAULT_PIPELINE_SORT.dir
  ) {
    params.set("sort", state.sort.key);
    params.set("dir", state.sort.dir);
  }
  const query = params.toString();
  return query ? `/institutes/report?${query}` : "/institutes/report";
}

/**
 * Where a header should point to sort by its own column.
 *
 * The active column reverses; every other column starts at the direction that
 * is useful first. For the NAME that is ascending (A–Z, the default); for a
 * COUNT it is descending, because "who has the most" is the question a reader
 * taps a count column to ask, and making them tap twice to get it would be a
 * worse answer to the obvious one.
 */
export function sortHref(
  sortKey: string,
  current: PipelineSort,
  range: PipelineRange,
): string {
  const dir: SortDirection =
    current.key === sortKey
      ? current.dir === "asc"
        ? "desc"
        : "asc"
      : sortKey === SORT_BY_REP
        ? "asc"
        : "desc";
  return pipelineHref({ range, sort: { key: sortKey, dir } });
}
