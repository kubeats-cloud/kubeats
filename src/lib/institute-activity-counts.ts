import {
  ACTIVITY_COLUMNS,
  activityCount,
} from "@/lib/exports/activity-grid";
import {
  isClosedStatus,
  isOpenStatus,
  type InstituteType,
  type StatusCatalogue,
} from "@/lib/validation/institute";
import {
  reconcileActivityCounts,
  tallyVisitMetrics,
  type ActivityType,
  type ReconcilableVisit,
} from "@/lib/validation/weekly";
import type { StatusCategory } from "@/lib/validation/institute";

/**
 * Pure institute-wise activity arithmetic.
 *
 * ONE COUNTED PATH with Weekly / Team / the Excel export: visits go through
 * `tallyVisitMetrics()` (and `reconcileActivityCounts()`), Meetings completed
 * stay on `daily_plans.meetings_actual`. Open/Closed is the catalogue category
 * of each visit's `status_set_to` — a second AXIS on the same rows, not a
 * second counter.
 *
 * Kept free of I/O so unit tests can assert the grid without a database.
 */

export type ActivityOpenClosed = {
  open: number;
  closed: number;
};

export type InstituteActivityCounts = {
  byActivity: Record<ActivityType, ActivityOpenClosed>;
  /** Visit rows that reconcile into the six activity buckets. */
  totalActivities: number;
  meetingsCompleted: number;
  followUpsOwned: number;
  followUpsPending: number;
  /**
   * `daily_plans` arrivals for this institute in range — a different count
   * from `totalActivities` on purpose. One checked-in arrival can carry no
   * logged visit yet (unreported, or swept as `checkout_missing`), and a
   * handful of pre-0033 visits carry no linked arrival at all, so the two
   * numbers are allowed to disagree rather than being forced to match.
   */
  totalVisits: number;
  /** The most recent arrival's record in range, or all nulls if there is none. */
  lastCheckinAt: string | null;
  /** Approximate area for that arrival, from the shared place cache. */
  lastCheckinArea: string | null;
  lastCheckoutAt: string | null;
  lastCheckoutArea: string | null;
};

/** One institute's latest arrival record, plus how many arrivals it had. */
export interface InstitutePresence {
  totalVisits: number;
  lastCheckinAt: string | null;
  lastCheckinArea: string | null;
  lastCheckoutAt: string | null;
  lastCheckoutArea: string | null;
}

const EMPTY_PRESENCE: InstitutePresence = {
  totalVisits: 0,
  lastCheckinAt: null,
  lastCheckinArea: null,
  lastCheckoutAt: null,
  lastCheckoutArea: null,
};

/** The Open+Closed total across all six activity types — R1's two columns. */
export function openClosedTotals(row: InstituteActivityCounts): ActivityOpenClosed {
  let open = 0;
  let closed = 0;
  for (const activity of Object.values(row.byActivity)) {
    open += activity.open;
    closed += activity.closed;
  }
  return { open, closed };
}

/** The footer row for a table that shows every institute at once (R7). */
export interface InstituteActivityTotals {
  open: number;
  closed: number;
  totalActivities: number;
  totalVisits: number;
  meetingsCompleted: number;
}

export function sumInstituteActivityRows(
  rows: readonly InstituteActivityCounts[],
): InstituteActivityTotals {
  const totals: InstituteActivityTotals = {
    open: 0,
    closed: 0,
    totalActivities: 0,
    totalVisits: 0,
    meetingsCompleted: 0,
  };
  for (const row of rows) {
    const oc = openClosedTotals(row);
    totals.open += oc.open;
    totals.closed += oc.closed;
    totals.totalActivities += row.totalActivities;
    totals.totalVisits += row.totalVisits;
    totals.meetingsCompleted += row.meetingsCompleted;
  }
  return totals;
}

export interface CountableVisit extends ReconcilableVisit {
  status_set_to: string | null;
}

export interface InstituteSeed {
  id: string;
  name: string;
  /**
   * R1's "institute details" columns, carried through only so the Rep
   * Institute tab's single table can show them — A1's admin grid still reads
   * only `id`/`name` off this same row and is unaffected by the extra fields.
   *
   * OPTIONAL HERE, defaulted in `buildInstituteActivityRows` below, so the
   * pure-function unit tests that seed only `{id, name}` do not have to carry
   * detail columns they never assert on. The real caller
   * (`institute-activity-report.ts`) always supplies every one of them.
   */
  type?: InstituteType;
  city?: string | null;
  area?: string | null;
  state?: string | null;
  status?: string | null;
}

export interface InstituteActivityRow extends InstituteActivityCounts {
  id: string;
  name: string;
  type: InstituteType;
  city: string | null;
  area: string | null;
  state: string | null;
  status: string | null;
}

const ZERO_OC = (): ActivityOpenClosed => ({ open: 0, closed: 0 });

function emptyByActivity(): Record<ActivityType, ActivityOpenClosed> {
  return {
    meeting: ZERO_OC(),
    session: ZERO_OC(),
    campus_visit: ZERO_OC(),
    olympiad: ZERO_OC(),
    application: ZERO_OC(),
    admission: ZERO_OC(),
  };
}

/**
 * Which of the six activity buckets a visit lands in, or null if it cannot
 * reconcile (unknown activity / session without lifecycle).
 *
 * Meetings use the visit row itself — same as `reconcileActivityCounts` —
 * not the plan figure.
 */
export function activityBucketFor(visit: ReconcilableVisit): ActivityType | null {
  if (visit.activity === "meeting") return "meeting";
  const tallied = tallyVisitMetrics([visit]);
  for (const column of ACTIVITY_COLUMNS) {
    // `from[0]` already names the COLUMN uniquely — "sessions_set" for
    // Sessions, "campus_visits_set" for Campus Visits — never the matched
    // lifecycle specifically, since `activityCount` sums the whole `from`
    // array (both Set and Done) to decide whether this row landed here at
    // all. Checking the alternate "_done" spelling too would be dead code:
    // `from[0]` can never equal it.
    if (column.from[0] === "meetings") continue;
    if (activityCount(tallied, column) !== 1) continue;
    const key = column.from[0];
    if (key === "sessions_set") return "session";
    if (key === "campus_visits_set") return "campus_visit";
    return key;
  }
  return null;
}

function categoryOf(
  catalogue: StatusCatalogue,
  status: string | null,
): StatusCategory | null {
  if (!status) return null;
  if (isOpenStatus(catalogue, status)) return "open";
  if (isClosedStatus(catalogue, status)) return "closed";
  return null;
}

/**
 * Build one row per institute seed. Institutes with no visits still appear
 * (zeros), so an empty pipeline is visible rather than absent.
 */
export function buildInstituteActivityRows(input: {
  institutes: readonly InstituteSeed[];
  visits: readonly CountableVisit[];
  /** institute_id → held plan meetings in range. */
  meetingsCompletedByInstitute: ReadonlyMap<string, number>;
  /** institute_id → open follow-up tasks. */
  followUpsOwnedByInstitute: ReadonlyMap<string, number>;
  /** institute_id → open tasks with due_date ≤ today. */
  followUpsPendingByInstitute: ReadonlyMap<string, number>;
  /** institute_id → arrival count and latest check-in/out record, in range. */
  presenceByInstitute: ReadonlyMap<string, InstitutePresence>;
  catalogue: StatusCatalogue;
}): {
  rows: InstituteActivityRow[];
  reconciliationFailures: ReturnType<typeof reconcileActivityCounts>;
} {
  const reconciliationFailures = reconcileActivityCounts(input.visits);
  const failed = new Set(reconciliationFailures.map((f) => f.instituteId));

  const visitsByInstitute = new Map<string, CountableVisit[]>();
  for (const visit of input.visits) {
    const list = visitsByInstitute.get(visit.institute_id);
    if (list) list.push(visit);
    else visitsByInstitute.set(visit.institute_id, [visit]);
  }

  const rows: InstituteActivityRow[] = input.institutes.map((institute) => {
    const byActivity = emptyByActivity();
    const visits = visitsByInstitute.get(institute.id) ?? [];
    // Drift: still emit the row, but do not invent Open/Closed splits that
    // would disagree with the reconciler. Totals stay the visit length so the
    // screen can show something went wrong rather than a quiet zero.
    if (!failed.has(institute.id)) {
      for (const visit of visits) {
        const bucket = activityBucketFor(visit);
        const category = categoryOf(input.catalogue, visit.status_set_to);
        if (!bucket || !category) continue;
        byActivity[bucket][category] += 1;
      }
    }

    const presence = input.presenceByInstitute.get(institute.id) ?? EMPTY_PRESENCE;

    return {
      id: institute.id,
      name: institute.name,
      type: institute.type ?? "school",
      city: institute.city ?? null,
      area: institute.area ?? null,
      state: institute.state ?? null,
      status: institute.status ?? null,
      byActivity,
      // Visit rows in the six buckets (reconcile's total). Open + Closed may
      // be smaller when a legacy visit has no status_set_to.
      totalActivities: visits.length,
      meetingsCompleted: input.meetingsCompletedByInstitute.get(institute.id) ?? 0,
      followUpsOwned: input.followUpsOwnedByInstitute.get(institute.id) ?? 0,
      followUpsPending: input.followUpsPendingByInstitute.get(institute.id) ?? 0,
      totalVisits: presence.totalVisits,
      lastCheckinAt: presence.lastCheckinAt,
      lastCheckinArea: presence.lastCheckinArea,
      lastCheckoutAt: presence.lastCheckoutAt,
      lastCheckoutArea: presence.lastCheckoutArea,
    };
  });

  return { rows, reconciliationFailures };
}

/** Sort keys the institute activity table / Excel share. */
export const INSTITUTE_ACTIVITY_SORT_KEYS = [
  "institute",
  "meeting_open",
  "meeting_closed",
  "session_open",
  "session_closed",
  "campus_visit_open",
  "campus_visit_closed",
  "olympiad_open",
  "olympiad_closed",
  "application_open",
  "application_closed",
  "admission_open",
  "admission_closed",
  "total",
  "follow_ups_owned",
  "follow_ups_pending",
  "meetings_completed",
  // R1/R7's own aggregate columns — a sum across the six types, rather than
  // one more per-type pair. Added alongside the admin's twelve rather than
  // replacing them, since A1 keeps its per-type grid unchanged.
  "open_total",
  "closed_total",
  "total_visits",
] as const;

export type InstituteActivitySortKey =
  (typeof INSTITUTE_ACTIVITY_SORT_KEYS)[number];

export function isInstituteActivitySortKey(
  value: string | undefined,
): value is InstituteActivitySortKey {
  return (
    !!value &&
    (INSTITUTE_ACTIVITY_SORT_KEYS as readonly string[]).includes(value)
  );
}

export function sortValueFor(
  row: InstituteActivityRow,
  key: InstituteActivitySortKey,
): string | number {
  switch (key) {
    case "institute":
      return row.name.toLocaleLowerCase("en");
    case "meeting_open":
      return row.byActivity.meeting.open;
    case "meeting_closed":
      return row.byActivity.meeting.closed;
    case "session_open":
      return row.byActivity.session.open;
    case "session_closed":
      return row.byActivity.session.closed;
    case "campus_visit_open":
      return row.byActivity.campus_visit.open;
    case "campus_visit_closed":
      return row.byActivity.campus_visit.closed;
    case "olympiad_open":
      return row.byActivity.olympiad.open;
    case "olympiad_closed":
      return row.byActivity.olympiad.closed;
    case "application_open":
      return row.byActivity.application.open;
    case "application_closed":
      return row.byActivity.application.closed;
    case "admission_open":
      return row.byActivity.admission.open;
    case "admission_closed":
      return row.byActivity.admission.closed;
    case "total":
      return row.totalActivities;
    case "follow_ups_owned":
      return row.followUpsOwned;
    case "follow_ups_pending":
      return row.followUpsPending;
    case "meetings_completed":
      return row.meetingsCompleted;
    case "open_total":
      return openClosedTotals(row).open;
    case "closed_total":
      return openClosedTotals(row).closed;
    case "total_visits":
      return row.totalVisits;
  }
}

export function sortInstituteActivityRows(
  rows: readonly InstituteActivityRow[],
  key: InstituteActivitySortKey,
  dir: "asc" | "desc",
): InstituteActivityRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortValueFor(a, key);
    const bv = sortValueFor(b, key);
    if (typeof av === "string" && typeof bv === "string") {
      return av < bv ? -sign : av > bv ? sign : a.name.localeCompare(b.name);
    }
    const an = Number(av);
    const bn = Number(bv);
    if (an !== bn) return (an - bn) * sign;
    return a.name.localeCompare(b.name);
  });
}
