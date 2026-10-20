import "server-only";

import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/dates";
import { logError } from "@/lib/errors";
import { instituteNameOr } from "@/lib/institute-scope";
import { listInstitutes } from "@/lib/institutes";
import { listStatusCatalogue } from "@/lib/statuses";
import { areasFor } from "@/lib/place-cache";
import { cellFor } from "@/lib/places";
import {
  buildInstituteActivityRows,
  isInstituteActivitySortKey,
  sortInstituteActivityRows,
  type CountableVisit,
  type InstituteActivityRow,
  type InstituteActivitySortKey,
  type InstitutePresence,
} from "@/lib/institute-activity-counts";
import {
  pipelineRangeSchema,
  rangeIsActive,
  type PipelineRange,
  type SortDirection,
} from "@/lib/validation/pipeline-report";

/**
 * Institute-wise Activity Report model (A1 / shared with R1·R7 later).
 *
 * SERVER-SIDE ONLY, TypeScript rather than a SQL view — same stance as
 * `activity-export.ts`: Rule 7 lives in `tallyVisitMetrics` /
 * `reconcileActivityCounts`, and a second copy in Postgres would drift.
 * Every read goes through the signed-in client's RLS (admin / team lead /
 * rep), so this function never applies its own team filter.
 */

export interface InstituteActivitySort {
  key: InstituteActivitySortKey;
  dir: SortDirection;
}

export const DEFAULT_INSTITUTE_ACTIVITY_SORT: InstituteActivitySort = {
  key: "institute",
  dir: "asc",
};

export interface InstituteActivityModel {
  rows: InstituteActivityRow[];
  range: PipelineRange;
  rangeActive: boolean;
  sort: InstituteActivitySort;
  /** Institutes visible under RLS, before any "has activity" trim. */
  totalInstitutes: number;
  reconciliationFailed: boolean;
}

export interface InstituteActivityQuery {
  range?: PipelineRange;
  sort?: { key?: string; dir?: string };
}

function parseSort(raw: { key?: string; dir?: string } | undefined): InstituteActivitySort {
  const key = isInstituteActivitySortKey(raw?.key)
    ? raw!.key
    : DEFAULT_INSTITUTE_ACTIVITY_SORT.key;
  const dir =
    raw?.dir === "asc" || raw?.dir === "desc"
      ? raw.dir
      : DEFAULT_INSTITUTE_ACTIVITY_SORT.dir;
  return { key, dir };
}

export async function getInstituteActivityModel(
  query: InstituteActivityQuery = {},
): Promise<
  { ok: true; model: InstituteActivityModel } | { ok: false; error: string }
> {
  const range: PipelineRange = query.range ?? {};
  const rangeActive = rangeIsActive(range);
  const sort = parseSort(query.sort);
  const supabase = await createClient();
  const today = todayISO();

  const [registry, catalogue] = await Promise.all([
    listInstitutes(),
    listStatusCatalogue(),
  ]);

  if (!registry.ok) {
    return {
      ok: false,
      error: "We could not read the registry just now. Please try again in a moment.",
    };
  }

  let visitsQuery = supabase
    .from("visits")
    .select("id, institute_id, activity, lifecycle_status, status_set_to, date");
  if (range.from) visitsQuery = visitsQuery.gte("date", range.from);
  if (range.to) visitsQuery = visitsQuery.lte("date", range.to);

  /*
   * ONE FETCH, THREE DERIVATIONS — meetings completed, the arrival count, and
   * the latest check-in/out record (R1/R7's presence columns) all come from
   * these same rows, rather than a narrow `meetings_actual = 1` query plus a
   * second, separate presence query. Same stance as the visits side: one
   * counted read of `daily_plans`, several facts folded out of it.
   *
   * Ordered so the FIRST row seen per institute is its latest arrival: by day,
   * then — since an institute may hold more than one visit a day (0033) — by
   * check-in time, with a never-checked-in row sorted last.
   */
  let plansQuery = supabase
    .from("daily_plans")
    .select(
      "institute_id, date, meetings_actual, checkin_at, checkin_lat, checkin_lng, checkout_at, checkout_lat, checkout_lng",
    )
    .order("date", { ascending: false })
    .order("checkin_at", { ascending: false, nullsFirst: false });
  if (range.from) plansQuery = plansQuery.gte("date", range.from);
  if (range.to) plansQuery = plansQuery.lte("date", range.to);

  // Follow-up tasks are live state, not period activity — always current.
  const tasksQuery = supabase
    .from("follow_up_tasks")
    .select("institute_id, due_date")
    .is("done_at", null);

  const [visitsResult, plansResult, tasksResult] = await Promise.all([
    visitsQuery,
    plansQuery,
    tasksQuery,
  ]);

  if (visitsResult.error) {
    logError("institute-activity:visits", visitsResult.error);
    return {
      ok: false,
      error: "We could not read visits just now. Please try again in a moment.",
    };
  }
  if (plansResult.error) {
    logError("institute-activity:plans", plansResult.error);
    return {
      ok: false,
      error: "We could not read meetings just now. Please try again in a moment.",
    };
  }
  if (tasksResult.error) {
    logError("institute-activity:tasks", tasksResult.error);
    return {
      ok: false,
      error: "We could not read follow-ups just now. Please try again in a moment.",
    };
  }

  const visits = (visitsResult.data ?? []) as CountableVisit[];

  interface PlanRow {
    institute_id: string | null;
    date: string;
    meetings_actual: number | null;
    checkin_at: string | null;
    checkin_lat: number | null;
    checkin_lng: number | null;
    checkout_at: string | null;
    checkout_lat: number | null;
    checkout_lng: number | null;
  }
  const plans = (plansResult.data ?? []) as PlanRow[];

  const meetingsCompletedByInstitute = new Map<string, number>();
  const totalVisitsByInstitute = new Map<string, number>();
  const latestByInstitute = new Map<string, PlanRow>();
  for (const plan of plans) {
    if (!plan.institute_id) continue;
    if (plan.meetings_actual === 1) {
      meetingsCompletedByInstitute.set(
        plan.institute_id,
        (meetingsCompletedByInstitute.get(plan.institute_id) ?? 0) + 1,
      );
    }
    totalVisitsByInstitute.set(
      plan.institute_id,
      (totalVisitsByInstitute.get(plan.institute_id) ?? 0) + 1,
    );
    // Rows arrive ordered latest-first, so the first one kept per institute
    // is its most recent arrival.
    if (!latestByInstitute.has(plan.institute_id)) {
      latestByInstitute.set(plan.institute_id, plan);
    }
  }

  // One cache read for every institute's latest arrival, not one per row —
  // read-only, same as the per-rep activity report's own area lookup.
  const areas = await areasFor(
    [...latestByInstitute.values()].flatMap((plan) => [
      { latitude: plan.checkin_lat, longitude: plan.checkin_lng },
      { latitude: plan.checkout_lat, longitude: plan.checkout_lng },
    ]),
  );
  const areaAt = (lat: number | null, lng: number | null) =>
    lat === null || lng === null ? null : (areas.get(cellFor(lat, lng)) ?? null);

  const presenceByInstitute = new Map<string, InstitutePresence>();
  for (const [instituteId, plan] of latestByInstitute) {
    presenceByInstitute.set(instituteId, {
      totalVisits: totalVisitsByInstitute.get(instituteId) ?? 0,
      lastCheckinAt: plan.checkin_at,
      lastCheckinArea: areaAt(plan.checkin_lat, plan.checkin_lng),
      lastCheckoutAt: plan.checkout_at,
      lastCheckoutArea: areaAt(plan.checkout_lat, plan.checkout_lng),
    });
  }

  const owned = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const task of tasksResult.data ?? []) {
    const id = task.institute_id as string | null;
    if (!id) continue;
    owned.set(id, (owned.get(id) ?? 0) + 1);
    if (typeof task.due_date === "string" && task.due_date <= today) {
      pending.set(id, (pending.get(id) ?? 0) + 1);
    }
  }

  const institutes = registry.institutes.map((row) => ({
    id: row.id,
    name: instituteNameOr(row.name, "institute-activity"),
  }));

  const { rows, reconciliationFailures } = buildInstituteActivityRows({
    institutes,
    visits,
    meetingsCompletedByInstitute,
    followUpsOwnedByInstitute: owned,
    followUpsPendingByInstitute: pending,
    presenceByInstitute,
    catalogue,
  });

  if (reconciliationFailures.length > 0) {
    logError(
      "institute-activity:reconcile",
      `Per-institute activity counts did not reconcile (${reconciliationFailures.length} institute(s))`,
    );
  }

  return {
    ok: true,
    model: {
      rows: sortInstituteActivityRows(rows, sort.key, sort.dir),
      range,
      rangeActive,
      sort,
      totalInstitutes: institutes.length,
      reconciliationFailed: reconciliationFailures.length > 0,
    },
  };
}

/** Re-export the range schema this screen shares with the old pipeline URL. */
export { pipelineRangeSchema, rangeIsActive };
