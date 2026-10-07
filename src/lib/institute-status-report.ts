import "server-only";
import {
  SORT_BY_REP,
  SORT_BY_TOTAL,
  statusColumnsFor,
  statusesWithoutColumns,
  type RepRow,
  type StatusColumn,
  type StatusColumns,
} from "@/lib/exports/activity-grid";
import { ZERO_COUNTS } from "@/lib/validation/weekly";
import { listInstitutes, type StatusChangedRange } from "@/lib/institutes";
import { listStatusCatalogue } from "@/lib/statuses";
import { listReps } from "@/lib/closing-report";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import {
  DEFAULT_PIPELINE_SORT,
  parsePipelineSort,
  rangeIsActive,
  type PipelineRange,
  type PipelineSort,
} from "@/lib/validation/pipeline-report";

/**
 * Where every institute stands, one row per rep.
 *
 * THE ACTIVITY REPORT'S TWIN, and deliberately built from the same parts. That
 * report counts `visits.status_set_to` over a DATE RANGE; this one counts
 * `institutes.status` RIGHT NOW. Same rows, same columns, same order — a
 * different denominator.
 *
 * `statusColumnsFor()` is shared rather than re-implemented, so both reports
 * get the client's template ordering, the admin's added statuses appended
 * after it, and retired statuses included only when something still points at
 * them. A second copy of that logic would drift the first time an admin
 * retired something, and the two reports would disagree about which columns
 * exist while claiming the same vocabulary.
 *
 * NO DATE RANGE, AND THAT IS THE WHOLE DIFFERENCE. An institute has exactly
 * one current status; asking what it was in March would mean reading
 * `institute_status_history`, which is a different report. That is also why
 * this is its own route rather than a tab on /team/report, whose entire
 * contract is `?start=&end=`.
 */

/** The sentinel the "No status yet" column counts under. Matches /institutes. */
export const NO_STATUS_KEY = "__none__";

/** The sentinel the Unassigned row links by. Matches /institutes. */
export const UNASSIGNED_KEY = "__unassigned__";

export const NO_STATUS_LABEL = "No status yet";
export const UNASSIGNED_LABEL = "Unassigned";

/** The three figures the summary line prints. */
export interface InstituteStatusCounts {
  /**
   * PROFILE-BACKED ROWS ONLY.
   *
   * The row list is not the rep list: it also carries any owner with no
   * matching profile ("Not a rep") and, when present, the Unassigned
   * sentinel. Counting the rows and calling the answer "reps" would overstate
   * the team by however many of those exist, which on a tidy database is zero
   * and on the one that needs this report most is not.
   */
  reps: number;
  /**
   * Closed + open columns. EXCLUDES "No status yet".
   *
   * Null is not a status — it is the absence of one, which is why it gets its
   * own band rather than a place in either vocabulary. Counting it here would
   * make the vocabulary one bigger than Settings says it is.
   */
  statuses: number;
  /** Owners with no matching profile row. Usually 0; printed only when not. */
  nonRepOwners: number;
  /** Whether an Unassigned row is present. Its own clause, not a rep. */
  anyUnassigned: boolean;
}

export interface InstituteStatusModel {
  reps: RepRow[];
  columns: StatusColumns;
  /**
   * Null WHILE A RANGE IS ACTIVE, and that is the whole of C2's honesty.
   *
   * An institute with no status has a null `status_updated_at` by construction
   * — `touch_institute_status()` stamps it only when a status is set — so it
   * cannot be inside any window. Keeping the column and showing zero would
   * claim the team has no unreached institutes; dropping the column says the
   * question is not being asked. The second is true, so the band goes and the
   * screen explains why.
   */
  unsetColumn: StatusColumn | null;
  /**
   * EVERY institute the caller can see, whatever the range.
   *
   * Deliberately unfiltered, so the header can say "X of T" and the reader can
   * see how much of the registry the window is hiding. Costs a second count
   * and is the only thing that makes the filtered figure interpretable.
   */
  total: number;
  /**
   * The institutes inside the range — which is what the grand total must equal.
   *
   * Identical to `total` when no range is active, which is why the unfiltered
   * report reconciles exactly as it did before.
   */
  filteredTotal: number;
  /** True when `?from=` or `?to=` narrowed the read. */
  rangeActive: boolean;
  /** The range as it was understood, for the controls to mount with. */
  range: PipelineRange;
  /** The sort as it was RESOLVED — an unknown key has already fallen back. */
  sort: PipelineSort;
  counts: InstituteStatusCounts;
}

/**
 * OWNER, NOT VISITOR, AND IT IS NOT CONFIGURABLE.
 *
 * "Per rep" is genuinely ambiguous here — two reps share a campus, so the
 * person who REGISTERED an institute and the person who last VISITED it are
 * often different. This report answers the ownership question, because that is
 * the one with consequences: after 0028 `institutes_select` keys on
 * `registered_by`, so the owner is the only rep who can see it, plan a visit to
 * it, or act on what it is waiting for. A visitor-keyed version would be a
 * second, differently-shaped number under the same heading.
 *
 * ROWS ARE EVERY REP, not only the ones holding something. A rep with an empty
 * pipeline is exactly what an admin opens this to find, and a row of zeroes
 * says it where an absent row says nothing. It also keeps this report
 * row-comparable with /team/report, which lists every rep for the same reason.
 *
 * AN OWNER WHO IS NOT A REP STILL GETS A ROW. An admin should own nothing —
 * FO021 gives them no campus and 0028 would make the institute invisible to
 * everyone — but a legacy or hand-edited row could still name one, and the
 * totals have to reconcile with the institutes list whatever the data says. An
 * owner with no matching profile is listed by id rather than dropped.
 */
export interface InstituteStatusQuery {
  /** The optional `?from=` / `?to=` window on `status_updated_at`. */
  range?: PipelineRange;
  /** The raw `?sort=` / `?dir=`, resolved against this render's own columns. */
  sort?: { key?: string; dir?: string };
}

export async function getInstituteStatusModel(
  query: InstituteStatusQuery = {},
): Promise<{ ok: true; model: InstituteStatusModel } | { ok: false; error: string }> {
  const range: PipelineRange = query.range ?? {};
  const rangeActive = rangeIsActive(range);

  /*
   * TWO READS OF THE SAME TABLE WHEN, AND ONLY WHEN, A RANGE IS ACTIVE.
   *
   * The second is a `head: true` count and nothing else — it exists so the
   * header can say "X of T" and the reader can see how much of the registry
   * the window is hiding. Without it a filtered report is a number with no
   * denominator, which is exactly how a filter gets mistaken for a total.
   *
   * Skipped entirely with no range, where the two answers are the same by
   * definition, so the unfiltered report costs precisely what it costs today.
   */
  const [registry, catalogue, reps, unfilteredCount] = await Promise.all([
    listInstitutes(rangeActive ? (range as StatusChangedRange) : undefined),
    listStatusCatalogue(),
    listReps(),
    rangeActive ? countAllInstitutes() : Promise.resolve(null),
  ]);

  if (!registry.ok) {
    return {
      ok: false,
      error: "We could not read the registry just now. Please try again in a moment.",
    };
  }

  const institutes = registry.institutes;

  /*
   * THE COLUMNS COME FROM WHAT IS ACTUALLY HELD.
   *
   * `statusColumnsFor()` takes the statuses that have counts so it can decide
   * which RETIRED ones still deserve a column — a status retired years ago
   * with nothing pointing at it contributes nothing and gets none, while one
   * that institutes still sit at cannot be allowed to vanish or the rows would
   * stop adding up to their own total.
   */
  const held = new Set<string>();
  for (const institute of institutes) {
    if (institute.status) held.add(institute.status);
  }
  const columns = statusColumnsFor(catalogue, held);

  /**
   * REFUSE RATHER THAN SHOW A REPORT THAT DOES NOT ADD UP.
   *
   * The same guard `getActivityReportModel()` has carried since the export
   * shipped, and this report needed it the moment a grand total appeared on
   * screen beside the "T institutes in all" header.
   *
   * `institutes.status` is a foreign key into `institute_statuses` (0026), so
   * a held status with no column is impossible — UNLESS
   * `listStatusCatalogue()` fell back to the seeded nine because its read
   * failed, in which case every status an admin has added since loses its
   * column and those institutes vanish from the bands while still being
   * counted in the header. The reader would see a grand total quietly smaller
   * than the figure printed above it, with nothing to say which number to
   * trust.
   *
   * So the reconciliation requirement is enforced here rather than hoped for:
   * if a status cannot be given a column, there is no honest report to draw.
   */
  const orphans = statusesWithoutColumns(columns, held);
  if (orphans.length > 0) {
    logError(
      "pipeline:status-columns",
      `statuses held but absent from the catalogue: ${orphans.join(", ")}`,
    );
    return {
      ok: false,
      error:
        "We could not read the full status list, so this report would have been missing columns. Please try again in a moment.",
    };
  }

  // Tally by owner, with null owners collected under the sentinel.
  const byOwner = new Map<string, Record<string, number>>();
  const namesSeen = new Map<string, string>();

  for (const institute of institutes) {
    const owner = institute.registered_by ?? UNASSIGNED_KEY;
    if (institute.registered_by && institute.ownerName) {
      namesSeen.set(institute.registered_by, institute.ownerName);
    }
    const key = institute.status ?? NO_STATUS_KEY;
    const counts = byOwner.get(owner) ?? {};
    counts[key] = (counts[key] ?? 0) + 1;
    byOwner.set(owner, counts);
  }

  const row = (id: string, name: string): RepRow => ({
    id,
    name,
    // Never read: the caller passes showActivities: false, so the activity band
    // is not drawn and these cells are not emitted. Present because the grid's
    // row type is shared with the activity report, which does read them.
    activities: { ...ZERO_COUNTS },
    statuses: byOwner.get(id) ?? {},
  });

  /*
   * THREE TIERS, AND SORTING ONLY EVER REORDERS WITHIN ONE.
   *
   * The tier is carried on the row rather than inferred afterwards, because
   * after a sort there is no way to tell a rep called "Unassigned" from the
   * sentinel by looking at the name. See `comparePipelineRows()` for the rule
   * this exists to make enforceable.
   */
  const tiered: { row: RepRow; tier: number }[] = reps.map((rep) => ({
    row: row(rep.id, rep.name),
    tier: 0,
  }));

  // Any owner the rep list did not cover — see the note above.
  const known = new Set(reps.map((rep) => rep.id));
  let nonRepOwners = 0;
  for (const owner of byOwner.keys()) {
    if (owner === UNASSIGNED_KEY || known.has(owner)) continue;
    tiered.push({ row: row(owner, namesSeen.get(owner) ?? "Not a rep"), tier: 1 });
    nonRepOwners += 1;
  }

  /*
   * UNASSIGNED IS LAST, AND ONLY WHEN THERE IS ONE.
   *
   * `registered_by` is `on delete set null`, so removing a departed rep
   * orphans their whole pipeline at once — invisible to every rep, and
   * otherwise findable only by scrolling the registry for red badges. It sits
   * after the people because it is not one.
   *
   * AND IT STAYS LAST UNDER EVERY SORT, which is tier 2 below. C3 would
   * otherwise have quietly repealed this paragraph the first time somebody
   * sorted by a count.
   */
  const anyUnassigned = byOwner.has(UNASSIGNED_KEY);
  if (anyUnassigned) {
    tiered.push({ row: row(UNASSIGNED_KEY, UNASSIGNED_LABEL), tier: 2 });
  }

  /*
   * The sort, resolved against THIS RENDER'S columns.
   *
   * `allowed` is built from the columns that actually exist, so a saved link
   * naming a status an admin has since renamed falls back to the default
   * instead of sorting by a column nobody can see. The NO STATUS sentinel is
   * offered only while its band is drawn — sorting by a column the range just
   * removed would be sorting by nothing.
   */
  const unsetColumn: StatusColumn | null = rangeActive
    ? null
    : { status: NO_STATUS_KEY, label: NO_STATUS_LABEL, retired: false };

  const allowed = [
    SORT_BY_REP,
    ...columns.closed.map((c) => c.status),
    ...columns.open.map((c) => c.status),
    ...(unsetColumn ? [unsetColumn.status] : []),
    SORT_BY_TOTAL,
  ];

  const sort = query.sort
    ? parsePipelineSort(query.sort.key, query.sort.dir, allowed)
    : DEFAULT_PIPELINE_SORT;

  tiered.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return comparePipelineRows(a.row, b.row, sort, unsetColumn);
  });

  return {
    ok: true,
    model: {
      reps: tiered.map((entry) => entry.row),
      columns,
      unsetColumn,
      // `institutes.length` IS the filtered figure — the read was narrowed.
      // With no range the count query was skipped and the two are one number,
      // which is what keeps the unfiltered report reconciling as it always has.
      total: unfilteredCount ?? institutes.length,
      filteredTotal: institutes.length,
      rangeActive,
      range,
      sort,
      counts: {
        reps: reps.length,
        statuses: columns.closed.length + columns.open.length,
        nonRepOwners,
        anyUnassigned,
      },
    },
  };
}

/**
 * How many institutes the caller can see in total, ignoring any range.
 *
 * A `head: true` count, so it fetches no rows — it exists only to give the
 * filtered figure a denominator. Scoped by RLS exactly as the full read is, so
 * "T" means the same thing to the same reader.
 *
 * Returns null on failure rather than refusing the report: a missing
 * denominator costs the header its "of T" clause, which is worth far less than
 * the report itself.
 */
async function countAllInstitutes(): Promise<number | null> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("institutes")
    .select("id", { count: "exact", head: true });

  if (error) {
    logError("pipeline:total-count", error);
    return null;
  }
  return count ?? null;
}

/**
 * The comparator, within one tier.
 *
 * TIES ALWAYS BREAK BY NAME, ASCENDING. Without it two reps holding the same
 * count would come back in whatever order the array happened to be in, so two
 * renders of identical data could differ and a sorted link would not be a
 * stable thing to send somebody. `localeCompare` because the names are
 * people's.
 *
 * A COUNT column sorts by that column's cell; `total` sorts by the row's own
 * status sum — recomputed here rather than read off the grid, because the grid
 * has not been built yet at this point and the arithmetic is the same two
 * lines. `activity-grid-bands.test.ts` is what proves the two agree.
 */
export function comparePipelineRows(
  a: RepRow,
  b: RepRow,
  sort: PipelineSort,
  unsetColumn: StatusColumn | null,
): number {
  const byName = a.name.localeCompare(b.name);
  if (sort.key === SORT_BY_REP) return sort.dir === "asc" ? byName : -byName;

  const value = (rep: RepRow): number => {
    if (sort.key !== SORT_BY_TOTAL) return rep.statuses[sort.key] ?? 0;
    // The row total: every status cell the grid will draw, which is exactly
    // the keys it has columns for. Summing `rep.statuses` wholesale would also
    // count a status that lost its column, and the two figures must agree.
    return Object.entries(rep.statuses).reduce(
      (sum, [status, n]) =>
        status === NO_STATUS_KEY && !unsetColumn ? sum : sum + n,
      0,
    );
  };

  const delta = value(a) - value(b);
  if (delta !== 0) return sort.dir === "asc" ? delta : -delta;
  return byName;
}

/**
 * Where a cell goes when it is clicked: that owner's institutes at that status.
 *
 * The parameters are the ones `/institutes` already understands, and the two
 * sentinels are the ones it already uses — so this is a link into a screen that
 * was built to answer it, not a new view. This is the client's "click 3
 * scheduled and open those three institutes", end to end.
 */
/*
 * RE-EXPORTED, NOT REDEFINED. The body moved to validation/pipeline-report.ts
 * because this module is `server-only` and the report's grid is now a client
 * component — see that file. Kept here so every existing import still resolves
 * and there is one definition rather than two that can drift.
 */
export { cohortHref } from "@/lib/validation/pipeline-report";
