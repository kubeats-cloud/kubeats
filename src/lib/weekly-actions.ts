"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { logError, toFriendlyMessage } from "@/lib/errors";
import type { FormState } from "@/lib/visit-form-state";
import {
  METRIC_KEYS,
  reopenSchema,
  weeklyFieldErrors,
  weeklyFormDataToInput,
  weeklyTargetsSchema,
} from "@/lib/validation/weekly";
import { isFutureWeek } from "@/lib/weeks";

/**
 * Rule 6 — the weekly lock.
 *
 * The trigger on weekly_targets is the authority: it refuses any edit to a
 * locked week, allows only an admin to unlock one, and stamps submitted_at and
 * reopened_by/reopened_at itself so the audit trail cannot be forged from the
 * client. Everything here exists to turn those refusals into sentences.
 */

const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

const LOCKED_MESSAGE =
  "This week is locked. Ask an admin to reopen it before making changes.";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function mapLockError(error: { code?: string }, fallback: string): string {
  if (error.code === CHECK_VIOLATION) return LOCKED_MESSAGE;
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    return "Only an admin can do that.";
  }
  return toFriendlyMessage(error, fallback);
}

/**
 * Saves the eight numbers, either as a working draft or as the final
 * commitment. `locked` is never sent as false on an existing row — that is
 * reopening, which is an admin's action and lives below.
 */
async function writeWeek(
  formData: FormData,
  { submit }: { submit: boolean },
): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const parsed = weeklyTargetsSchema.safeParse(weeklyFormDataToInput(formData));
  if (!parsed.success) {
    return {
      error: "Please check the highlighted numbers.",
      fieldErrors: weeklyFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;

  // A commitment is a promise about the week ahead or the week in hand. Letting
  // someone submit a week that has not started yet is fine; letting them submit
  // one years out is not, and the picker cannot reach it anyway.
  if (isFutureWeek(input.week_start) && submit) {
    const weeksAhead =
      (new Date(`${input.week_start}T00:00:00Z`).getTime() - Date.now()) /
      (7 * 86_400_000);
    if (weeksAhead > 8) {
      return {
        error: "You can only commit to a week within the next couple of months.",
        fieldErrors: {},
      };
    }
  }

  const payload: Record<string, unknown> = {
    member: user.id,
    week_start: input.week_start,
  };
  for (const key of METRIC_KEYS) payload[key] = input[key];
  if (submit) payload.locked = true;

  const { error } = await supabase
    .from("weekly_targets")
    .upsert(payload, { onConflict: "member,week_start" });

  if (error) {
    logError(submit ? "weekly:submit" : "weekly:save", error);
    return {
      error: mapLockError(
        error,
        submit
          ? "We could not submit this week. Please try again."
          : "We could not save these numbers. Please try again.",
      ),
      fieldErrors: {},
    };
  }

  revalidatePath("/weekly");
  revalidatePath("/");
  return { error: null, fieldErrors: {}, ok: true };
}

export async function saveWeeklyTargets(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return writeWeek(formData, { submit: false });
}

export async function submitWeeklyTargets(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return writeWeek(formData, { submit: true });
}

/**
 * Rule 6's other half: an admin reopens a locked week so the rep can revise it.
 *
 * Checked here so a rep gets a sentence rather than a rejection, and checked
 * again by the trigger, which is what actually stops a rep who reaches the
 * action directly. reopened_by and reopened_at are stamped by the trigger from
 * auth.uid(), never sent from here.
 */
export async function reopenWeek(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }
  if (user.role !== "admin" || user.profileStatus !== "ready") {
    return { error: "Only an admin can reopen a week.", fieldErrors: {} };
  }

  const parsed = reopenSchema.safeParse({
    member: String(formData.get("member") ?? ""),
    week_start: String(formData.get("week_start") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: "We could not tell which week to reopen.",
      fieldErrors: weeklyFieldErrors(parsed.error),
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("weekly_targets")
    .update({ locked: false })
    .eq("member", parsed.data.member)
    .eq("week_start", parsed.data.week_start)
    .eq("locked", true)
    .select("id");

  if (error) {
    logError("weekly:reopen", error);
    return {
      error: mapLockError(error, "We could not reopen that week. Please try again."),
      fieldErrors: {},
    };
  }

  if (!data || data.length === 0) {
    return {
      error: "That week is not locked, so there is nothing to reopen.",
      fieldErrors: {},
    };
  }

  revalidatePath("/weekly");
  revalidatePath("/");
  return { error: null, fieldErrors: {}, ok: true };
}
