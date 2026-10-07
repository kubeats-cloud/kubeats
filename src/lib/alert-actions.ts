"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

/**
 * Dismissing an alert — the only write a person may make to `alert_events`.
 *
 * ⚠ THE NARROWNESS IS THE POINT. 0040 grants `authenticated` exactly
 * `select` on the table and `update (seen_at)` on one column. Not insert, not
 * delete, not an update of `kind`, `for_date` or `payload`. That is a COLUMN
 * privilege, checked by Postgres before any policy runs, so it holds against a
 * hand-rolled PostgREST call and not only against this function.
 *
 * It has to hold, because `kind = 'follow_ups_missed'` rows ARE the missed
 * record: an insert grant would let somebody manufacture a miss against a
 * colleague, a delete grant would let a rep erase their own, and a `payload`
 * update would let them edit the number. All three are refused by the grant,
 * which is why this module has one function and no others.
 *
 * MARKING IT SEEN IS NOT DOING THE WORK. Dismissing "3 follow-ups were missed"
 * removes the banner, not the follow-ups — those stay on `follow_up_tasks`
 * until they are closed, and the record keeps the day. This is deliberate and
 * is why the control says "Dismiss" rather than "Done": a rep who could clear
 * their record by tapping a banner would have a record worth nothing.
 */
export async function markAlertSeen(alertId: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();

  // No `member` filter and none needed: `alert_events_update` is
  // `member = auth.uid() or is_admin()`, so a rep's attempt at a colleague's
  // row matches no rows rather than being refused — which is the same outcome
  // and one fewer place for the boundary to be restated and drift.
  //
  // `new Date()` is correct HERE and is not the thing dates.ts forbids. The
  // rule is about a CALENDAR DAY — `todayISO()` / `app_today()`, because a day
  // derived from the runtime's clock disagrees across midnight IST. This is an
  // INSTANT on a timestamptz column, which has no timezone to get wrong;
  // `checkin_at` in checkin-actions.ts is stamped exactly this way. The one day
  // this row carries, `for_date`, is written by app_today() in the database and
  // is never touched here.
  const { error } = await supabase
    .from("alert_events")
    .update({ seen_at: new Date().toISOString() })
    .eq("id", alertId)
    .is("seen_at", null);

  if (error) {
    logError("alerts:seen", error);
    return { ok: false };
  }

  revalidatePath("/");
  return { ok: true };
}
