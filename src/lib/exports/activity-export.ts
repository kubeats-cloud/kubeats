import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { listStatusCatalogue } from "@/lib/statuses";
import {
  tallyVisitMetrics,
  type MetricCounts,
  type TallyableVisit,
} from "@/lib/validation/weekly";
import {
  activitySheet,
  statusColumnsFor,
  statusesWithoutColumns,
  type RepRow,
} from "@/lib/exports/activity-grid";
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
  | { ok: true; reps: RepRow[]; statusesSeen: Set<string> }
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
    .select("member, activity, lifecycle_status, status_set_to")
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

  const visitsByMember = new Map<string, TallyableVisit[]>();
  const statusesByMember = new Map<string, Record<string, number>>();
  const statusesSeen = new Set<string>();

  for (const row of (visits.data ?? []) as (TallyableVisit & {
    member: string;
    status_set_to: string | null;
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
      name: person.name || "Unnamed rep",
      activities,
      statuses: statusesByMember.get(person.id) ?? {},
    };
  });

  return { ok: true, reps, statusesSeen };
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
 * The whole export: read, shape, write.
 *
 * `memberId` null is the all-reps export; a member id is the per-rep one. They
 * differ by a `.eq()` on three queries and nothing else — same counting, same
 * columns, same layout — so the two buttons cannot drift apart.
 */
export async function buildActivityExport(
  range: ExportRange,
  memberId: string | null,
): Promise<ExportResult> {
  const [data, catalogue] = await Promise.all([
    readRows(range, memberId),
    listStatusCatalogue(),
  ]);

  if (!data.ok) return data;

  const columns = statusColumnsFor(catalogue, data.statusesSeen);

  /**
   * REFUSE RATHER THAN EXPORT A SHEET THAT DOES NOT ADD UP.
   *
   * Every `visits.status_set_to` is a foreign key into `institute_statuses`
   * (0026), so a counted status with no column is impossible — unless
   * `listStatusCatalogue()` fell back to the seeded nine because its read
   * failed, in which case every status an admin has added would be missing and
   * those visits would vanish from the status bands while still being counted
   * in the activity bands. That is a report whose own rows contradict each
   * other, which is worse than no report.
   */
  const orphans = statusesWithoutColumns(columns, data.statusesSeen);
  if (orphans.length > 0) {
    logError(
      "export:status-columns",
      `statuses counted but absent from the catalogue: ${orphans.join(", ")}`,
    );
    return {
      ok: false,
      error:
        "We could not read the full status list, so the export would have been missing columns. Please try again in a moment.",
    };
  }

  const repName = memberId ? (data.reps[0]?.name ?? null) : null;
  const sheet: SheetSpec = activitySheet(
    { reps: data.reps, columns },
    repName ? "Activity" : "All reps",
  );

  return {
    ok: true,
    filename: exportFilename(range, repName),
    bytes: buildWorkbook(sheet),
  };
}
