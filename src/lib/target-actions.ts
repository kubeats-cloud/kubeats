"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { logError, toFriendlyMessage } from "@/lib/errors";
import type { FormState } from "@/lib/visit-form-state";
import {
  METRIC_KEYS,
  reopenSchema,
  targetsFormDataToInput,
  targetsSchema,
  weeklyFieldErrors,
} from "@/lib/validation/weekly";
import { isFuturePeriod, shiftPeriod, type TargetPeriod } from "@/lib/periods";

/**
 * Rule 6 — the target lock, now for all three periods.
 *
 * The trigger on public.targets is the authority: it refuses any edit to a
 * locked period, allows only an admin to unlock one, and stamps submitted_at
 * and reopened_by/reopened_at itself so the audit trail cannot be forged from
 * the client. Everything here exists to turn those refusals into sentences.
 *
 * The rule is deliberately the same for a day, a week and a month. Submitting
 * is opt-in — saving a draft never locks anything — so a rep only locks a day
 * if they mean to, and one rule is one thing to reason about instead of three.
 */

const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

const LOCKED_MESSAGE =
  "This period is locked. Ask an admin to reopen it before making changes.";

/** How far ahead a rep may commit, per period. Beyond this is a typo, not a plan. */
const MAX_AHEAD: Record<TargetPeriod, number> = {
  daily: 31,
  weekly: 8,
};

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

/** How many whole periods `periodStart` sits ahead of the current one. */
function periodsAhead(period: TargetPeriod, periodStart: string): number {
  let cursor = shiftPeriod(period, periodStart, 0);
  for (let steps = 0; steps <= MAX_AHEAD[period] + 1; steps += 1) {
    if (!isFuturePeriod(period, cursor)) return steps;
    cursor = shiftPeriod(period, cursor, -1);
  }
  return MAX_AHEAD[period] + 1;
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
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const parsed = targetsSchema.safeParse(targetsFormDataToInput(formData));
  if (!parsed.success) {
    return {
      error: "Please check the highlighted numbers.",
      fieldErrors: weeklyFieldErrors(parsed.error),
    };
  }
  const input = parsed.data;

  // A commitment is a promise about the period ahead or the one in hand.
  // Committing to something a little ahead is fine; committing years out is
  // not, and the picker cannot reach it anyway.
  if (submit && isFuturePeriod(input.period, input.period_start)) {
    if (periodsAhead(input.period, input.period_start) > MAX_AHEAD[input.period]) {
      return {
        error: "You can only commit to a period in the near future.",
        fieldErrors: {},
      };
    }
  }

  const payload: Record<string, unknown> = {
    member: user.id,
    period: input.period,
    period_start: input.period_start,
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
          ? "We could not submit this period. Please try again."
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
 * Rule 6's other half: an admin reopens a locked period so the rep can revise
 * it.
 *
 * Checked here so a rep gets a sentence rather than a rejection, and checked
 * again by the trigger, which is what actually stops a rep who reaches the
 * action directly. reopened_by and reopened_at are stamped by the trigger from
 * auth.uid(), never sent from here.
 */
export async function reopenPeriod(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }
  if (user.role !== "admin" || user.profileStatus !== "ready") {
    return { error: "Only an admin can reopen a period.", fieldErrors: {} };
  }

  const parsed = reopenSchema.safeParse({
    member: String(formData.get("member") ?? ""),
    period: String(formData.get("period") ?? ""),
    period_start: String(formData.get("period_start") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: "We could not tell which period to reopen.",
      fieldErrors: weeklyFieldErrors(parsed.error),
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("targets")
    .update({ locked: false })
    .eq("member", parsed.data.member)
    .eq("period", parsed.data.period)
    .eq("period_start", parsed.data.period_start)
    .eq("locked", true)
    .select("id");

  if (error) {
    logError("targets:reopen", error);
    return {
      error: mapLockError(error, "We could not reopen that period. Please try again."),
      fieldErrors: {},
    };
  }

  if (!data || data.length === 0) {
    return {
      error: "That period is not locked, so there is nothing to reopen.",
      fieldErrors: {},
    };
  }

  revalidatePath("/targets");
  revalidatePath("/");
  return { error: null, fieldErrors: {}, ok: true };
}
