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
  statusRenameSchema,
  statusSchema,
  statusUpdateSchema,
  stateSchema,
  textOf,
} from "@/lib/validation/admin";
import { CHECK_FIELD, CHECK_FIELDS } from "@/lib/visit-form-state";

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
/* Statuses                                                            */
/* ------------------------------------------------------------------ */

/**
 * What an admin is told when a foreign key refuses to move a status.
 *
 * 23503 here does not mean "something is missing" — it means the OPPOSITE:
 * institutes, visits or history rows are pinned to this status, and 0026's
 * `on update restrict on delete restrict` will not let it move out from under
 * them. `errors.ts`'s generic wording for the code ("Something this depends on
 * is missing, or it is still in use") is true but useless here, so this says
 * the actionable half instead.
 */
const STATUS_IN_USE =
  "That status is already recorded on visits, so it cannot be renamed. " +
  "Add the corrected one and retire this.";

/**
 * Add a status to the vocabulary.
 *
 * The whole reason this action can exist at all is migration 0026: while the
 * two status columns were CHECK constraints, a row inserted here would have
 * been accepted by the table and then refused by every institute and visit —
 * a status that inserts fine and can never be used. They are foreign keys now,
 * so the table IS the vocabulary and an INSERT is the whole of adding one.
 *
 * `sort_order` is not asked for and not accepted from the form. 0026 drops the
 * UNIQUE on it and gives it a default that puts a new status after the seeded
 * nine, which is the right answer often enough that asking would be a question
 * with no good basis for an answer.
 */
export async function addStatus(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = statusSchema.safeParse({
    status: textOf(formData, "status"),
    category: textOf(formData, "category"),
    tone: textOf(formData, "tone"),
    asks_expected_date: textOf(formData, "asks_expected_date") === "yes",
    asks_session_detail: textOf(formData, "asks_session_detail") === "yes",
    asks_head_count: textOf(formData, "asks_head_count") === "yes",
  });
  if (!parsed.success) {
    return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { error } = await gate.supabase.from("institute_statuses").insert({
    status: parsed.data.status,
    category: parsed.data.category,
    tone: parsed.data.tone,
    asks_expected_date: parsed.data.asks_expected_date,
    asks_session_detail: parsed.data.asks_session_detail,
    asks_head_count: parsed.data.asks_head_count,
  });

  if (error) {
    logError("admin:status-add", error);
    if (error.code === UNIQUE_VIOLATION) {
      return denied("A status with that name already exists.");
    }
    return denied(toFriendlyMessage(error, "We could not add that status."));
  }

  // Every screen that renders a badge or offers the picker reads the
  // vocabulary, and listStatusCatalogue() is deliberately uncached — so a
  // status added here is usable by a rep on their next request.
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message: `Added “${parsed.data.status}”.`,
  };
}

/**
 * Retire a status, or bring one back.
 *
 * RETIRING IS THE ONLY REMOVAL PATH, and that is a design decision rather than
 * a limitation. Deleting a status would erase what a past visit said, so 0026's
 * three foreign keys refuse it and 0027 grants no DELETE at all — not to an
 * admin, not for an unused status. One rule to learn, and no way to discover
 * the difference by losing something.
 *
 * Restoring is the same UPDATE pointed the other way. Without it, retiring by
 * mistake would be a dead end.
 */
export async function setStatusActive(
  status: string,
  isActive: boolean,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = statusUpdateSchema.safeParse({ status });
  if (!parsed.success) {
    return denied("That status could not be identified.");
  }

  const { error } = await gate.supabase
    .from("institute_statuses")
    .update({ is_active: isActive })
    .eq("status", parsed.data.status);

  if (error) {
    logError("admin:status-retire", error);
    return denied(
      toFriendlyMessage(
        error,
        isActive ? "We could not restore that status." : "We could not retire that status.",
      ),
    );
  }

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message: isActive
      ? `“${parsed.data.status}” is available again.`
      : `“${parsed.data.status}” is retired. Visits that already carry it are unchanged.`,
  };
}

/**
 * Rename a status — which works only while nothing has used it.
 *
 * THE FOREIGN KEYS DECIDE, not this function. `status` is the primary key of
 * `institute_statuses` and three tables reference it `on update restrict`, so
 * Postgres permits the rename of an unused status and refuses one in use with
 * 23503. That is exactly the rule worth having — the typo case is the only one
 * anybody actually hits, and rewriting what a past visit said is the thing to
 * prevent — and it costs no guard code at all.
 *
 * So this attempts the update and translates the refusal. It deliberately does
 * NOT pre-check usage: a check-then-act would race a visit being logged in
 * between, and the constraint is the authority either way.
 */
export async function renameStatus(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = statusRenameSchema.safeParse({
    status: textOf(formData, "status"),
    renameTo: textOf(formData, "rename_to"),
  });
  if (!parsed.success) {
    return { error: CHECK_FIELD, fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  if (parsed.data.status === parsed.data.renameTo) {
    return { error: null, fieldErrors: {}, ok: true, message: "Nothing to change." };
  }

  const { error } = await gate.supabase
    .from("institute_statuses")
    .update({ status: parsed.data.renameTo })
    .eq("status", parsed.data.status);

  if (error) {
    logError("admin:status-rename", error);
    if (error.code === FOREIGN_KEY_VIOLATION) return denied(STATUS_IN_USE);
    if (error.code === UNIQUE_VIOLATION) {
      return denied("A status with that name already exists.");
    }
    return denied(toFriendlyMessage(error, "We could not rename that status."));
  }

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message: `Renamed to “${parsed.data.renameTo}”.`,
  };
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

  const parsed = purposeSchema.safeParse({
    label: textOf(formData, "label"),
    activity: textOf(formData, "activity"),
  });
  if (!parsed.success) {
    return {
      error: CHECK_FIELD,
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  // The activity travels with the row from stage 2 on. It is what stage 3 reads
  // instead of the Activity selector, and what decides which weekly metric a
  // visit planned under this purpose feeds.
  const { error } = await gate.supabase
    .from("purposes")
    .insert({ label: parsed.data.label, activity: parsed.data.activity });

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
      error: CHECK_FIELD,
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
        : `That is ${row.name} here. We used the existing entry.`,
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
      error: CHECK_FIELDS,
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
        : `That is ${row.name} here. We used the existing entry.`,
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
      error: CHECK_FIELDS,
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
    campus_id: textOf(formData, "campus_id"),
  });
  if (!parsed.success) {
    return {
      error: CHECK_FIELDS,
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
  // FO021 says the same thing in the database; this is the copy that reaches
  // the admin as a sentence instead of a constraint rejection.
  const { error: profileError } = await gate.supabase.from("profiles").insert({
    id: data.user.id,
    name: input.name,
    role: input.role,
    campus_id: input.campus_id,
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
