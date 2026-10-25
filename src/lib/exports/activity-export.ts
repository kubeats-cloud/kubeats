import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { listStatusCatalogue } from "@/lib/statuses";
import {
  tallyVisitMetrics,
  type MetricCounts,
} from "@/lib/validation/weekly";
import {
  countActivityOpenClosed,
  type CountableVisit,
} from "@/lib/institute-activity-counts";
import {
  activitySheet,
  activitySortKeys,
  OTHER_INACTIVE_STATUS,
  OTHER_INACTIVE_STATUS_LABEL,
  sortRepRows,
  statusColumnsFor,
  statusesWithoutColumns,
  type GridInput,
  type RepRow,
  type StatusColumns,
} from "@/lib/exports/activity-grid";
import type { StatusCatalogue } from "@/lib/validation/institute";
import { parsePipelineSort } from "@/lib/validation/pipeline-report";
import { buildWorkbook } from "@/lib/xlsx";
import type { SheetSpec } from "@/lib/xlsx";

/**
 * The export's reads.
 *
 * RULE 7 IS NOT REIMPLEMENTED HERE, and that is the point of the file.
 * `week-summary.ts` already answers "what did this rep do" for a week; this
 * answers it for an arbitrary range, using the same two sources in the same
 * split and the same `tallyVisitMetrics()` to count them:
 *
 *   Meetings          daily_plans where meetings_actual = 1, by `date`
 *   the other seven   visits, by `date`, through tallyVisitMetrics()
 *
 * So a month-long export whose range happens to be one week returns the same
 * eight numbers the Team screen shows for that week, because it is the same
 * function reading the same columns with the same filter. There is no second
 * definition of a meeting anywhere in this codebase, and adding one here —
 * counting `activity = 'meeting'` out of `visits`, which looks equivalent and
 * is not — is the specific mistake this comment exists to prevent.
 *
 * The status counts have no existing helper to reuse because nothing else in
 * the app counts them: they are a straight tally of `visits.status_set_to` over
 * the same rows, in the same range, so they reconcile with the activity columns
 * by construction — every visit contributes exactly one status and exactly one
 * activity.
 *
 * WHY NOT A DATABASE VIEW OR AN RPC. Because the counting rule would then exist
 * twice, in TypeScript and in SQL, and the two would drift the first time a
 * metric changed. CLAUDE.md puts load-bearing RULES in the database; this is a
 * report, and its arithmetic belongs next to the arithmetic it has to match.
 *
 * SCOPING is RLS's, as everywhere else. An admin's session returns the team's
 * rows; the route refuses a non-admin before it gets here, so the member filter
 * below is for correctness of the answer, not for security.
 */

export interface ExportRange {
  /** Inclusive YYYY-MM-DD. */
  start: string;
  end: string;
}

export type ExportResult =
  | { ok: true; filename: string; bytes: Uint8Array }
  | { ok: false; error: string };

interface RepProfile {
  id: string;
  name: string;
}

/**
 * One row per rep — every rep, or one.
 *
 * A rep with no activity in the range still gets a row of zeroes rather than
 * being dropped. "Nobody logged anything" and "this person is not on the team"
 * are different answers, and a report that cannot tell them apart is one an
 * admin has to go and check somewhere else.
 */
async function readRows(
  range: ExportRange,
  memberId: string | null,
): Promise<
  | {
      ok: true;
      reps: RepRow[];
      statusesSeen: Set<string>;
      /**
       * The same visit rows, kept per rep so the caller can split them by
       * activity once the status catalogue has arrived. Re-reading them there
       * would be a second query (and a second chance to disagree); deriving
       * them here would need the catalogue before the parallel reads start.
       */
      visitsByMember: Map<string, CountableVisit[]>;
    }
  | { ok: false; error: string }
> {
  const supabase = await createClient();

  let profileQuery = supabase
    .from("profiles")
    .select("id, name")
    .eq("role", "rep")
    .order("name");
  if (memberId) profileQuery = profileQuery.eq("id", memberId);

  let plansQuery = supabase
    .from("daily_plans")
    .select("member")
    .eq("meetings_actual", 1)
    .gte("date", range.start)
    .lte("date", range.end);
  if (memberId) plansQuery = plansQuery.eq("member", memberId);

  let visitsQuery = supabase
    .from("visits")
    .select("institute_id, member, activity, lifecycle_status, status_set_to")
    .gte("date", range.start)
    .lte("date", range.end);
  if (memberId) visitsQuery = visitsQuery.eq("member", memberId);

  const [profiles, plans, visits] = await Promise.all([
    profileQuery,
    plansQuery,
    visitsQuery,
  ]);

  for (const [context, result] of [
    ["export:profiles", profiles],
    ["export:meetings", plans],
    ["export:visits", visits],
  ] as const) {
    if (result.error) {
      logError(context, result.error);
      return { ok: false, error: "We could not build that export just now." };
    }
  }

  const people = (profiles.data ?? []) as RepProfile[];
  if (people.length === 0) {
    return {
      ok: false,
      error: memberId
        ? "That member is not a rep, or is not visible to you."
        : "There are no reps to export yet.",
    };
  }

  // Rule 7's first half: meetings held, per rep.
  const meetings = new Map<string, number>();
  for (const row of plans.data ?? []) {
    meetings.set(row.member, (meetings.get(row.member) ?? 0) + 1);
  }

  const visitsByMember = new Map<string, CountableVisit[]>();
  const statusesByMember = new Map<string, Record<string, number>>();
  const statusesSeen = new Set<string>();

  for (const row of (visits.data ?? []) as (CountableVisit & {
    member: string;
  })[]) {
    const list = visitsByMember.get(row.member);
    if (list) list.push(row);
    else visitsByMember.set(row.member, [row]);

    if (row.status_set_to) {
      statusesSeen.add(row.status_set_to);
      const counts = statusesByMember.get(row.member) ?? {};
      counts[row.status_set_to] = (counts[row.status_set_to] ?? 0) + 1;
      statusesByMember.set(row.member, counts);
    }
  }

  const reps: RepRow[] = people.map((person) => {
    // The same two lines week-summary.ts uses, for the same reason: the visits
    // log fills seven metrics and the daily plan fills the eighth.
    const activities: MetricCounts = tallyVisitMetrics(
      visitsByMember.get(person.id) ?? [],
    );
    activities.meetings = meetings.get(person.id) ?? 0;

    return {
      id: person.id,
      name: person.name || "Unnamed rep",
      activities,
      statuses: statusesByMember.get(person.id) ?? {},
    };
  });

  return { ok: true, reps, statusesSeen, visitsByMember };
}

/** A filename a person can find again: what it is, who, and over what. */
export function exportFilename(
  range: ExportRange,
  repName: string | null,
): string {
  const who = repName
    ? repName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")
    : "all-reps";
  return `kubeats-activity-${who}-${range.start}-to-${range.end}.xlsx`;
}

/**
 * The report, as data: who the rows are and what the columns are.
 *
 * THE ONE DEFINITION BOTH RENDERERS USE. The web table and the .xlsx are two
 * renderings of this, not two reports that happen to agree — `buildActivityGrid`
 * turns it into rows and merges, and the table and the workbook each draw those
 * same rows. A column added here appears in both, in the same place, or in
 * neither; there is no path by which the screen and the download can disagree
 * about a number, because neither of them counts anything.
 */
/** The three figures the activity report's summary line prints. */
export interface ActivityReportCounts {
  /** Rows, which here really are all reps: `readRows` selects `role = 'rep'`. */
  reps: number;
  /** Closed + open columns. This report has no NO STATUS band to exclude. */
  statuses: number;
  /**
   * VISITS THAT RECORDED A STATUS — not visits.
   *
   * The distinction is load-bearing and the label has to carry it.
   * `enforce_status_required()` (FO024, migration 0027) is INSERT-only, so
   * every visit logged before it still legally carries a null
   * `status_set_to`. Those rows are counted in the six activity columns and
   * contribute nothing to the status bands, so the grand total of the status
   * half is strictly ≤ the number of visits in the range.
   *
   * Printing it as "visits" would make the status bands look like they had
   * lost rows. Naming it for what it is makes the arithmetic legible instead.
   */
  visitsWithStatus: number;
}

export interface ActivityReportModel {
  reps: RepRow[];
  columns: StatusColumns;
  range: ExportRange;
  /** The rep's name for a single-member report; null for all reps. */
  repName: string | null;
  counts: ActivityReportCounts;
  otherStatusColumn?: { status: string; label: string; retired: boolean };
}

export interface ActivityReportOptions {
  sort?: { key?: string; dir?: string };
  catalogue?: StatusCatalogue;
  /** Overview only: group null and retired-status visits into one column. */
  groupInactiveStatuses?: boolean;
}

export async function getActivityReportModel(
  range: ExportRange,
  memberId: string | null,
  options: ActivityReportOptions = {},
): Promise<{ ok: true; model: ActivityReportModel } | { ok: false; error: string }> {
  const [data, catalogue] = await Promise.all([
    readRows(range, memberId),
    options.catalogue ? Promise.resolve(options.catalogue) : listStatusCatalogue(),
  ]);

  if (!data.ok) return data;

  const allColumns = statusColumnsFor(catalogue, data.statusesSeen);

  /**
   * REFUSE RATHER THAN SHOW A REPORT THAT DOES NOT ADD UP.
   *
   * Every `visits.status_set_to` is a foreign key into `institute_statuses`
   * (0026), so a counted status with no column is impossible — unless
   * `listStatusCatalogue()` fell back to the seeded nine because its read
   * failed, in which case every status an admin has added would be missing and
   * those visits would vanish from the status bands while still being counted
   * in the activity bands. That is a report whose own rows contradict each
   * other, which is worse than no report — on screen exactly as in a download,
   * which is why this guard lives here rather than in the route.
   */
  const orphans = statusesWithoutColumns(allColumns, data.statusesSeen);
  if (orphans.length > 0) {
    logError(
      "export:status-columns",
      `statuses counted but absent from the catalogue: ${orphans.join(", ")}`,
    );
    return {
      ok: false,
      error:
        "We could not read the full status list, so this report would have been missing columns. Please try again in a moment.",
    };
  }

  const columns = options.groupInactiveStatuses
    ? {
        closed: allColumns.closed.filter((column) => !column.retired),
        open: allColumns.open.filter((column) => !column.retired),
      }
    : allColumns;
  const activeStatuses = new Set(
    catalogue.filter((row) => row.isActive).map((row) => row.status),
  );

  /*
   * THE 12 ACTIVITY × CATEGORY CELLS, derived from the visit rows already in
   * memory. `countActivityOpenClosed()` is the institute report's own
   * arithmetic, so "closed sessions" means the same thing on both screens.
   * It needs the catalogue, which is why it happens here rather than in
   * `readRows` — the three reads above stay parallel.
   */
  const withActivityStatuses: RepRow[] = data.reps.map((rep) => {
    const visits = rep.id ? (data.visitsByMember.get(rep.id) ?? []) : [];
    const other = options.groupInactiveStatuses
      ? visits.filter(
          (visit) =>
            !visit.status_set_to || !activeStatuses.has(visit.status_set_to),
        ).length
      : 0;
    return {
      ...rep,
      statuses: options.groupInactiveStatuses
        ? {
            ...Object.fromEntries(
              Object.entries(rep.statuses).filter(([status]) =>
                activeStatuses.has(status),
              ),
            ),
            [OTHER_INACTIVE_STATUS]: other,
          }
        : rep.statuses,
      activityStatuses: countActivityOpenClosed(
        visits,
        options.groupInactiveStatuses
          ? catalogue.filter((row) => row.isActive)
          : catalogue,
      ),
    };
  });

  const sort = options.sort
    ? parsePipelineSort(
        options.sort.key,
        options.sort.dir,
        activitySortKeys(columns),
      )
    : null;
  const reps = sort ? sortRepRows(withActivityStatuses, sort) : withActivityStatuses;

  return {
    ok: true,
    model: {
      reps,
      columns,
      range,
      repName: memberId ? (data.reps[0]?.name ?? null) : null,
      counts: {
        reps: reps.length,
        statuses: columns.closed.length + columns.open.length,
        // Summed from the same per-rep status tallies the grid will draw, so
        // the line and the grand total cannot disagree. A visit with a null
        // status contributed to neither.
        visitsWithStatus: reps.reduce(
          (sum, rep) =>
            sum + Object.values(rep.statuses).reduce((n, count) => n + count, 0),
          0,
        ),
      },
      otherStatusColumn: options.groupInactiveStatuses
        ? {
            status: OTHER_INACTIVE_STATUS,
            label: OTHER_INACTIVE_STATUS_LABEL,
            retired: false,
          }
        : undefined,
    },
  };
}

/**
 * The whole export: read, shape, write.
 *
 * `memberId` null is the all-reps export; a member id is the per-rep one. They
 * differ by a `.eq()` on three queries and nothing else — same counting, same
 * columns, same layout — so the two buttons cannot drift apart.
 */
export interface ActivityExportOptions {
  /**
   * Which of the report's two layouts the workbook carries.
   *
   * DEFAULT IS THE CLIENT'S TEMPLATE: six activity columns and every status
   * column, which is what `/team/report` has always downloaded. The Overview
   * shows the other view — Open/Closed per activity, status columns folded
   * away — and asks for `activity-status` so its file matches its table.
   * Neither layout reads the reader's picker; a preference is screen-only.
   */
  layout?: "status" | "activity-status";
}

export async function buildActivityExport(
  range: ExportRange,
  memberId: string | null,
  sort?: ActivityReportOptions["sort"],
  options: ActivityExportOptions = {},
): Promise<ExportResult> {
  const result = await getActivityReportModel(range, memberId, {
    sort,
    groupInactiveStatuses: options.layout === "activity-status",
  });
  if (!result.ok) return result;

  const { reps, columns, repName } = result.model;
  const input: GridInput =
    options.layout === "activity-status"
      ? {
          reps,
          // The 18 are hidden on that screen by default; the file matches it.
          columns: { closed: [], open: [] },
          unsetColumn: result.model.otherStatusColumn,
          showActivities: false,
          showActivityStatuses: true,
        }
      : { reps, columns };
  const sheet: SheetSpec = activitySheet(
    input,
    repName ? "Activity" : "All reps",
  );

  return {
    ok: true,
    filename: exportFilename(range, repName),
    bytes: buildWorkbook(sheet),
  };
}
