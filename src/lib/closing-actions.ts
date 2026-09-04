"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError, toFriendlyMessage } from "@/lib/errors";
import type { FormState } from "@/lib/visit-form-state";
import {
  closingReportFormDataToInput,
  closingReportSchema,
  hasSession,
  needsClosingReport,
} from "@/lib/validation/closing-report";
import { visitFieldErrors } from "@/lib/validation/visit";
import { todayISO } from "@/lib/dates";

/**
 * Filing the closing report.
 *
 * This is the Phase 5 completion, grown up. For a session or a campus visit it
 * still does exactly what the old form did — lifecycle to Done, closed_at
 * stamped today — and now records what actually happened alongside it. A
 * meeting has no lifecycle to close, so for one of those the report is simply
 * filed.
 *
 * Three statements, ordered so a partial failure is harmless rather than
 * confusing: the people are replaced first, and the visit — which carries
 * reported_at, the flag that says a report exists — is written last. Fail in
 * the middle and the visit is still unreported, so the rep files it again and
 * the first thing that happens is those rows being replaced.
 */
export async function submitClosingReport(
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

  const parsed = closingReportSchema.safeParse(
    closingReportFormDataToInput(formData),
  );
  if (!parsed.success) {
    return {
      error: "Please check the highlighted fields.",
      fieldErrors: visitFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;

  // The visit must exist, be this rep's, and be one of the three that gets a
  // report. RLS would hide someone else's, but a sentence beats an empty result.
  const { data: visit, error: loadError } = await supabase
    .from("visits")
    .select("id, member, activity, lifecycle_status, photo_url")
    .eq("id", input.visit_id)
    .maybeSingle();

  if (loadError) {
    logError("closing:load", loadError);
    return { error: toFriendlyMessage(loadError, "We could not open that visit."), fieldErrors: {} };
  }
  if (!visit || visit.member !== user.id) {
    return {
      error: "That visit could not be found, or it belongs to someone else.",
      fieldErrors: {},
    };
  }
  if (!needsClosingReport(visit.activity)) {
    return { error: "That kind of visit does not take a closing report.", fieldErrors: {} };
  }

  // Rule 12 — a visit is not complete without its photograph. In practice this
  // never fires: the photo is taken when the visit is logged, and neither the
  // form nor log_visit() will accept one without it. It stands for the row that
  // predates that rule, or arrives from a restored backup — there is no photo
  // field on this screen, so such a visit has to be re-logged rather than
  // silently completed as evidence-free.
  if (!visit.photo_url) {
    return {
      error:
        "This visit has no photo, and a photo is required. Please log the visit again with one.",
      fieldErrors: {},
    };
  }

  // 1. Replace the people met.
  const { error: clearError } = await supabase
    .from("visit_people")
    .delete()
    .eq("visit_id", visit.id);
  if (clearError) {
    logError("closing:people-clear", clearError);
    return { error: "We could not save the people you met. Please try again.", fieldErrors: {} };
  }

  const { error: peopleError } = await supabase.from("visit_people").insert(
    input.people.map((person) => ({
      visit_id: visit.id,
      name: person.name,
      contact_type: person.contact_type,
      designation: person.designation,
      contact_number: person.contact_number,
      is_decision_maker: person.is_decision_maker,
    })),
  );
  if (peopleError) {
    logError("closing:people", peopleError);
    return { error: "We could not save the people you met. Please try again.", fieldErrors: {} };
  }

  // 2. The report itself, and the completion if this visit has one to do.
  const session = hasSession(input.activities_conducted);
  // A session or campus visit is closed by its report, whether it had been
  // scheduled ("Set") or logged as already done. Both end up with the same
  // lifecycle and the same closed_at, so "when was this finished" means one
  // thing across the table. A meeting has no lifecycle to close.
  const closes = visit.lifecycle_status !== null;

  const { error: updateError } = await supabase
    .from("visits")
    .update({
      activities_conducted: input.activities_conducted,
      // Session detail is only meaningful when a session happened; storing it
      // otherwise would leave stray answers from a field the rep then hid.
      session_topic: session ? input.session_topic : null,
      session_class: session ? input.session_class : null,
      session_streams: session ? input.session_streams : null,
      students_attended: session ? input.students_attended : null,
      session_duration_mins: session ? input.session_duration_mins : null,
      other_faculty_present: session ? input.other_faculty_present : null,
      other_faculty_count: session ? input.other_faculty_count : null,
      session_participation: session ? input.session_participation : null,
      student_questions: session ? input.student_questions : null,

      student_response: input.student_response,
      student_interest: input.student_interest,
      management_response: input.management_response,
      management_feedback: input.management_feedback,

      discussion_summary: input.discussion_summary,
      visit_outcome: input.visit_outcome,
      applications_collected: input.applications_collected,
      admissions_generated: input.admissions_generated,

      follow_up_action: input.follow_up_needed ? input.follow_up_action : null,
      follow_up_date: input.follow_up_needed ? input.follow_up_date : null,
      employee_remarks: input.employee_remarks,

      reported_at: new Date().toISOString(),
      ...(closes
        ? { lifecycle_status: "Done", closed_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", visit.id)
    .eq("member", user.id);

  if (updateError) {
    logError("closing:update", updateError);
    return {
      error: toFriendlyMessage(updateError, "We could not file this report. Please try again."),
      fieldErrors: {},
    };
  }

  revalidatePath("/pending");
  revalidatePath("/");
  revalidatePath("/institutes", "layout");
  redirect("/pending?filed=1");
}

/**
 * A rep may still want to look at a report they filed. Reopening it is not in
 * scope — the report is an account of a day, and editing days later is how
 * records stop being records — so this only says whether one exists.
 */
export async function hasReport(visitId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("visits")
    .select("reported_at")
    .eq("id", visitId)
    .maybeSingle();
  return Boolean(data?.reported_at);
}

/** Today, in the app's own terms. Exported for the form's date defaults. */
export async function today(): Promise<string> {
  return todayISO();
}
