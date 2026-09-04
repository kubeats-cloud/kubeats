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
  hasLifecycle,
  visitFieldErrors,
  visitFormDataToInput,
  visitSchema,
} from "@/lib/validation/visit";

const CHECK_VIOLATION = "23514";

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

  const { error } = await supabase
    .from("daily_plans")
    .delete()
    .eq("id", planId)
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

  const today = todayISO();
  const lifecycle = hasLifecycle(input.activity);
  const isSet = lifecycle && input.lifecycle_status === "Set";

  // Rule 2 — re-check the gate here so the rep gets a sentence rather than a
  // constraint. The trigger is still the authority; this is the friendly path.
  if (input.activity === "meeting") {
    const { data: plan, error } = await supabase
      .from("daily_plans")
      .select("id, institute_id, meetings_actual")
      .eq("id", input.daily_plan_id ?? "")
      .eq("member", user.id)
      .eq("date", today)
      .maybeSingle();

    if (error) logError("visit:plan-lookup", error);

    if (!plan || plan.institute_id !== input.institute_id) {
      return {
        error:
          "That institute is not on today's plan. Add it on the Dashboard, then log the meeting.",
        fieldErrors: {},
      };
    }
    if (plan.meetings_actual !== null) {
      return {
        error: "That meeting is already marked as held.",
        fieldErrors: {},
      };
    }
  }

  const { error: insertError } = await supabase.from("visits").insert({
    institute_id: input.institute_id,
    member: user.id,
    activity: input.activity,
    lifecycle_status: lifecycle ? input.lifecycle_status : null,
    // `date` is always the day the work was done — the day the rep logged it.
    // A "Set" session's future date lives in expected_date alone, because the
    // weekly rollup counts by `date`: a session fixed today must earn its
    // "set" credit in this week, not in the week it is expected to happen.
    date: today,
    expected_date: isSet ? input.expected_date : null,
    latitude: input.latitude,
    longitude: input.longitude,
    photo_url: input.photo_path,
    notes: input.notes,
    status_set_to: input.status_set_to,
    follow_up_date: input.follow_up_date,
    follow_up_time: input.follow_up_time,
  });

  if (insertError) {
    logError("visit:create", insertError);

    // The meeting-gate trigger raises check_violation. Everything we can
    // recognise gets its own sentence; nothing raw reaches the browser.
    if (insertError.code === CHECK_VIOLATION && input.activity === "meeting") {
      return {
        error:
          "A meeting can only be logged for an institute on today's plan. Add it on the Dashboard first.",
        fieldErrors: {},
      };
    }
    return {
      error: toFriendlyMessage(insertError, "We could not save this visit. Please try again."),
      fieldErrors: {},
    };
  }

  // Rule 7 — the weekly Meetings figure is counted from the plan, so marking it
  // held is what makes the visit count.
  if (input.activity === "meeting" && input.daily_plan_id) {
    const { error } = await supabase
      .from("daily_plans")
      .update({
        meetings_actual: 1,
        follow_up_date: input.follow_up_date,
      })
      .eq("id", input.daily_plan_id)
      .eq("member", user.id);

    if (error) {
      // The visit is saved; only the plan flag is behind. Say so plainly rather
      // than implying the whole thing failed.
      logError("visit:mark-held", error);
      return {
        error:
          "The visit was saved, but today's plan could not be marked as held. Please try marking it again from the Dashboard.",
        fieldErrors: {},
      };
    }
  }

  // Rule 4 — status is set by hand, and the trigger stamps who and when.
  if (input.status_set_to) {
    const { error } = await supabase
      .from("institutes")
      .update({ status: input.status_set_to })
      .eq("id", input.institute_id);

    if (error) {
      logError("visit:status", error);
      return {
        error:
          "The visit was saved, but the institute's status could not be updated. You can set it on the next visit.",
        fieldErrors: {},
      };
    }
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
