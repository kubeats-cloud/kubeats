"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, type AdminGate } from "@/lib/admin";
import { logError, toFriendlyMessage } from "@/lib/errors";
import {
  targetStatusCampusSchema,
  targetStatusSchema,
} from "@/lib/validation/target-statuses";
import type { AdminState } from "@/lib/admin-form-state";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHOOSE_LISTED_CAMPUS = "Choose one of the listed campuses.";

function denied(error: string): AdminState {
  return { error, fieldErrors: {} };
}

/**
 * Null (every campus) always passes; a real id must name one of the
 * campuses currently ACTIVE.
 *
 * A SEPARATE COPY of campusIsActiveOrAll() in admin-actions.ts, for the same
 * reason the schema above duplicates its campusIdField rather than sharing
 * one — target_statuses is its own vocabulary and its own part of this
 * feature. target_statuses.campus_id's FOREIGN KEY (0066) catches a campus
 * that does not exist at all, but not one that exists and has been
 * deactivated, so this is the one place that asks the live question.
 */
async function campusIsActiveOrAll(
  supabase: AdminGate["supabase"],
  campusId: string | null,
): Promise<boolean> {
  if (campusId === null) return true;
  const { data, error } = await supabase
    .from("campuses")
    .select("id")
    .eq("id", campusId)
    .eq("active", true)
    .maybeSingle();
  return !error && data !== null;
}

/**
 * Admin #8 / Rep #2 — add a target status.
 *
 * `requireAdmin()` is the sentence; `target_statuses_insert`'s `is_admin()`
 * check (migration 0045) is the actual boundary, same two-lock pattern
 * every other admin-only action in this app uses, so a rep calling this
 * directly fails with a policy error rather than a UI gap.
 *
 * `campus_id` (migration 0066) defaults to every campus on the form, same
 * reasoning `addStatus()` gives for institute_statuses: a target status
 * scoped to one campus by accident would silently empty every other
 * campus's list with nothing on screen to explain why.
 */
export async function addTargetStatus(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const raw = formData.get("name");
  const rawCampus = formData.get("campus_id");
  const parsed = targetStatusSchema.safeParse({
    name: typeof raw === "string" ? raw : "",
    campus_id: typeof rawCampus === "string" ? rawCampus : "",
  });
  if (!parsed.success) {
    return denied(parsed.error.issues[0]?.message ?? "That name is not valid.");
  }

  if (!(await campusIsActiveOrAll(gate.supabase, parsed.data.campus_id))) {
    return denied(CHOOSE_LISTED_CAMPUS);
  }

  const { error } = await gate.supabase
    .from("target_statuses")
    .insert({ name: parsed.data.name, campus_id: parsed.data.campus_id });

  if (error) {
    logError("target-statuses:add", error);
    if (error.code === UNIQUE_VIOLATION) {
      return denied("A target status with that name already exists.");
    }
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return denied(CHOOSE_LISTED_CAMPUS);
    }
    return denied(toFriendlyMessage(error, "We could not add that status."));
  }

  // Uncached read, so a rep's next request already sees it — see
  // listTargetStatusRows()'s own comment.
  revalidatePath("/targets");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message: `Added “${parsed.data.name}”.`,
  };
}

/**
 * Re-scope an existing target status to another campus, or back to every
 * campus.
 *
 * THIS IS THE ONLY WAY A TARGET STATUS IS EVER UPDATED. 0047 granted no
 * UPDATE at all — "renaming or removing a target status was not asked for" —
 * and that is still true for the name; 0066 opens exactly one door
 * (target_statuses_update, admin-gated) and this is the only caller, sending
 * campus_id and nothing else.
 */
export async function setTargetStatusCampus(
  name: string,
  campusId: string | null,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = targetStatusCampusSchema.safeParse({ name, campus_id: campusId });
  if (!parsed.success) {
    return denied(parsed.error.issues[0]?.message ?? "That status could not be identified.");
  }

  if (!(await campusIsActiveOrAll(gate.supabase, parsed.data.campus_id))) {
    return denied(CHOOSE_LISTED_CAMPUS);
  }

  const { error } = await gate.supabase
    .from("target_statuses")
    .update({ campus_id: parsed.data.campus_id })
    .eq("name", parsed.data.name);

  if (error) {
    logError("target-statuses:campus", error);
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return denied(CHOOSE_LISTED_CAMPUS);
    }
    return denied(toFriendlyMessage(error, "We could not change that status's campus."));
  }

  revalidatePath("/targets");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message:
      parsed.data.campus_id === null
        ? `“${parsed.data.name}” is visible to every campus again.`
        : `“${parsed.data.name}” is now scoped to one campus.`,
  };
}
