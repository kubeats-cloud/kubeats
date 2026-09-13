"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { logError, toFriendlyMessage } from "@/lib/errors";
import { CHECK_NUMBERS } from "@/lib/visit-form-state";
import type { FormState } from "@/lib/visit-form-state";
import {
  METRIC_KEYS,
  reopenSchema,
  targetsFormDataToInput,
  targetsSchema,
  weeklyFieldErrors,
} from "@/lib/validation/weekly";
import { addWeeks, isFutureWeek } from "@/lib/weeks";

/**
 * Rule 6 — the weekly target lock.
 *
 * The trigger on public.targets is the authority: it refuses any edit to a
 * locked week, allows only an admin to unlock one, and stamps submitted_at and
 * reopened_by/reopened_at itself so the audit trail cannot be forged from the
 * client. Everything here exists to turn those refusals into sentences.
 *
 * Submitting is opt-in: saving a draft never locks anything, so a rep only
 * locks a week if they mean to.
 *
 * WHY EVERY WRITE PINS period = 'weekly'. The table is keyed by (member,
 * period, period_start) and its CHECK accepts 'daily' and 'monthly' too — the
 * shape 0013 built when a rep could commit to any of the three. Only the week
 * is offered now, so the period is not an input: it is a constant this file
 * supplies, which is why targetsSchema has no `period` field to validate. The
 * daily and monthly rows committed before stage 2 stay where they are.
 */

const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

/** The one period this app commits to. See the note above. */
const PERIOD = "weekly";

const LOCKED_MESSAGE =
  "This week is locked. Ask an admin to reopen it before making changes.";

/** How far ahead a rep may commit. Beyond this is a typo, not a plan. */
const MAX_WEEKS_AHEAD = 8;

function mapLockError(error: { code?: string }, fallback: string): string {
  if (error.code === CHECK_VIOLATION) return LOCKED_MESSAGE;
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    return "Only an admin can do that.";
  }
  return toFriendlyMessage(error, fallback);
}

/** How many whole weeks `weekStart` sits ahead of the current one. */
function weeksAhead(weekStart: string): number {
  let cursor = weekStart;
  for (let steps = 0; steps <= MAX_WEEKS_AHEAD + 1; steps += 1) {
    if (!isFutureWeek(cursor)) return steps;
    cursor = addWeeks(cursor, -1);
  }
  return MAX_WEEKS_AHEAD + 1;
}

/**
 * Saves the eight numbers, either as a working draft or as the final
 * commitment. `locked` is never sent as false on an existing row — that is
 * reopening, which is an admin's action and lives below.
 */
async function writeTargets(
  formData: FormData,
  { submit }: { submit: boolean },
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const parsed = targetsSchema.safeParse(targetsFormDataToInput(formData));
  if (!parsed.success) {
    return {
      error: CHECK_NUMBERS,
      fieldErrors: weeklyFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;

  // A commitment is a promise about the week ahead or the one in hand.
  // Committing to something a little ahead is fine; committing years out is
  // not, and the navigator cannot reach it anyway.
  if (
    submit &&
    isFutureWeek(input.week_start) &&
    weeksAhead(input.week_start) > MAX_WEEKS_AHEAD
  ) {
    return {
      error: "You can only commit to a week in the near future.",
      fieldErrors: {},
    };
  }

  const payload: Record<string, unknown> = {
    member: user.id,
    period: PERIOD,
    period_start: input.week_start,
  };
  for (const key of METRIC_KEYS) payload[key] = input[key];
  if (submit) payload.locked = true;

  const { error } = await supabase
    .from("targets")
    .upsert(payload, { onConflict: "member,period,period_start" });

  if (error) {
    logError(submit ? "targets:submit" : "targets:save", error);
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

  revalidatePath("/targets");
  revalidatePath("/");
  return { error: null, fieldErrors: {}, ok: true };
}

export async function saveTargets(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return writeTargets(formData, { submit: false });
}

export async function submitTargets(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return writeTargets(formData, { submit: true });
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
    .from("targets")
    .update({ locked: false })
    .eq("member", parsed.data.member)
    .eq("period", PERIOD)
    .eq("period_start", parsed.data.week_start)
    .eq("locked", true)
    .select("id");

  if (error) {
    logError("targets:reopen", error);
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

  revalidatePath("/targets");
  revalidatePath("/team");
  revalidatePath("/");
  return { error: null, fieldErrors: {}, ok: true };
}
