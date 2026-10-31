"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import {
  DAILY_STATUSES,
  type DailyStatus,
} from "@/lib/validation/rep-daily-status";

const setMyDailyStatusSchema = z.object({
  status: z.enum(DAILY_STATUSES),
});

export interface SetDailyStatusResult {
  error: string | null;
  /** What the database now holds — only present when the write succeeded. */
  status?: DailyStatus;
}

/**
 * The rep's own toggle. One status, applied to TODAY, stamped by the database.
 *
 * NO REP ID AND NO DATE IN THE ARGUMENTS. The RPC takes only the status and
 * derives both from `auth.uid()` and `public.app_today()`; a caller cannot
 * name someone else or a past day even by hand-crafting the request. 0069's
 * RLS enforces the same rule underneath, so this signature is a convenience
 * rather than the boundary.
 *
 * The returned status is the one the caller asked for, not the one the
 * database echoed. That is deliberate: `set_my_daily_status` is invoker-rights
 * and can only ever write the caller's own row, so the echo can only differ if
 * something is wrong, and the screen should re-read rather than claim a value.
 */
export async function setMyDailyStatus(
  status: string,
): Promise<SetDailyStatusResult> {
  const parsed = setMyDailyStatusSchema.safeParse({ status });
  if (!parsed.success) {
    return { error: "Choose In-Field, In-Office or On-Leave." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_daily_status", {
    p_status: parsed.data.status,
  });

  if (error) {
    if (error.code === "42501") {
      return { error: "Only a rep can set their own daily status." };
    }
    if (error.code === "22023") {
      return { error: "Choose In-Field, In-Office or On-Leave." };
    }
    logError("rep-daily-status:set", error);
    return { error: "We could not save your status just now. Please try again." };
  }

  // The rep's own report and the staff report both show this row; a cached
  // render of either must not keep saying "not recorded" after the toggle.
  revalidatePath("/report");
  revalidatePath("/team/report");

  return { error: null, status: parsed.data.status };
}
