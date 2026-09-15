"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError, toFriendlyMessage } from "@/lib/errors";
import { todayISO } from "@/lib/visits";
import { requireAdmin } from "@/lib/admin";
import { assignVisitSchema } from "@/lib/validation/closing-report";
import { CHECK_FIELDS } from "@/lib/visit-form-state";
import type { FormState } from "@/lib/visit-form-state";
import {
  dailyPlanFormDataToInput,
  dailyPlanSchema,
  dailyPlanSummary,
  planIdSchema,
  visitFieldErrors,
} from "@/lib/validation/visit";


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
    const fieldErrors = visitFieldErrors(parsed.error);
    return { error: dailyPlanSummary(fieldErrors), fieldErrors };
  }

  /**
   * The purpose row is resolved SERVER-SIDE, not trusted from the form.
   *
   * The browser sends a label. What decides the visit's activity — and so which
   * weekly metric it feeds, and whether the meeting gate applies — is the
   * `purposes` row behind it, so the id is looked up here rather than posted.
   * A tampered form can name any label it likes; if no active purpose matches,
   * nothing is planned.
   *
   * `is_active` is part of the match: a retired purpose stays readable for the
   * plans that already reference it, and cannot be used for a new one.
   */
  const { data: purposeRow, error: purposeError } = await supabase
    .from("purposes")
    .select("id, label, requires_note")
    .eq("label", parsed.data.purpose)
    .eq("is_active", true)
    .maybeSingle();

  if (purposeError) {
    logError("plan:purpose-lookup", purposeError);
    return {
      error: toFriendlyMessage(purposeError, "We could not add that to today's plan."),
      fieldErrors: {},
    };
  }
  if (!purposeRow) {
    return {
      error: "That purpose is no longer available. Pick another one.",
      fieldErrors: {},
    };
  }

  // Re-checked against the ROW rather than the form's flag, for the same
  // reason the id is: a client that says "no note needed" must not be able to
  // decide that.
  if (purposeRow.requires_note && !parsed.data.purpose_note) {
    return {
      error: "Say what this visit is for.",
      fieldErrors: { purpose_note: "Say what this visit is for." },
    };
  }

  const { error } = await supabase.from("daily_plans").upsert(
    {
      member: user.id,
      date: todayISO(),
      institute_id: parsed.data.institute_id,
      purpose: purposeRow.label,
      purpose_id: purposeRow.id,
      // Cleared when the purpose does not want one, so re-planning the same
      // institute under a different purpose cannot leave yesterday's note
      // attached to today's reason.
      purpose_note: purposeRow.requires_note ? parsed.data.purpose_note : null,
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

/**
 * An admin putting a visit on someone else's plan.
 *
 * Deliberately the same row, the same table and the same meeting gate as a rep
 * planning their own day — an assignment is not a separate concept, it is a
 * plan entry someone else created. The only difference is assigned_by, which
 * the trigger in migration 0005 insists is the caller.
 *
 * Admin-only here for the sake of a sentence; the RLS policy and that trigger
 * are what actually stop a rep assigning work to anyone.
 */
export async function assignVisit(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error, fieldErrors: {} };

  const parsed = assignVisitSchema.safeParse({
    member: String(formData.get("member") ?? ""),
    institute_id: String(formData.get("institute_id") ?? ""),
    purpose: String(formData.get("purpose") ?? ""),
    date: String(formData.get("date") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: CHECK_FIELDS,
      fieldErrors: visitFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;

  if (input.date < todayISO()) {
    return { error: "You cannot assign a visit in the past.", fieldErrors: {} };
  }

  /**
   * An assignment carries the purpose's mapping too, and it MUST.
   *
   * The rep who receives this will check in and log it, and stage 3 derives the
   * visit's activity from `purpose_id` — so an assignment written with the
   * label alone would hand them a planned visit the app cannot turn into an
   * activity. Same lookup, same reasons, as the rep's own path above.
   */
  const { data: purposeRow, error: purposeError } = await gate.supabase
    .from("purposes")
    .select("id, label")
    .eq("label", input.purpose)
    .eq("is_active", true)
    .maybeSingle();

  if (purposeError) {
    logError("plan:assign-purpose-lookup", purposeError);
    return {
      error: toFriendlyMessage(purposeError, "We could not assign that visit."),
      fieldErrors: {},
    };
  }
  if (!purposeRow) {
    return {
      error: "That purpose is no longer available. Pick another one.",
      fieldErrors: {},
    };
  }

  const { error } = await gate.supabase.from("daily_plans").upsert(
    {
      member: input.member,
      date: input.date,
      institute_id: input.institute_id,
      purpose: purposeRow.label,
      purpose_id: purposeRow.id,
      assigned_by: gate.user.id,
    },
    { onConflict: "member,date,institute_id" },
  );

  if (error) {
    logError("plan:assign", error);
    if (error.code === "42501") {
      return { error: "Only an admin can assign a visit.", fieldErrors: {} };
    }
    // FO023 — an assignment has to stay inside the rep's own campus, or it
    // reintroduces exactly the crossing campus scoping exists to prevent. The
    // picker is filtered too, so this is the backstop rather than the message
    // an admin normally sees.
    if (error.code === "FO023") {
      return {
        error: "That institute is not in that rep's campus.",
        fieldErrors: {},
      };
    }
    return {
      error: toFriendlyMessage(error, "We could not assign that visit."),
      fieldErrors: {},
    };
  }

  revalidatePath("/");
  revalidatePath("/settings");
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
    .is("meetings_actual", null) // a held visit stays on the record
    // ...and so does one the rep has already arrived at. Without this, "check
    // in, remove the entry, add it again, check in again" bought a second
    // arrival at the same institute on the same day — defeating #8 and walking
    // straight through FO011's write-once checkin_at, because a new ROW gets a
    // new timestamp honestly. guard_checkin_cycle_final (FO014) says the same
    // thing in the database, where a tampered request also has to hear it.
    .is("checkin_at", null);

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

/*
 * createVisit() lived here — the single-step "log a visit" that redirected to
 * the closing report afterwards.
 *
 * Stage 3 replaced it with logAndFileVisit() in feedback-actions.ts, which logs
 * the visit AND files its short feedback AND checks the rep out from one
 * submit. Keeping this one alongside would have left a second way into
 * log_visit() that skipped the feedback and the check-out entirely — which is
 * exactly the dodge the forced chain exists to close.
 */
