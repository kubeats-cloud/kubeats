"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { logError, toFriendlyMessage } from "@/lib/errors";
import type { AdminState } from "@/lib/admin-form-state";
import { slabSetSchema, validateSlabSet } from "@/lib/validation/slabs";

/**
 * Submitting and deciding admission slabs (change-doc: Slabs).
 *
 * ⚠ BOTH WRITES GO THROUGH AN RPC, and for opposite reasons.
 *
 *   save_slabs()    SECURITY INVOKER, so RLS applies inside it. It REPLACES one
 *                   scope's set in a single transaction, which is the only way
 *                   a contiguous cover can be edited at all: every sequence of
 *                   row-level writes passes through a state the rules forbid.
 *   decide_slabs()  SECURITY DEFINER with is_admin() first, because it writes a
 *                   `status` that FO035 refuses to everybody — the GUC it sets
 *                   is what tells the trigger the write came from there.
 *
 * ⚠ THE VALIDATION RUNS TWICE ON PURPOSE. The copy below turns a mistake into a
 * sentence beside the field; `save_slabs()` is what holds against a hand-rolled
 * request. The client asked for both, and `tests/unit/slabs.test.ts` keeps them
 * from drifting.
 */

function denied(error: string): AdminState {
  return { error, fieldErrors: {} };
}

const textOf = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

/**
 * The rep's submit: validate the whole set, then replace it.
 *
 * Anyone who can reach the institute may do this — a rep for their own, a team
 * lead for their reps', an admin for anyone — because that is exactly what
 * `institute_slabs_insert` already says. No role check here would add a
 * boundary; it would only add a second place for one to drift.
 */
export async function saveSlabs(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const user = await getCurrentUser();
  if (!user) return denied("Your session has expired. Please sign in again.");

  /*
   * The rows arrive as parallel lists — `start` and `end` repeated once per
   * row — which is what a plain form posts for a repeating group. Zipped here
   * rather than JSON in a hidden field, so the form still works with no
   * client-side state and the values a reader typed are the values sent.
   */
  const starts = formData.getAll("start").map(String);
  const ends = formData.getAll("end").map(String);

  const parsed = slabSetSchema.safeParse({
    institute_id: textOf(formData, "institute_id"),
    scope: textOf(formData, "scope"),
    college: textOf(formData, "college"),
    program: textOf(formData, "program"),
    slabs: starts.map((start, i) => ({ start, end: ends[i] ?? "" })),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Check the slabs and try again.",
      fieldErrors: {},
    };
  }

  const problems = validateSlabSet(parsed.data);
  if (problems.length > 0) {
    /*
     * EVERY problem, not the first, joined into one notice. A rep fixing a
     * six-row table one refusal at a time is the experience the validator
     * returns a list to avoid, and swallowing the rest here would undo that.
     */
    return {
      error: problems.map((p) => p.message).join(" "),
      fieldErrors: {},
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_slabs", {
    p_institute: parsed.data.institute_id,
    p_scope: parsed.data.scope,
    p_college: parsed.data.scope === "total" ? null : parsed.data.college,
    p_program: parsed.data.scope === "total" ? null : parsed.data.program,
    p_slabs: parsed.data.slabs.map((s) => ({ start: s.start, end: s.end })),
  });

  if (error) {
    logError("slabs:save", error);
    // FO036 and FO035 both already carry a sentence the rep can act on, so the
    // CODE is mapped and the database keeps the wording it got right — the rule
    // CLAUDE.md states for log_visit()'s FO001-FO009.
    if (error.code === "FO036" || error.code === "FO035") return denied(error.message);
    return denied(toFriendlyMessage(error, "We could not save these slabs."));
  }

  revalidatePath(`/institutes/${parsed.data.institute_id}`);
  return { ok: true, error: null, fieldErrors: {}, message: "Slabs submitted for approval." };
}

/**
 * The admin's decision: approve, reject, or REVOKE.
 *
 * ⚠ REVOKE IS A REJECT, and there is no fourth status. A revoked set is one the
 * rep must edit and resubmit, which is what rejected already means — so the UI
 * calls this with `rejected` either way and `decide_slabs()` refuses the
 * transition that would be a no-op ("already rejected"). Revoke is therefore
 * only ever reachable FROM approved, without a rule of its own.
 *
 * ⚠ ADMIN-ONLY BY DECISION. The brief asked for a team lead to approve their
 * own team's and the client chose otherwise. The gate here is for the message;
 * `decide_slabs()` tests is_admin() itself and is the boundary. Widening it
 * later is one predicate in that function — see 0044.
 */
export async function decideSlabs(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const user = await getCurrentUser();
  if (!user) return denied("Your session has expired. Please sign in again.");
  if (!isAdmin(user)) return denied("Only an admin can approve or reject slabs.");

  const institute = textOf(formData, "institute_id");
  const status = textOf(formData, "status");
  if (status !== "approved" && status !== "rejected") {
    return denied("That is not a decision.");
  }

  const scope = textOf(formData, "scope");
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_slabs", {
    p_institute: institute,
    p_scope: scope,
    p_college: scope === "total" ? null : textOf(formData, "college"),
    p_program: scope === "total" ? null : textOf(formData, "program"),
    p_status: status,
    p_note: textOf(formData, "note") || null,
  });

  if (error) {
    logError("slabs:decide", error);
    if (error.code === "FO037") return denied(error.message);
    return denied(toFriendlyMessage(error, "We could not record that decision."));
  }

  revalidatePath(`/institutes/${institute}`);
  return {
    ok: true,
    error: null,
    fieldErrors: {},
    message: status === "approved" ? "Slabs approved." : "Sent back to the rep.",
  };
}
