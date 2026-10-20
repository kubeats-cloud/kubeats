"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { logError, toFriendlyMessage } from "@/lib/errors";
import { targetStatusSchema } from "@/lib/validation/target-statuses";
import type { AdminState } from "@/lib/admin-form-state";

const UNIQUE_VIOLATION = "23505";

function denied(error: string): AdminState {
  return { error, fieldErrors: {} };
}

/**
 * Admin #8 / Rep #2 — add a target status.
 *
 * `requireAdmin()` is the sentence; `target_statuses_insert`'s `is_admin()`
 * check (migration 0045) is the actual boundary, same two-lock pattern
 * every other admin-only action in this app uses, so a rep calling this
 * directly fails with a policy error rather than a UI gap.
 */
export async function addTargetStatus(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const raw = formData.get("name");
  const parsed = targetStatusSchema.safeParse({
    name: typeof raw === "string" ? raw : "",
  });
  if (!parsed.success) {
    return denied(parsed.error.issues[0]?.message ?? "That name is not valid.");
  }

  const { error } = await gate.supabase
    .from("target_statuses")
    .insert({ name: parsed.data.name });

  if (error) {
    logError("target-statuses:add", error);
    if (error.code === UNIQUE_VIOLATION) {
      return denied("A target status with that name already exists.");
    }
    return denied(toFriendlyMessage(error, "We could not add that status."));
  }

  // Uncached read, so a rep's next request already sees it — see
  // listTargetStatuses()'s own comment.
  revalidatePath("/targets");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message: `Added “${parsed.data.name}”.`,
  };
}
