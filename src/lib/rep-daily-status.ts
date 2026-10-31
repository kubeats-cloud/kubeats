import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { todayISO } from "@/lib/dates";
import {
  isDailyStatus,
  shapeDailyStatusReport,
  type DailyStatus,
  type DailyStatusReport,
} from "@/lib/validation/rep-daily-status";

/**
 * The two reads migration 0069's screens need: today's own row, and the
 * per-rep report.
 *
 * BOTH RUN THROUGH THE SIGNED-IN USER'S OWN CLIENT. There is no service-role
 * path here, so RLS decides who may read what exactly as it does for every
 * other screen: an admin gets every rep, a team lead their team, a rep only
 * themselves. The RPCs are SECURITY INVOKER for the same reason.
 */

export interface TodayDailyStatus {
  status: DailyStatus;
  statusDate: string;
  setAt: string;
}

/**
 * The caller's own status for today, or null when they have not set one.
 *
 * NULL MEANS "NOT RECORDED", NOT AN ERROR. A rep who has not touched the
 * toggle today has no row by design, and the toggle has to render that state
 * rather than an error box. Only a failed query is an error.
 *
 * `status_date` is compared against `todayISO()`, which reads the Asia/Kolkata
 * calendar day — the same definition `public.app_today()` uses (see the note
 * on todayISO in dates.ts). The RPC that writes the row defaults the date the
 * same way, so the two cannot disagree about which day they are talking about.
 */
export async function getMyTodayStatus(repId: string): Promise<
  { ok: true; today: TodayDailyStatus | null } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rep_daily_status")
    .select("status, status_date, set_at")
    .eq("rep_id", repId)
    .eq("status_date", todayISO())
    .maybeSingle();

  if (error) {
    logError("rep-daily-status:today", error);
    return { ok: false, error: "We could not load today's status just now." };
  }

  if (!data) return { ok: true, today: null };

  // Checked rather than cast: the column is CHECK-constrained, so this only
  // catches a database the migration has not reached — in which case showing
  // "not recorded" is truer than showing an unknown value as the selection.
  if (!isDailyStatus(data.status)) return { ok: true, today: null };

  return {
    ok: true,
    today: {
      status: data.status,
      statusDate: data.status_date,
      setAt: data.set_at,
    },
  };
}

export interface DailyStatusReportFilters {
  /** YYYY-MM-DD, already validated by exportRangeSchema on the staff page. */
  start: string;
  end: string;
  /** Narrows to one rep; can never widen the caller's own RLS scope. */
  member?: string;
  /** 1-based. Below 1 means "every rep", which the export-shaped answer uses. */
  page?: number;
}

export async function getDailyStatusReport(
  filters: DailyStatusReportFilters,
): Promise<{ ok: true; report: DailyStatusReport } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rep_daily_status_report", {
    p_start: filters.start,
    p_to: filters.end,
    p_member: filters.member ?? null,
    p_page: filters.page ?? 1,
  });

  if (error) {
    // 42501 is the explicit sign-in check 0069 raises; 22023 is an inverted
    // range, which the staff page's schema should already have refused. Both
    // are answered in words a reader can act on rather than by a code.
    if (error.code === "42501") {
      return { ok: false, error: "Sign in to read daily status." };
    }
    if (error.code === "22023") {
      return {
        ok: false,
        error: "The To date must not be before the From date.",
      };
    }
    logError("rep-daily-status:report", error);
    return { ok: false, error: "We could not load daily status just now." };
  }

  const report = shapeDailyStatusReport(data);
  if (!report) {
    logError("rep-daily-status:report-shape", data);
    return { ok: false, error: "We could not read the daily status report just now." };
  }

  return { ok: true, report };
}
