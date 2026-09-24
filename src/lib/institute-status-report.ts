import "server-only";
import {
  statusColumnsFor,
  type RepRow,
  type StatusColumn,
  type StatusColumns,
} from "@/lib/exports/activity-grid";
import { ZERO_COUNTS } from "@/lib/validation/weekly";
import { listInstitutes } from "@/lib/institutes";
import { listStatusCatalogue } from "@/lib/statuses";
import { listReps } from "@/lib/closing-report";

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

export interface InstituteStatusModel {
  reps: RepRow[];
  columns: StatusColumns;
  /** Always present: `status IS NULL` is a real state, even when nothing is in it. */
  unsetColumn: StatusColumn;
  /** Every institute the caller can see. The figure the rows must add up to. */
  total: number;
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
export async function getInstituteStatusModel(): Promise<
  { ok: true; model: InstituteStatusModel } | { ok: false; error: string }
> {
  const [registry, catalogue, reps] = await Promise.all([
    listInstitutes(),
    listStatusCatalogue(),
    listReps(),
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

  const rows: RepRow[] = reps.map((rep) => row(rep.id, rep.name));

  // Any owner the rep list did not cover — see the note above.
  const known = new Set(reps.map((rep) => rep.id));
  for (const owner of byOwner.keys()) {
    if (owner === UNASSIGNED_KEY || known.has(owner)) continue;
    rows.push(row(owner, namesSeen.get(owner) ?? "Not a rep"));
  }

  /*
   * UNASSIGNED IS LAST, AND ONLY WHEN THERE IS ONE.
   *
   * `registered_by` is `on delete set null`, so removing a departed rep
   * orphans their whole pipeline at once — invisible to every rep, and
   * otherwise findable only by scrolling the registry for red badges. It sits
   * after the people because it is not one.
   */
  if (byOwner.has(UNASSIGNED_KEY)) {
    rows.push(row(UNASSIGNED_KEY, UNASSIGNED_LABEL));
  }

  return {
    ok: true,
    model: {
      reps: rows,
      columns,
      unsetColumn: {
        status: NO_STATUS_KEY,
        label: NO_STATUS_LABEL,
        retired: false,
      },
      total: institutes.length,
    },
  };
}

/**
 * Where a cell goes when it is clicked: that owner's institutes at that status.
 *
 * The parameters are the ones `/institutes` already understands, and the two
 * sentinels are the ones it already uses — so this is a link into a screen that
 * was built to answer it, not a new view. This is the client's "click 3
 * scheduled and open those three institutes", end to end.
 */
export function cohortHref(ownerId: string, status: string): string {
  const params = new URLSearchParams();
  params.set("owner", ownerId);
  params.set("status", status);
  return `/institutes?${params.toString()}`;
}
