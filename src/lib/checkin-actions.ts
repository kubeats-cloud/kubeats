"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError, toFriendlyMessage } from "@/lib/errors";
import type { FormState } from "@/lib/visit-form-state";
import {
  NO_LOCATION_GUIDANCE,
  checkInBlocked,
  checkPointFormDataToInput,
  checkPointSchema,
} from "@/lib/validation/checkin";

/**
 * Arriving at and leaving a planned visit.
 *
 * The timestamps are stamped HERE, from the server clock, never sent from the
 * browser — a device with the wrong time, or a rep with the developer tools
 * open, must not be able to claim they were somewhere at a time they were not.
 * That is the whole value of the record.
 *
 * The coordinates can only come from the device — and as of stage 3 they are
 * no longer optional. A check-in needs a position, or the rep's own account of
 * why there is not one (docs/stage3-plan.md, #6). That reverses the rule 0014
 * and 0015 both state, deliberately, and it keeps a LOGGED escape rather than
 * a silent one: `checkin_location_manual` flags it and
 * `checkin_manual_reason` carries their words, both visible to an admin.
 *
 * The column stays nullable, because the escape is real and because one row
 * predating this rule has an arrival and no coordinates.
 * `enforce_checkin_located()` (FO012) is the backstop.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * What the check-in triggers raise, mapped by CODE rather than by message so no
 * database text ever reaches a rep. FO012 and FO013 are 0018's.
 */
const CHECKIN_MESSAGES: Record<string, string> = {
  FO012: `A location is needed to check in. ${NO_LOCATION_GUIDANCE}`,
  FO013:
    "You are still checked in somewhere else. Finish that visit first — it is on your Dashboard.",
  FO014: "This visit has already started, so it cannot be removed from the plan.",
};

export async function checkIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const parsed = checkPointSchema.safeParse(checkPointFormDataToInput(formData));
  if (!parsed.success) {
    return { error: "We could not record that check-in.", fieldErrors: {} };
  }

  // #6 — refused here so the rep gets a sentence rather than FO012. The
  // trigger still runs and is what holds against a tampered form.
  if (checkInBlocked(parsed.data)) {
    return {
      error: `A location is needed to check in. ${NO_LOCATION_GUIDANCE}`,
      fieldErrors: {},
    };
  }

  const manual = parsed.data.latitude === null;

  // `.is("checkin_at", null)` makes this idempotent: a double tap, or two
  // phones, cannot overwrite the first arrival with a later one.
  const { error } = await supabase
    .from("daily_plans")
    .update({
      checkin_at: new Date().toISOString(),
      checkin_lat: parsed.data.latitude,
      checkin_lng: parsed.data.longitude,
      checkin_accuracy: parsed.data.accuracy,
      // Only ever true when there is no position to record. Writing the reason
      // alongside a good fix would put a note in the record that contradicts
      // the coordinates beside it.
      checkin_location_manual: manual,
      checkin_manual_reason: manual ? parsed.data.manual_reason : null,
    })
    .eq("id", parsed.data.plan_id)
    .eq("member", user.id)
    .is("checkin_at", null);

  if (error) {
    logError("checkin:in", error);
    const known = CHECKIN_MESSAGES[error.code ?? ""];
    if (known) return { error: known, fieldErrors: {} };
    return {
      error: toFriendlyMessage(error, "We could not record that check-in."),
      fieldErrors: {},
    };
  }

  revalidatePath("/");
  revalidatePath("/log");

  // #9 — the forced chain. An arrival is not a thing a rep does and then
  // decides about; it is the first step of logging the visit, so the next
  // screen is the log itself, with the institute and purpose already filled in
  // from the plan row.
  //
  // `data` being empty means the row was already checked in — a double tap, or
  // a rep coming back to a visit they started. That is not an error and it
  // leads to exactly the same place, which is the point of the chain.
  redirect(`/log?plan=${parsed.data.plan_id}`);
}

/*
 * checkOut() and closeWithoutCheckout() BOTH lived here, and both are gone.
 *
 * checkOut was the rep tapping "Check out" when they left. Stage 3 makes the
 * departure automatic: submitting the feedback form calls public.close_visit(),
 * which stamps checkout_at in the same transaction as the report. A rep never
 * taps it, so a button that could be forgotten no longer exists.
 *
 * closeWithoutCheckout was the escape valve for a visit left open — "completed,
 * duration unknown". It is gone for a sharper reason: the flow is now a forced
 * chain, and a rep who is still on it can always finish it — the Dashboard
 * offers an in-progress visit straight back to them. Leaving an "I give up"
 * button beside that would be offering the easier tap, and it is the one tap
 * that loses the duration.
 *
 * What catches a visit nobody CAN finish — a dead phone, a closed browser, a
 * rep who drove away — is public.sweep_open_checkins(), scheduled nightly in
 * migration 0018. It sets the same checkout_missing = true this action used to,
 * so the state and its wording are unchanged; only who does it has moved, from
 * the rep to a job they never see.
 *
 * An admin with a rep genuinely stuck mid-day has no button either. The
 * one-liner for it is in 0018's footer.
 */
