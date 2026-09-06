"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { logError, toFriendlyMessage } from "@/lib/errors";
import type { FormState } from "@/lib/visit-form-state";
import {
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
 * The coordinates are the opposite: they can only come from the device, and
 * they are allowed to be missing. A denied permission or no signal still
 * records the arrival, because a rep standing at a gate must never be stranded
 * by their phone. Migration 0014 makes every coordinate column nullable for the
 * same reason Rule 12 lets a photo save without a geo-tag.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const GONE = "That planned visit is no longer on your plan.";

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

  // `.is("checkin_at", null)` makes this idempotent: a double tap, or two
  // phones, cannot overwrite the first arrival with a later one.
  const { data, error } = await supabase
    .from("daily_plans")
    .update({
      checkin_at: new Date().toISOString(),
      checkin_lat: parsed.data.latitude,
      checkin_lng: parsed.data.longitude,
    })
    .eq("id", parsed.data.plan_id)
    .eq("member", user.id)
    .is("checkin_at", null)
    .select("id");

  if (error) {
    logError("checkin:in", error);
    return {
      error: toFriendlyMessage(error, "We could not record that check-in."),
      fieldErrors: {},
    };
  }

  if (!data || data.length === 0) {
    // Either the row is gone, or the rep is already checked in. Both are fine
    // outcomes for the person tapping; neither is an error worth a red box.
    revalidatePath("/");
    return { error: null, fieldErrors: {}, ok: true };
  }

  revalidatePath("/");
  revalidatePath("/log");
  return { error: null, fieldErrors: {}, ok: true };
}

export async function checkOut(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const parsed = checkPointSchema.safeParse(checkPointFormDataToInput(formData));
  if (!parsed.success) {
    return { error: "We could not record that check-out.", fieldErrors: {} };
  }

  const { data, error } = await supabase
    .from("daily_plans")
    .update({
      checkout_at: new Date().toISOString(),
      checkout_lat: parsed.data.latitude,
      checkout_lng: parsed.data.longitude,
    })
    .eq("id", parsed.data.plan_id)
    .eq("member", user.id)
    .not("checkin_at", "is", null)
    .is("checkout_at", null)
    .select("id");

  if (error) {
    logError("checkin:out", error);
    return {
      error: toFriendlyMessage(error, "We could not record that check-out."),
      fieldErrors: {},
    };
  }

  if (!data || data.length === 0) {
    return {
      error: "That visit is not open for check-out.",
      fieldErrors: {},
    };
  }

  revalidatePath("/");
  return { error: null, fieldErrors: {}, ok: true };
}

/**
 * The escape valve: closing a visit whose check-out never happened.
 *
 * A rep finishes at a school, drives off, and remembers at nine that evening.
 * Without this the visit sits In Progress for ever and the day never balances.
 * So it is marked Completed with the duration recorded honestly as unknown,
 * rather than inventing a check-out time that would make the record a lie.
 *
 * Open to the rep themselves and to an admin — 0014 widens daily_plans_update
 * for exactly this, and an admin could already delete the row outright.
 */
export async function closeWithoutCheckout(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const planId = String(formData.get("plan_id") ?? "").trim();
  if (!planId) {
    return { error: "We could not tell which visit to close.", fieldErrors: {} };
  }

  const supabase = await createClient();
  // No member filter: an admin closing a rep's forgotten visit is the point.
  // RLS decides whether this caller may touch the row at all.
  const { data, error } = await supabase
    .from("daily_plans")
    .update({ checkout_missing: true })
    .eq("id", planId)
    .not("checkin_at", "is", null)
    .is("checkout_at", null)
    .select("id");

  if (error) {
    logError("checkin:close", error);
    return {
      error: toFriendlyMessage(error, "We could not close that visit."),
      fieldErrors: {},
    };
  }

  if (!data || data.length === 0) {
    return { error: GONE, fieldErrors: {} };
  }

  revalidatePath("/");
  revalidatePath("/report");
  return { error: null, fieldErrors: {}, ok: true };
}
