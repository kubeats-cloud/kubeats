"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError, toFriendlyMessage } from "@/lib/errors";
import { CHECK_FIELDS } from "@/lib/visit-form-state";
import type { FormState } from "@/lib/visit-form-state";
import {
  feedbackFieldsSchema,
  feedbackFormDataToInput,
  feedbackSchema,
} from "@/lib/validation/feedback";
import {
  makeVisitSchema,
  visitFieldErrors,
  visitFormDataToInput,
} from "@/lib/validation/visit";
import { listStatusCatalogue } from "@/lib/statuses";

/**
 * Filing the short feedback form — which is also the check-out.
 *
 * ONE RPC, because this touches two tables. `public.close_visit()` writes the
 * feedback onto the visit, stamps `closed_at` on any earlier "Set" this visit
 * completed, and stamps `checkout_at` on the plan row, in a single transaction.
 * CLAUDE.md requires that of a multi-table write, and it matters more here than
 * it did for the old closing report: a check-out is not a thing you want half
 * of.
 *
 * `close_visit()` is a NEW function rather than more parameters on
 * `log_visit()`. Migration 0015's closing assertion requires exactly one
 * `log_visit` overload — adding a parameter creates a second, every existing
 * call becomes ambiguous, and every visit in the app stops saving. It runs
 * SECURITY INVOKER, so RLS and every trigger still apply to it.
 *
 * WHAT HAPPENS IF THIS FAILS AFTER THE VISIT WAS LOGGED. The visit exists and
 * is unreported, the rep is still checked in, and the Dashboard still offers
 * that visit back to them. So the recovery is the same screen they were already
 * on, and re-submitting is safe: the plan update is filtered on
 * `checkout_at is null`, so a second run cannot move a departure that was
 * already recorded.
 */

/**
 * Every code the two RPCs raise, mapped by CODE rather than by message so the
 * wording lives here and no database text ever reaches a rep.
 *
 * FO001-FO009 are log_visit()'s and moved here with the logging path when
 * createVisit() was retired; FO015-FO019 are close_visit()'s.
 */
const RPC_MESSAGES: Record<string, string> = {
  FO001: "That institute is not on today's plan. Start from the Dashboard.",
  FO002: "That visit is already marked as held.",
  FO003: "That photo could not be attached.",
  FO004: "Your session has expired. Please sign in again.",
  FO005: "That entry is no longer on today's plan. Add it again on the Dashboard.",
  FO006: "That institute no longer exists.",
  FO007: "A photo is required to log this visit.",
  FO008: "The photo was taken during the visit and cannot be changed afterwards.",
  FO009: "Check in at this institute before logging the visit.",
  FO016:
    "That status leaves the institute open, so a follow-up date is needed.",
  FO024: "Say where this visit leaves the institute before saving it.",
  FO015: "The departure time was already recorded and cannot be changed.",
  FO017: "That visit could not be found, or it belongs to someone else.",
  FO018: "That visit has already been filed.",
  FO019:
    "That earlier visit could not be closed from here. It may already be closed.",
};

export async function submitFeedback(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const parsed = feedbackSchema.safeParse(feedbackFormDataToInput(formData));
  if (!parsed.success) {
    return {
      error: CHECK_FIELDS,
      fieldErrors: visitFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;

  const { error } = await supabase.rpc("close_visit", {
    p_visit_id: input.visit_id,
    p_daily_plan_id: input.daily_plan_id,
    p_notes: input.notes,
    // DORMANT, not forgotten. Phase 2 stage 1 withdrew these five questions
    // from the form; their columns and their vocabulary CHECKs are untouched,
    // so every report filed under an older shape still renders and bringing one
    // back is a control rather than a migration. Passed explicitly as null so a
    // reader sees a decision here instead of an omission — the RPC's signature
    // is unchanged and still carries all of them.
    p_institute_interested: null,
    p_visit_outcome: null,
    p_management_response: null,
    p_student_response: null,
    p_students_reached: null,
    p_met_name: input.met_name,
    p_met_phone: input.met_phone,
    // The one student count that survives: everybody who was there.
    p_students_attended: input.students_attended,
    p_session_topic: input.session_topic,
    p_session_taken_by: input.session_taken_by,
    p_closes_visit_id: input.closes_visit_id,
    // The departure carries no coordinates. The arrival is what the presence
    // guarantee rests on and it is already recorded; asking the device again on
    // submit would add a second position to the record, a few metres from the
    // first, that answers no question anyone has.
    p_checkout_lat: null,
    p_checkout_lng: null,
    p_checkout_accuracy: null,
  });

  if (error) {
    logError("feedback:close", error);
    const known = RPC_MESSAGES[error.code ?? ""];
    if (known) return { error: known, fieldErrors: {} };
    return {
      error: toFriendlyMessage(error, "We could not file this. Please try again."),
      fieldErrors: {},
    };
  }

  revalidatePath("/");
  revalidatePath("/pending");
  revalidatePath("/institutes", "layout");
  redirect("/?filed=1");
}

/**
 * Log the visit and file its feedback, from one submit.
 *
 * The rep fills one screen — what happened, the photo, the status, the short
 * form — and taps once. Behind it that is two RPCs, because `log_visit()` owns
 * the meeting gate, Rule 3, Rule 4 and Rule 12 and must not be reimplemented
 * here, while `close_visit()` owns the feedback and the check-out.
 *
 * THE TWO ARE NOT ONE TRANSACTION, and that is a real seam rather than a
 * hidden one. If the first succeeds and the second does not, the visit exists,
 * unreported, and the rep is still checked in — so the Dashboard shows the
 * entry as In progress with "Continue", `/log` finds the visit through
 * `getUnreportedVisitFor()` and offers the feedback alone. The rep never sees the
 * seam and cannot log the same arrival twice.
 *
 * Validating BOTH halves before either runs is what keeps that seam rare: a
 * form that is going to be rejected is rejected before anything is written.
 */
export async function logAndFileVisit(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  /**
   * THE SCHEMA IS BUILT FROM THE LOADED VOCABULARY, not from a constant.
   *
   * Migration 0026 made the status columns foreign keys to
   * public.institute_statuses, so an admin can add a status — and a schema
   * holding the seeded nine would refuse the very value the database is about
   * to accept. This is the call that has to use makeVisitSchema(); the exported
   * visitSchema is the seeded fallback and is for tests.
   */
  const catalogue = await listStatusCatalogue();
  const visitParsed = makeVisitSchema(catalogue).safeParse(
    visitFormDataToInput(formData),
  );
  const feedbackParsed = feedbackFieldsSchema.safeParse(
    feedbackFormDataToInput(formData),
  );

  // Both, so a rep fixes everything in one pass rather than discovering the
  // second problem after correcting the first.
  if (!visitParsed.success || !feedbackParsed.success) {
    return {
      error: CHECK_FIELDS,
      fieldErrors: {
        ...(visitParsed.success ? {} : visitFieldErrors(visitParsed.error)),
        ...(feedbackParsed.success ? {} : visitFieldErrors(feedbackParsed.error)),
      },
    };
  }
  const visit = visitParsed.data;
  const feedback = feedbackParsed.data;

  if (visit.photo_path && !visit.photo_path.startsWith(`${user.id}/`)) {
    return { error: "That photo could not be attached.", fieldErrors: {} };
  }

  // 1. The visit. Untouched audited path — gate, Rule 3, Rule 4, Rule 12.
  const { data: newVisitId, error: logError_ } = await supabase.rpc("log_visit", {
    p_institute_id: visit.institute_id,
    p_activity: visit.activity,
    p_lifecycle_status: visit.lifecycle_status,
    p_expected_date: visit.expected_date,
    p_latitude: visit.latitude,
    p_longitude: visit.longitude,
    p_photo_url: visit.photo_path,
    p_notes: feedback.notes,
    p_status_set_to: visit.status_set_to,
    p_accuracy: visit.accuracy,
    // FROM THE VISIT, not from the feedback. Both schemas used to read these
    // two form fields and the pair is now `visitSchema`'s alone — which is
    // where the rule lives (an OPEN status requires both, mirroring
    // enforce_follow_up_when_open/FO016) and where they are actually stored:
    // log_visit() writes them, close_visit() never has.
    p_follow_up_date: visit.follow_up_date,
    // DORMANT since 0023 — the form has no time picker and the trigger no
    // longer asks for one. Still passed rather than hard-coded to null: during
    // a deploy a cached page can still post a time, and what a rep typed should
    // be stored rather than dropped. Normally null.
    p_follow_up_time: visit.follow_up_time,
    p_daily_plan_id: visit.daily_plan_id,
  });

  if (logError_) {
    logError("visit:log-and-file", logError_);
    const known = RPC_MESSAGES[logError_.code ?? ""];
    return {
      error: known ?? toFriendlyMessage(logError_, "We could not save this visit."),
      fieldErrors: {},
    };
  }

  // 2. The feedback, the close of any earlier Set, and the check-out.
  const { error: closeError } = await supabase.rpc("close_visit", {
    p_visit_id: newVisitId,
    p_daily_plan_id: visit.daily_plan_id,
    p_notes: feedback.notes,
    // Dormant since Phase 2 stage 1 — see the note on the same five in
    // submitFeedback above.
    p_institute_interested: null,
    p_visit_outcome: null,
    p_management_response: null,
    p_student_response: null,
    p_students_reached: null,
    p_met_name: feedback.met_name,
    p_met_phone: feedback.met_phone,
    p_students_attended: feedback.students_attended,
    p_session_topic: feedback.session_topic,
    p_session_taken_by: feedback.session_taken_by,
    p_closes_visit_id: feedback.closes_visit_id,
    p_checkout_lat: null,
    p_checkout_lng: null,
    p_checkout_accuracy: null,
  });

  if (closeError) {
    logError("visit:close-after-log", closeError);
    const known = RPC_MESSAGES[closeError.code ?? ""];
    return {
      error:
        (known ??
          toFriendlyMessage(closeError, "We could not file this.")) +
        " Your visit was saved. Open it again from the Dashboard to finish.",
      fieldErrors: {},
    };
  }

  revalidatePath("/");
  revalidatePath("/pending");
  revalidatePath("/institutes", "layout");
  redirect("/?filed=1");
}
