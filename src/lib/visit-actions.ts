"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError, toFriendlyMessage } from "@/lib/errors";
import { todayISO } from "@/lib/visits";
import type { FormState } from "@/lib/visit-form-state";
import {
  completionFormDataToInput,
  completionSchema,
  dailyPlanFormDataToInput,
  dailyPlanSchema,
  planIdSchema,
  visitFieldErrors,
  visitFormDataToInput,
  visitSchema,
} from "@/lib/validation/visit";

const CHECK_VIOLATION = "23514";

/**
 * The SQLSTATEs log_visit() raises for the cases a rep can actually cause.
 * Mapping on the code rather than the message means the wording lives here, in
 * one place, and no database text ever reaches the browser.
 */
const RPC_MESSAGES: Record<string, string> = {
  FO001: "That institute is not on today's plan. Add it on the Dashboard, then log the meeting.",
  FO002: "That meeting is already marked as held.",
  FO003: "That photo could not be attached.",
  FO004: "Your session has expired. Please sign in again.",
  FO005: "That entry is no longer on today's plan. Add it again on the Dashboard.",
  FO006: "That institute no longer exists.",
};

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/* ------------------------------------------------------------------ */
/* A. Daily plan                                                       */
/* ------------------------------------------------------------------ */

/**
 * Adds an institute to today's plan.
 *
 * Upsert rather than insert: daily_plans has UNIQUE(member, date,
 * institute_id), and planning the same institute twice in a day is a correction
 * of the purpose, not an error to shove in a rep's face. meetings_actual is
 * left out of the payload deliberately, so re-planning an institute that has
 * already been visited does not un-hold it.
 */
export async function addToDailyPlan(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const parsed = dailyPlanSchema.safeParse(dailyPlanFormDataToInput(formData));
  if (!parsed.success) {
    return {
      error: "Please check the highlighted fields.",
      fieldErrors: visitFieldErrors(parsed.error),
    };
  }

  const { error } = await supabase.from("daily_plans").upsert(
    {
      member: user.id,
      date: todayISO(),
      institute_id: parsed.data.institute_id,
      purpose: parsed.data.purpose,
    },
    { onConflict: "member,date,institute_id" },
  );

  if (error) {
    logError("plan:add", error);
    return {
      error: toFriendlyMessage(error, "We could not add that to today's plan."),
      fieldErrors: {},
    };
  }

  revalidatePath("/");
  revalidatePath("/log");
  return { error: null, fieldErrors: {}, ok: true };
}

export async function removeFromDailyPlan(planId: string): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  // An id is input like any other. RLS already scopes the delete to the
  // caller's own rows, but a malformed id should come back as a sentence rather
  // than as a Postgres syntax error.
  const parsed = planIdSchema.safeParse(planId);
  if (!parsed.success) {
    return { error: "That entry could not be identified.", fieldErrors: {} };
  }

  const { error } = await supabase
    .from("daily_plans")
    .delete()
    .eq("id", parsed.data)
    .is("meetings_actual", null); // a held visit stays on the record

  if (error) {
    logError("plan:remove", error);
    return {
      error: toFriendlyMessage(error, "We could not remove that entry."),
      fieldErrors: {},
    };
  }

  revalidatePath("/");
  revalidatePath("/log");
  return { error: null, fieldErrors: {}, ok: true };
}

/* ------------------------------------------------------------------ */
/* B–D. Logging a visit                                                */
/* ------------------------------------------------------------------ */

export async function createVisit(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const parsed = visitSchema.safeParse(visitFormDataToInput(formData));
  if (!parsed.success) {
    return {
      error: "Please check the highlighted fields.",
      fieldErrors: visitFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;

  // A photo may only ever live under the uploader's own folder — the same rule
  // the storage policy enforces, checked here so a tampered form cannot record
  // a path pointing at someone else's file.
  if (input.photo_path && !input.photo_path.startsWith(`${user.id}/`)) {
    return { error: "That photo could not be attached.", fieldErrors: {} };
  }

  // One call, one transaction. The RPC inserts the visit, marks today's plan
  // entry held and updates the institute's status together, so a failure part
  // way through leaves nothing behind. Its rule checks run inside that
  // transaction alongside the meeting-gate trigger — see
  // supabase/migrations/0002_log_visit_rpc.sql.
  const { error } = await supabase.rpc("log_visit", {
    p_institute_id: input.institute_id,
    p_activity: input.activity,
    p_lifecycle_status: input.lifecycle_status,
    p_expected_date: input.expected_date,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_photo_url: input.photo_path,
    p_notes: input.notes,
    p_status_set_to: input.status_set_to,
    p_follow_up_date: input.follow_up_date,
    p_follow_up_time: input.follow_up_time,
    p_daily_plan_id: input.daily_plan_id,
  });

  if (error) {
    logError("visit:create", error);

    const known = RPC_MESSAGES[error.code ?? ""];
    if (known) return { error: known, fieldErrors: {} };

    // The gate trigger is the backstop behind FO001: it raises check_violation,
    // and so do the lifecycle and follow-up constraints.
    if (error.code === CHECK_VIOLATION) {
      return {
        error:
          input.activity === "meeting"
            ? "A meeting can only be logged for an institute on today's plan. Add it on the Dashboard first."
            : "That combination is not allowed. Please check the dates and status.",
        fieldErrors: {},
      };
    }

    return {
      error: toFriendlyMessage(error, "We could not save this visit. Please try again."),
      fieldErrors: {},
    };
  }

  revalidatePath("/");
  revalidatePath("/log");
  revalidatePath("/pending");
  revalidatePath(`/institutes/${input.institute_id}`);
  redirect("/");
}

/* ------------------------------------------------------------------ */
/* E. Closing a pending session or campus visit                        */
/* ------------------------------------------------------------------ */

export async function completeVisit(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const parsed = completionSchema.safeParse(completionFormDataToInput(formData));
  if (!parsed.success) {
    return {
      error: "Please check the highlighted fields.",
      fieldErrors: visitFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;

  // The RLS update policy is member = auth.uid(), so a rep can only close their
  // own loop. Matching on member as well turns a policy rejection into a
  // "nothing matched" we can explain.
  const { data, error } = await supabase
    .from("visits")
    .update({
      lifecycle_status: "Done",
      closed_at: new Date().toISOString(),
      students_attended: input.students_attended,
      session_topic: input.session_topic,
      other_faculty_present: input.other_faculty_present,
      other_faculty_count: input.other_faculty_count,
    })
    .eq("id", input.visit_id)
    .eq("member", user.id)
    .eq("lifecycle_status", "Set")
    .select("id");

  if (error) {
    logError("visit:complete", error);
    return {
      error: toFriendlyMessage(error, "We could not close this off. Please try again."),
      fieldErrors: {},
    };
  }

  if (!data || data.length === 0) {
    return {
      error:
        "That entry could not be closed — it may already be done, or it belongs to another member.",
      fieldErrors: {},
    };
  }

  revalidatePath("/pending");
  revalidatePath("/");
  return { error: null, fieldErrors: {}, ok: true };
}
