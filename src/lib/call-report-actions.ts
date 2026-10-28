"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin";
import { listStatusCatalogue } from "@/lib/statuses";
import { makeReportSchema, feedbackFormDataToInput } from "@/lib/validation/feedback";
import { eventDateRequired, followUpRequired, nextActionShown, visitFieldErrors, makeAdminCallEditSchema } from "@/lib/validation/visit";
import { selectableStatuses } from "@/lib/validation/institute";
import { listStatusFields } from "@/lib/status-fields";
import { fieldErrorsFrom, textOf } from "@/lib/validation/admin";
import { logError, toFriendlyMessage } from "@/lib/errors";
import type { FormState } from "@/lib/visit-form-state";
import type { AdminState } from "@/lib/admin-form-state";

export async function submitCallReport(formData: FormData): Promise<FormState & { ok?: boolean }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "rep") return { error: "Only a Rep can log a call.", fieldErrors: {} };
  const catalogue = await listStatusCatalogue();
  const text = (key: string) => String(formData.get(key) ?? "").trim();
  const status = text("status_set_to");
  const schema = z.object({
    task: z.uuid(), status: z.enum(selectableStatuses(catalogue) as [string, ...string[]]),
    expected: z.iso.date().nullable(), followUp: z.iso.date().nullable(),
    next: z.enum(["call", "meeting"]).nullable(),
  });
  const parsed = schema.safeParse({task:text("task_id"), status,
    expected:text("expected_date") || null, followUp:text("follow_up_date") || null,
    next:text("next_action") || null});
  if (!parsed.success) return { error: "Check the call report fields.", fieldErrors: visitFieldErrors(parsed.error) };
  const value = parsed.data;
  if (eventDateRequired(catalogue,status) && !value.expected)
    return { error: "Enter the status date.", fieldErrors: {expected_date:"Enter the status date."} };
  if (followUpRequired(catalogue,status) && !value.followUp)
    return { error: "Enter the Follow-up Date.", fieldErrors: {follow_up_date:"Enter the Follow-up Date."} };
  if (value.next && !nextActionShown(catalogue,status))
    return { error: "A closed status does not take a next action.", fieldErrors: {} };
  const report = makeReportSchema(catalogue,status).safeParse(feedbackFormDataToInput(formData));
  if (!report.success) return { error: "Check the call report fields.", fieldErrors: visitFieldErrors(report.error) };

  // Parse dynamic fields
  const customPayload = text("custom_fields_payload");
  let customFields: Record<string, string> = {};
  if (customPayload) {
    try {
      customFields = JSON.parse(customPayload);
    } catch {}
  }
  for (const [key, val] of formData.entries()) {
    if (key.startsWith("custom_field_")) {
      const fieldName = key.replace("custom_field_", "");
      customFields[fieldName] = String(val).trim();
    }
  }

  // Validate required status fields
  const dynamicFields = await listStatusFields(status);
  const dynamicErrors: Record<string, string> = {};
  for (const df of dynamicFields) {
    if (df.isRequired && (!customFields[df.fieldName] || customFields[df.fieldName].trim() === "")) {
      dynamicErrors[df.fieldName] = `${df.fieldName} is required.`;
    }
  }
  if (Object.keys(dynamicErrors).length > 0) {
    return { error: "Please fill in all required fields.", fieldErrors: dynamicErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("log_call", {
    p_task_id:value.task, p_status_set_to:status, p_expected_date:value.expected,
    p_follow_up_date:value.followUp, p_notes:report.data.notes,
    p_students_attended:report.data.students_attended, p_session_topic:report.data.session_topic,
    p_session_taken_by:report.data.session_taken_by, p_next_action:value.next,
  });
  if (error) return {error:"We could not save this call. Check that it is still yours and has not already been logged.",fieldErrors:{}};

  if (Object.keys(customFields).length > 0) {
    await supabase.from("follow_up_tasks").update({ custom_fields: customFields }).eq("id", value.task);
  }

  revalidatePath("/", "layout");
  return {error:null,fieldErrors:{},ok:true};
}

/**
 * An admin corrects an already-filed Call Report.
 *
 * ADMIN ONLY — `requireAdmin()` here is stricter than `follow_up_tasks`'
 * own RLS, which already lets a team lead reach their rep's row. The RPC
 * repeats the check in SQL (FO045) so the two cannot drift; this gate just
 * means a team lead never reaches the RPC with a request worth sending.
 *
 * Editable fields only: status, follow-up date, expected date, outcome,
 * notes. `makeAdminCallEditSchema()` (validation/visit.ts) is the same
 * status-driven date rule Log Call uses, asked here first so a bad request
 * gets a field error before the round trip; the RPC (FO016/FO040) is still
 * the control.
 */
export async function adminUpdateCallReport(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error, fieldErrors: {} };

  const catalogue = await listStatusCatalogue();
  const optional = (key: string) => textOf(formData, key) || null;

  const parsed = makeAdminCallEditSchema(catalogue).safeParse({
    task_id: textOf(formData, "task_id"),
    status_set_to: textOf(formData, "status_set_to"),
    follow_up_date: optional("follow_up_date"),
    expected_date: optional("expected_date"),
    outcome: optional("outcome"),
    notes: optional("notes"),
  });

  if (!parsed.success) {
    return { error: "Check the call report fields.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  const value = parsed.data;

  const { error } = await gate.supabase.rpc("admin_update_call_report", {
    p_task_id: value.task_id,
    p_status_set_to: value.status_set_to,
    p_follow_up_date: value.follow_up_date,
    p_expected_date: value.expected_date,
    p_outcome: value.outcome,
    p_notes: value.notes,
  });

  if (error) {
    logError("admin:update-call-report", error);
    if (error.code === "FO045") {
      return { error: "Only an admin can edit a Call Report.", fieldErrors: {} };
    }
    if (error.code === "FO046") {
      return { error: "That Call Report could not be found.", fieldErrors: {} };
    }
    if (error.code === "FO016") {
      return {
        error: "That status leaves the institute open, so a follow-up date is needed.",
        fieldErrors: { follow_up_date: "Enter the Follow-up Date." },
      };
    }
    if (error.code === "FO040") {
      return { error: "Enter the status date.", fieldErrors: { expected_date: "Enter the status date." } };
    }
    return { error: toFriendlyMessage(error, "We could not save those changes."), fieldErrors: {} };
  }

  // The institute's own status may have moved too (when this call was its
  // most recent status-setting event), so Pending, the Daily Plan and the
  // institute's own page all need to see it, not only Review.
  revalidatePath("/review", "layout");
  revalidatePath("/institutes", "layout");
  revalidatePath("/pending");
  return { error: null, fieldErrors: {}, ok: true, message: "Saved." };
}
