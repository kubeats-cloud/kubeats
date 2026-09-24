import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { todayISO } from "@/lib/dates";
import type { Institute } from "@/lib/institutes";
import type { StatusCatalogue, StatusRow } from "@/lib/validation/institute";

/**
 * The two small things the member hub owns outright.
 *
 * Everything else on /team/[memberId] is composed from helpers that already
 * existed — the week summary, the activity report, the visit register, the
 * registry, the follow-ups. These two had nowhere to come from, so they live
 * here rather than inline in the page: a Server Component that reads tables
 * directly is how the next screen ends up with its own slightly different
 * definition of "today".
 *
 * BOTH ARE PROVISIONAL BY DESIGN. Reports (a) "institute visits today" and
 * (b) "per-institute status" are planned as team-wide screens and will want
 * exactly these two calculations, one row per rep instead of one rep. When
 * they land, these are what gets generalised — the shapes are deliberately
 * per-member rather than per-team so that widening them is a change of
 * denominator and not a rewrite.
 */

/* ------------------------------------------------------------------ */
/* Today                                                               */
/* ------------------------------------------------------------------ */

export interface MemberToday {
  /** Rows on this rep's daily plan for today, held or not. */
  planned: number;
  /** Visits they have actually logged today. */
  visited: number;
  /**
   * DISTINCT institutes among those visits, which is NOT `visited`.
   *
   * Migration 0033 dropped `daily_plans_unique_per_day`, so a morning meeting
   * and an afternoon session at one school are two plan rows, two check-ins
   * and two visits. "Institute visits today" is therefore genuinely two
   * numbers, and showing only the row count would quietly overstate reach on
   * exactly the days a rep worked one school hard.
   */
  institutes: number;
}

const NO_ACTIVITY: MemberToday = { planned: 0, visited: 0, institutes: 0 };

/**
 * What this rep has planned and done today.
 *
 * KEYED ON `todayISO()`, NEVER A FRESH `new Date()`. The app and the database
 * share one definition of the day — `todayISO()` here, `public.app_today()`
 * there (migration 0008) — both reading the Asia/Kolkata calendar day so it
 * turns over at midnight in India rather than at 05:30. A second definition
 * introduced here would disagree with the one `log_visit()` uses to find the
 * plan row, and the symptom is a rep standing in front of a school being told
 * it is not on today's plan.
 *
 * Three counts, two queries, and the third count is derived rather than asked
 * for: PostgREST has no `count(distinct …)`, and the institute ids are already
 * in hand from the visits query.
 *
 * A failure degrades to zeroes and logs. This is one card on a page of many;
 * it must not be able to take the rest of the hub down with it.
 */
export async function getMemberToday(memberId: string): Promise<MemberToday> {
  const supabase = await createClient();
  const today = todayISO();

  const [plans, visits] = await Promise.all([
    supabase
      .from("daily_plans")
      .select("id", { count: "exact", head: true })
      .eq("member", memberId)
      .eq("date", today),
    supabase
      .from("visits")
      .select("institute_id")
      .eq("member", memberId)
      .eq("date", today),
  ]);

  if (plans.error || visits.error) {
    logError("team-hub:today", plans.error ?? visits.error);
    return NO_ACTIVITY;
  }

  const rows = visits.data ?? [];
  return {
    planned: plans.count ?? 0,
    visited: rows.length,
    institutes: new Set(rows.map((row) => row.institute_id)).size,
  };
}

/* ------------------------------------------------------------------ */
/* The status pipeline                                                 */
/* ------------------------------------------------------------------ */

export interface PipelineRow {
  /** Null is the "no status yet" bucket, which is neither open nor closed. */
  status: string | null;
  label: string;
  category: StatusRow["category"] | null;
  tone: StatusRow["tone"] | null;
  count: number;
  /** Marked in the label once an admin has retired it. */
  retired: boolean;
}

export interface Pipeline {
  rows: PipelineRow[];
  total: number;
  open: number;
  closed: number;
  /** Registered, never visited — or visited under "No change" before 0027. */
  unset: number;
}

/** How a retired status is marked, the same suffix the export uses. */
export const RETIRED_LABEL = " (retired)";

/** What "no status yet" is called on screen. */
export const NO_STATUS_LABEL = "No status yet";

/**
 * Where this rep's institutes stand, right now.
 *
 * PURE, AND DERIVED FROM ROWS THE PAGE ALREADY HAS. The hub loads the registry
 * to list their institutes; this counts the same array rather than asking the
 * database a second, differently-shaped question. That is what guarantees the
 * pipeline totals match the list printed underneath it — two queries could
 * disagree across a write, and an admin who counts the list by hand and gets a
 * different number stops trusting both.
 *
 * ORDERED BY THE CATALOGUE, not by count. An admin reads this to see a shape —
 * how much is early, how much is closed — and a bar chart that reorders itself
 * every week cannot be read that way. `sort_order` is the order the vocabulary
 * is maintained in, so it is the order it is reported in.
 *
 * NULL IS ITS OWN BUCKET AND IS NOT ZERO. "No status yet" means registered and
 * not yet reached; folding it into closed would say the opposite, and dropping
 * it would lose the institutes most worth chasing. It sorts last, after the
 * vocabulary, because it is not part of it.
 *
 * A STATUS WITH NO INSTITUTES GETS NO ROW. The vocabulary is admin-managed and
 * can be long; printing every zero would bury the handful of rows that carry
 * this rep's actual pipeline. The totals are computed from the institutes, so
 * nothing is lost by not printing it.
 */
export function pipelineOf(
  institutes: readonly Institute[],
  catalogue: StatusCatalogue,
): Pipeline {
  const counts = new Map<string, number>();
  let unset = 0;

  for (const institute of institutes) {
    if (!institute.status) {
      unset += 1;
      continue;
    }
    counts.set(institute.status, (counts.get(institute.status) ?? 0) + 1);
  }

  const rows: PipelineRow[] = [];
  let open = 0;
  let closed = 0;

  for (const entry of catalogue) {
    const count = counts.get(entry.status);
    if (!count) continue;

    if (entry.category === "open") open += count;
    else closed += count;

    rows.push({
      status: entry.status,
      label: entry.isActive ? entry.status : entry.status + RETIRED_LABEL,
      category: entry.category,
      tone: entry.tone,
      count,
      retired: !entry.isActive,
    });
    counts.delete(entry.status);
  }

  /*
   * A status on an institute that the catalogue did not describe.
   *
   * Impossible by construction — `institutes.status` is a foreign key into
   * `institute_statuses` since 0026 — UNLESS `listStatusCatalogue()` fell back
   * to the seeded nine because its read failed, in which case every status an
   * admin has added since would land here. Printed rather than dropped: a
   * pipeline whose rows do not add up to its own total is worse than one with
   * an unfamiliar label in it, and this is the only way the reader finds out.
   */
  for (const [status, count] of counts) {
    rows.push({
      status,
      label: status,
      category: null,
      tone: null,
      count,
      retired: false,
    });
  }

  if (unset > 0) {
    rows.push({
      status: null,
      label: NO_STATUS_LABEL,
      category: null,
      tone: null,
      count: unset,
      retired: false,
    });
  }

  return { rows, total: institutes.length, open, closed, unset };
}
