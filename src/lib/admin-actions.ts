"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, selectPhotosUpTo } from "@/lib/admin";
import { ensureAreas, ensureCity, ensureState } from "@/lib/locations";
import { logError, toFriendlyMessage } from "@/lib/errors";
import type {
  AdminState,
  FlushState,
  MemberState,
} from "@/lib/admin-form-state";
import {
  areaSchema,
  citySchema,
  fieldErrorsFrom,
  flushSchema,
  newMemberSchema,
  purposeSchema,
  removeSchema,
  stateSchema,
  textOf,
} from "@/lib/validation/admin";

/**
 * Everything an admin can change, and nothing a rep can.
 *
 * Every action starts with requireAdmin(). That check is not the only defence:
 * purposes, states and cities are all behind RLS policies keyed on is_admin(),
 * and the profile role guard trigger refuses an admin profile created by a
 * non-admin. The check exists so an admin-only action fails with a sentence
 * instead of a policy rejection — and so the two disagree loudly if they ever
 * drift, rather than silently opening up.
 */

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function denied(error: string): AdminState {
  return { error, fieldErrors: {} };
}

/* ------------------------------------------------------------------ */
/* Purposes                                                            */
/* ------------------------------------------------------------------ */

export async function addPurpose(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = purposeSchema.safeParse({ label: textOf(formData, "label") });
  if (!parsed.success) {
    return {
      error: "Please check the highlighted field.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const { error } = await gate.supabase
    .from("purposes")
    .insert({ label: parsed.data.label });

  if (error) {
    logError("admin:purpose-add", error);
    if (error.code === UNIQUE_VIOLATION) {
      return denied("That purpose is already on the list.");
    }
    return denied(toFriendlyMessage(error, "We could not add that purpose."));
  }

  revalidatePath("/settings");
  revalidatePath("/");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message: `Added “${parsed.data.label}”.`,
  };
}

/* ------------------------------------------------------------------ */
/* Locations                                                           */
/* ------------------------------------------------------------------ */

/**
 * Adding a location goes through the same find-or-create helpers the PIN lookup
 * uses, so an admin typing "Bangalore" lands on the existing Bengaluru instead
 * of creating the duplicate spelling Phase 4 was spent removing.
 */
export async function addState(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = stateSchema.safeParse({ name: textOf(formData, "name") });
  if (!parsed.success) {
    return {
      error: "Please check the highlighted field.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const row = await ensureState(gate.supabase, parsed.data.name);
  if (!row) return denied("We could not add that state.");

  revalidatePath("/settings");
  revalidatePath("/institutes/new");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message:
      row.name.toLowerCase() === parsed.data.name.trim().toLowerCase()
        ? `Added ${row.name}.`
        : `That is ${row.name} here — using the existing entry.`,
  };
}

export async function addCity(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = citySchema.safeParse({
    state_id: textOf(formData, "state_id"),
    name: textOf(formData, "name"),
  });
  if (!parsed.success) {
    return {
      error: "Please check the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const row = await ensureCity(gate.supabase, parsed.data.state_id, parsed.data.name);
  if (!row) return denied("We could not add that city.");

  revalidatePath("/settings");
  revalidatePath("/institutes/new");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message:
      row.name.toLowerCase() === parsed.data.name.trim().toLowerCase()
        ? `Added ${row.name}.`
        : `That is ${row.name} here — using the existing entry.`,
  };
}

export async function addArea(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = areaSchema.safeParse({
    city_id: textOf(formData, "city_id"),
    name: textOf(formData, "name"),
  });
  if (!parsed.success) {
    return {
      error: "Please check the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const before = await ensureAreas(gate.supabase, parsed.data.city_id, []);
  const after = await ensureAreas(gate.supabase, parsed.data.city_id, [
    parsed.data.name,
  ]);

  revalidatePath("/settings");
  revalidatePath("/institutes/new");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message:
      after.length > before.length
        ? `Added ${parsed.data.name}.`
        : `${parsed.data.name} is already on the list.`,
  };
}

/**
 * Removing a purpose, or a branch of the location tree.
 *
 * States and cities cascade to their children in the database, so the
 * confirmation in the UI is what tells the admin how much is about to go. This
 * action does not re-check the child count: between rendering and confirming
 * the tree could have changed, and quietly refusing would be more confusing
 * than doing what was asked.
 */
export async function removeEntry(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = removeSchema.safeParse({
    kind: textOf(formData, "kind"),
    id: textOf(formData, "id"),
  });
  if (!parsed.success) return denied("We could not tell what to remove.");

  const table = {
    purpose: "purposes",
    state: "location_states",
    city: "location_cities",
    area: "location_areas",
  }[parsed.data.kind];

  const { error, count } = await gate.supabase
    .from(table)
    .delete({ count: "exact" })
    .eq("id", parsed.data.id);

  if (error) {
    logError("admin:remove", error);
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return denied("Something still refers to that, so it cannot be removed.");
    }
    return denied(toFriendlyMessage(error, "We could not remove that."));
  }

  if (!count) return denied("That entry was already gone.");

  revalidatePath("/settings");
  revalidatePath("/institutes/new");
  revalidatePath("/");
  return { error: null, fieldErrors: {}, ok: true, message: "Removed." };
}

/* ------------------------------------------------------------------ */
/* Team accounts                                                       */
/* ------------------------------------------------------------------ */

/**
 * Creating a team member.
 *
 * The one place in the app that genuinely needs the service-role key: there is
 * no other way to create an auth user, and no self-signup by design. The key is
 * only reachable through `@/lib/supabase/admin`, which imports `server-only`, so
 * it cannot be pulled into a client bundle even by accident.
 *
 * The email is confirmed on creation. Without that, Supabase leaves the account
 * unconfirmed and every sign-in attempt returns the same "Invalid email or
 * password" as a wrong password — a trap that would have the admin re-issuing
 * passwords for an account that was never the problem.
 */
export async function createMember(
  _prev: MemberState,
  formData: FormData,
): Promise<MemberState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = newMemberSchema.safeParse({
    name: textOf(formData, "name"),
    email: textOf(formData, "email"),
    password: textOf(formData, "password"),
    role: textOf(formData, "role"),
  });
  if (!parsed.success) {
    return {
      error: "Please check the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }
  const input = parsed.data;

  const db = createAdminClient();
  const { data, error } = await db.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });

  if (error || !data?.user) {
    logError("admin:create-user", error);
    const code = error?.code ?? "";
    if (code === "email_exists" || error?.status === 422) {
      return denied("An account with that email already exists.");
    }
    if (code === "weak_password") {
      return denied("That password is too easy to guess. Try a longer one.");
    }
    return denied("We could not create that account. Please try again.");
  }

  // The profile is written as the admin, not as the service role, so the RLS
  // policy and the role-guard trigger both still apply.
  const { error: profileError } = await gate.supabase.from("profiles").insert({
    id: data.user.id,
    name: input.name,
    role: input.role,
  });

  if (profileError) {
    logError("admin:create-profile", profileError);
    // Roll the auth user back rather than leave an account that can sign in but
    // has no profile — which would land them in the app with no role at all.
    const { error: cleanupError } = await db.auth.admin.deleteUser(data.user.id);
    if (cleanupError) logError("admin:create-rollback", cleanupError);
    return denied(
      "The account was not created. Please try again, or check whether that person already has one.",
    );
  }

  revalidatePath("/settings");
  revalidatePath("/");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    created: { name: input.name, email: input.email, role: input.role },
  };
}

/* ------------------------------------------------------------------ */
/* Photo flush                                                         */
/* ------------------------------------------------------------------ */

/** Storage takes a list per call; keep each one modest. */
const REMOVE_BATCH = 100;

/**
 * Deleting photos early, on demand.
 *
 * The nightly job in migration 0003 clears anything past 30 days; this is for
 * the client's stated habit of not wanting them after about a week. Same rule
 * as the nightly job: delete the FILES through the Storage API, never the
 * storage.objects rows, and never touch the visits. A visit whose photo has
 * gone keeps its photo_url, its coordinates and its timestamp — the row is the
 * record, the picture was only ever the evidence.
 *
 * Two intents through one action: "count" answers "how many?", "delete" does
 * it. The count is taken again during the delete, so the number reported is
 * what actually happened rather than what was promised a minute earlier.
 */
export async function flushPhotos(
  _prev: FlushState,
  formData: FormData,
): Promise<FlushState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = flushSchema.safeParse({
    cutoff: textOf(formData, "cutoff"),
    intent: textOf(formData, "intent"),
  });
  if (!parsed.success) {
    return {
      error: "Please choose a date first.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }
  const { cutoff, intent } = parsed.data;

  let selection;
  try {
    selection = await selectPhotosUpTo(cutoff);
  } catch (error) {
    return denied(toFriendlyMessage(error, "We could not check the photos."));
  }

  if (intent === "count") {
    return {
      error: null,
      fieldErrors: {},
      count: selection.paths.length,
      cutoff,
    };
  }

  if (selection.paths.length === 0) {
    return { error: null, fieldErrors: {}, ok: true, deleted: 0, cutoff };
  }

  let deleted = 0;
  for (let i = 0; i < selection.paths.length; i += REMOVE_BATCH) {
    const batch = selection.paths.slice(i, i + REMOVE_BATCH);
    // Deleted as the admin: the storage policy allows an admin to remove any
    // member's photo, so RLS is still the thing granting this.
    const { data, error } = await gate.supabase.storage
      .from("visit-photos")
      .remove(batch);

    if (error) {
      logError("admin:flush", error);
      return {
        error:
          deleted > 0
            ? `${deleted} photo${deleted === 1 ? "" : "s"} were deleted before this failed. Try again to finish.`
            : "We could not delete those photos. Please try again.",
        fieldErrors: {},
        deleted,
        cutoff,
      };
    }
    deleted += data?.length ?? 0;
  }

  revalidatePath("/settings");
  return { error: null, fieldErrors: {}, ok: true, deleted, cutoff };
}
