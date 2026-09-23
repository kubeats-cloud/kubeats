"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, selectPhotosUpTo } from "@/lib/admin";
import { ensureAreas, ensureCity, ensureState } from "@/lib/locations";
import { logError, toFriendlyMessage } from "@/lib/errors";
import type {
  AdminState,
  DeleteMemberState,
  FlushState,
  MemberState,
  MemberUpdateState,
} from "@/lib/admin-form-state";
import {
  areaSchema,
  citySchema,
  confirmationMatches,
  deleteMemberSchema,
  fieldErrorsFrom,
  flushSchema,
  memberCreatorSchema,
  memberUpdateSchema,
  newMemberSchema,
  purposeSchema,
  purposeUpdateSchema,
  reassignSchema,
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
/* Institute ownership                                                 */
/* ------------------------------------------------------------------ */

/**
 * Move an institute to another rep.
 *
 * THIS IS A PERMISSIONS CHANGE, not bookkeeping, and it is worth being blunt
 * about that here because the column it writes has spent its whole life being
 * the opposite. `registered_by` was an audit stamp from 0001; rep-owned
 * institutes make it the column `institutes_select` keys on, so moving it grants
 * one rep sight of an institute's whole pipeline — its detail, its status
 * journey, its row in Pending — and takes it from another.
 *
 * `guard_institute_owner()` (FO010) has always allowed an admin to do this and
 * always refused a rep, so nothing needed unlocking. What the migration adds is
 * where it may point: FO025 refuses a rep on another campus, and refuses the
 * move at all while the current owner is mid-visit at that institute.
 *
 * The same-campus rule is enforced twice on purpose — the picker only offers
 * reps on the institute's campus, and FO025 refuses anything else. The picker
 * is the courtesy; the trigger is the control.
 */
export async function reassignInstitute(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = reassignSchema.safeParse({
    institute_id: textOf(formData, "institute_id"),
    member: textOf(formData, "member"),
  });
  if (!parsed.success) {
    return { error: CHECK_FIELD, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { error } = await gate.supabase
    .from("institutes")
    .update({ registered_by: parsed.data.member })
    .eq("id", parsed.data.institute_id);

  if (error) {
    logError("admin:reassign-institute", error);
    // FO025 arrives with migration 0028. Mapped by CODE rather than message, so
    // the wording lives here and no database text reaches a screen.
    if (error.code === "FO025") {
      return denied(
        "That cannot be moved right now. Either the rep is not on this " +
          "institute's campus, or its current owner is part-way through a " +
          "visit there. Try again once they have finished.",
      );
    }
    if (error.code === "FO010") {
      return denied("Only an admin can change who an institute belongs to.");
    }
    return denied(toFriendlyMessage(error, "We could not reassign that institute."));
  }

  // The registry, the detail page and — once the policy narrows — both reps'
  // Pending all read this.
  revalidatePath("/institutes", "layout");
  revalidatePath("/pending");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message: "Reassigned. It now belongs to that rep.",
  };
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

/**
 * Add a purpose — which is choosing a weekly metric, and sometimes choosing
 * which END of one.
 *
 * THE LIFECYCLE IS WHY SESSION AND CAMPUS-VISIT PURPOSES COULD NOT BE ADDED AT
 * ALL. This action sent `label` and `activity` and nothing else, so
 * `purposes_lifecycle_matches_activity` (0025) refused every insert whose
 * activity was `session` or `campus_visit` with a bare 23514 that reached the
 * admin as "we could not add that purpose". Four of the eight weekly metrics —
 * Sessions Set, Sessions Done, Campus Visits Set, Campus Visits Done — are fed
 * only by such purposes, so the four seeded ones were all an admin would ever
 * have. It is sent now, and `purposeSchema` insists on it for exactly the two
 * activities the CHECK insists on it for.
 *
 * Null for the other four, and explicitly rather than by omission: 0025's CHECK
 * refuses a lifecycle on an activity that has none just as firmly as it demands
 * one on an activity that does.
 */
export async function addPurpose(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = purposeSchema.safeParse({
    label: textOf(formData, "label"),
    activity: textOf(formData, "activity"),
    lifecycle: textOf(formData, "lifecycle"),
  });
  if (!parsed.success) {
    return {
      error: CHECK_FIELDS,
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  // Both travel with the row from stage 2 on. `activity` is what stage 3 reads
  // instead of the Activity selector; `lifecycle` is what tells "Fix a session"
  // from "Complete a session", which map to the same activity and to opposite
  // ends of the weekly metrics.
  const { error } = await gate.supabase.from("purposes").insert({
    label: parsed.data.label,
    activity: parsed.data.activity,
    lifecycle: parsed.data.lifecycle,
  });

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

/**
 * Retire a purpose, or bring one back.
 *
 * RETIRING IS THE ONLY REMOVAL PATH, exactly as it is for a status — and here
 * the reason is arithmetic rather than history. `purposes` is the one thing that
 * decides which of the eight weekly metrics a visit counts toward, so deleting
 * the last purpose feeding one zeroes that metric for ever and NOTHING SAYS SO:
 * the week's numbers simply come in flat. 0025's assertion block refuses to
 * apply against a database where any metric has no active purpose behind it,
 * which is the same failure caught at the other end.
 *
 * It strands history too. `daily_plans.purpose_id` points at the row, and a rep
 * whose plan referenced a deleted purpose reaches `/log` with no mapping to
 * derive an activity from — the Activity selector that used to be the fallback
 * was deleted in stage 3, so there is none. `is_active = false` keeps the row
 * readable and merely stops offering it, which is the whole difference.
 *
 * Restoring is the same UPDATE pointed the other way. Without it, retiring by
 * mistake would be a dead end — and unlike a status, a purpose an admin retired
 * by accident silently stops a metric being earnable.
 */
export async function setPurposeActive(
  id: string,
  isActive: boolean,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = purposeUpdateSchema.safeParse({ id });
  if (!parsed.success) {
    return denied("That purpose could not be identified.");
  }

  const { error } = await gate.supabase
    .from("purposes")
    .update({ is_active: isActive })
    .eq("id", parsed.data.id);

  if (error) {
    logError("admin:purpose-retire", error);
    return denied(
      toFriendlyMessage(
        error,
        isActive
          ? "We could not restore that purpose."
          : "We could not retire that purpose.",
      ),
    );
  }

  // listPurposes() filters on is_active and is what the Dashboard's planner
  // reads, so both the panel and every rep's picker have to be re-rendered.
  revalidatePath("/settings");
  revalidatePath("/");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message: isActive
      ? "That purpose is available again."
      : "Retired. Plans that already used it are unchanged.",
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
 * Removing a branch of the location tree.
 *
 * NOT A PURPOSE. This used to take one, and deleting a purpose is the one
 * removal on this screen that quietly changes what the weekly numbers mean —
 * see REMOVABLE in validation/admin.ts. Retiring is `setPurposeActive()` above.
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

  // `purpose` was a fourth entry here and is gone — see REMOVABLE in
  // validation/admin.ts for why a purpose is retired and never deleted.
  // removeSchema refuses the kind before this map is reached; the map simply
  // has nowhere to send it either.
  const table = {
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

  /*
   * `createAdminClient()` throws when SUPABASE_SERVICE_ROLE_KEY is missing or
   * malformed — a deployment fault, but an uncaught one here leaves the form
   * and lands on the error boundary, which tells the admin nothing and loses
   * what they typed. Caught so it reads as a refusal like every other failure
   * on this screen. Same guard as admin.ts and mfa-admin.ts.
   */
  let db;
  try {
    db = createAdminClient();
  } catch (error) {
    logError("admin:create-user-client", error);
    return denied(
      "Accounts cannot be created right now — the server is missing a setting. Please tell whoever set the app up.",
    );
  }

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
    /*
     * WHO MADE THIS ACCOUNT — migration 0034, and the only place in the app
     * that writes it without being asked.
     *
     * Free to stamp here precisely because this insert already runs as the
     * ADMIN rather than as the service role (see the comment above it): FO028
     * refuses a non-admin writing the column, and `gate.user.id` is by
     * definition the admin that check just passed. Stamping it from the
     * service-role client instead would have had to choose an id to write,
     * which is how a record becomes a guess.
     *
     * A RECORD, NOT A PERMISSION. Nothing reads this to decide what anyone may
     * see; it feeds the hierarchy screen and nothing else.
     */
    created_by: gate.user.id,
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

/**
 * Editing a team member: their NAME and their CAMPUS, and nothing else.
 *
 * See `memberUpdateSchema` for why email, password, id and role are all absent;
 * each is a decision of its own rather than a field beside a name.
 *
 * TWO WRITES, AND THEY ARE NOT THE SAME KIND OF WRITE. That asymmetry is the
 * whole shape of this action:
 *
 *   THE NAME is a label. Nothing reads it to decide anything, `profiles_update`
 *            already lets an admin write it, and a plain update is the whole
 *            job.
 *   THE CAMPUS is a security boundary. `institutes_select` (0028) is
 *            `campus_id = my_campus() and registered_by = auth.uid()` — a
 *            strict AND — so moving a rep between campuses without moving the
 *            institutes they own makes every one of them invisible to them.
 *            That needs two tables in one transaction, which is
 *            `correct_member_campus()` (0035), and it needs to be refused while
 *            the rep is mid-visit, which that function does.
 *
 * SO THE NAME GOES FIRST, and the order matters. If the campus half is refused
 * — the likely refusal being a rep part-way through a visit — a rename the
 * admin also asked for has already landed and is reported, rather than being
 * silently rolled back along with it. Two independent edits, two independent
 * outcomes; conflating them would mean a typo in a name could not be fixed
 * until the rep got back to the office.
 *
 * THE CAMPUS IS ONLY TOUCHED WHEN IT CHANGES. An admin editing a name should
 * not trip the mid-visit refusal, and re-sending the campus a rep already has
 * would do exactly that.
 */
export async function updateMember(
  _prev: MemberUpdateState,
  formData: FormData,
): Promise<MemberUpdateState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = memberUpdateSchema.safeParse({
    member: textOf(formData, "member"),
    name: textOf(formData, "name"),
    campus_id: textOf(formData, "campus_id"),
    role: textOf(formData, "role"),
    // A checkbox that is not ticked is absent from FormData entirely, so this
    // reads "was it sent" rather than trusting a value. The form sends "on".
    retag: formData.get("retag") !== null,
  });
  if (!parsed.success) {
    return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  const input = parsed.data;

  /*
   * THE ROLE AND THE CURRENT CAMPUS COME FROM THE DATABASE, NEVER FROM THE FORM.
   *
   * The form sends a role so the schema can apply FO021's conditional rule
   * without a round trip, but trusting it would let a tampered submission claim
   * a rep is an admin and slip past the campus requirement. Read here, compared
   * below, and a disagreement is a refusal.
   */
  const { data: current, error: lookupError } = await gate.supabase
    .from("profiles")
    .select("id, role, campus_id")
    .eq("id", input.member)
    .maybeSingle();

  if (lookupError) {
    logError("admin:update-member-lookup", lookupError);
    return denied(toFriendlyMessage(lookupError, "We could not read that account."));
  }
  if (!current) return denied("That person no longer has an account.");

  if (current.role !== input.role) {
    // Not an error the admin can act on so much as a stale screen. Roles are
    // not editable here, so the two can only disagree if somebody else changed
    // it or the form was tampered with.
    return denied(
      "That account's role has changed since this screen loaded. Reopen Settings and try again.",
    );
  }

  const { error: nameError } = await gate.supabase
    .from("profiles")
    .update({ name: input.name })
    .eq("id", input.member);

  if (nameError) {
    logError("admin:update-member-name", nameError);
    return denied(toFriendlyMessage(nameError, "We could not save that name."));
  }

  // A rename on its own, or an admin (who has no campus to correct).
  const campusChanged =
    input.campus_id !== null && input.campus_id !== current.campus_id;

  if (!campusChanged) {
    revalidatePath("/settings");
    revalidatePath("/team/hierarchy");
    revalidatePath("/");
    return {
      error: null,
      fieldErrors: {},
      ok: true,
      updated: { name: input.name, campus: null, institutesMoved: 0 },
    };
  }

  const { data: receipt, error: campusError } = await gate.supabase.rpc(
    "correct_member_campus",
    {
      p_member: input.member,
      p_campus: input.campus_id,
      p_retag: input.retag,
    },
  );

  if (campusError) {
    logError("admin:correct-member-campus", campusError);
    /*
     * BY CODE, NEVER BY MESSAGE TEXT — and FO029 covers five refusals, only one
     * of which an admin will ever meet. The database's own wording names it,
     * but no database wording reaches a screen, so the one worth phrasing is
     * phrased here and the rest fall back to errors.ts.
     *
     * The mid-visit case is singled out because it is the only one that is
     * TEMPORARY: "wait until they have finished" is something an admin can act
     * on, where the others mean the request was wrong. We cannot tell which
     * FO029 it was without reading the message, so the sentence covers the
     * likely case and stays true for the others by naming what to check.
     */
    if (campusError.code === "FO029") {
      return {
        error:
          "The name was saved, but the campus was not. Either that rep is " +
          "part-way through a visit — try again once they have finished — or " +
          "that campus is not one they can be posted to.",
        fieldErrors: {},
      };
    }
    if (campusError.code === "42501") {
      return denied("Only an admin can change which campus a rep works from.");
    }
    return {
      error: toFriendlyMessage(
        campusError,
        "The name was saved, but the campus could not be changed.",
      ),
      fieldErrors: {},
    };
  }

  const result = (receipt ?? {}) as { campus?: string; institutes_moved?: number };

  // Everything a campus decides: the registry, Pending, the daily-plan picker
  // and the admin's own team list.
  revalidatePath("/settings");
  revalidatePath("/team/hierarchy");
  revalidatePath("/institutes", "layout");
  revalidatePath("/pending");
  revalidatePath("/");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    updated: {
      name: input.name,
      campus: result.campus ?? null,
      // The number the function actually moved, not the one the dialog showed.
      institutesMoved: result.institutes_moved ?? 0,
    },
  };
}

/**
 * Recording who created an account that predates migration 0034.
 *
 * THE ONLY WAY A created_by IS EVER WRITTEN BY HAND, and it exists because
 * 0034 deliberately backfills nothing. Before that column there was no record
 * anywhere — not in `created_at`, not in an audit row — of which admin opened
 * an account, so a backfill could only have invented one. The ~39 accounts that
 * already existed therefore start null, and an admin who knows the answer
 * supplies it from the hierarchy screen.
 *
 * A RECORD, NOT A PERMISSION. Worth stating in the one action that writes this
 * column freely, because the last column to look like this — `registered_by`,
 * which `reassignInstitute()` above writes — turned out to decide who can see
 * an institute, and its action carries a warning to that effect. This one
 * decides nothing. No policy, trigger or query reads `created_by`; changing it
 * moves a node on a chart and grants nobody anything.
 *
 * THE ROLE CHECKS ARE COURTESIES, FO028 IS THE CONTROL — the same division as
 * every other admin action in this file. The picker only offers admins, this
 * re-asks so a tampered form gets a sentence rather than a database code, and
 * the trigger refuses it regardless. The lookup is ONE query for both ids
 * rather than two: they come from the same table and a round trip is a round
 * trip.
 */
export async function setMemberCreator(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = memberCreatorSchema.safeParse({
    member: textOf(formData, "member"),
    created_by: textOf(formData, "created_by"),
  });
  if (!parsed.success) {
    return { error: CHECK_FIELD, fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  const { member, created_by: creator } = parsed.data;

  const { data: rows, error: lookupError } = await gate.supabase
    .from("profiles")
    .select("id, name, role")
    .in("id", [member, creator]);

  if (lookupError) {
    logError("admin:member-creator-lookup", lookupError);
    return denied(
      toFriendlyMessage(lookupError, "We could not check those two accounts."),
    );
  }

  const target = (rows ?? []).find((row) => row.id === member);
  const admin = (rows ?? []).find((row) => row.id === creator);

  // Both must be real. A missing target would otherwise be an update that
  // matches no row and then reports success — the failure mode reassignInstitute
  // avoids by taking the current owner out of its picker.
  if (!target) return denied("That person no longer has an account.");
  if (!admin) return denied("That admin no longer has an account.");

  // FO028's rep-parent refusal, asked here so it arrives as a sentence. See
  // 0034's header for why a rep parent is refused at all: it is what keeps the
  // model flat rather than letting this become a reports-to chain.
  if (admin.role !== "admin") {
    return denied(
      `${admin.name ?? "That person"} is a rep. Only an admin can have created an account.`,
    );
  }

  const { error } = await gate.supabase
    .from("profiles")
    .update({ created_by: creator })
    .eq("id", member);

  if (error) {
    logError("admin:member-creator", error);
    // By CODE, never by message text — the rule every action in this file
    // follows, so no database wording reaches a screen.
    if (error.code === "FO028") {
      return denied(
        "That cannot be recorded. An account is only ever created by an admin, " +
          "and never by the person themselves.",
      );
    }
    return denied(
      toFriendlyMessage(error, "We could not record who created that account."),
    );
  }

  revalidatePath("/team/hierarchy");
  revalidatePath("/settings");
  return {
    error: null,
    fieldErrors: {},
    ok: true,
    message: `Recorded: ${admin.name ?? "that admin"} created ${target.name ?? "that account"}.`,
  };
}

/**
 * Deleting a team member, and everything that is theirs.
 *
 * THE MIRROR IMAGE OF createMember ABOVE, and deliberately shaped like it: the
 * same service-role client for the one thing only it can do, the same
 * requireAdmin() for the sake of a sentence, the same by-CODE error mapping.
 * What is not the same is that this cannot be rolled back. createMember's
 * failure path deletes the auth user it just made; there is no equivalent here,
 * which is why four guards stand in front of it.
 *
 * A TRUE DELETE, AND THE ONLY ONE ON THIS SCREEN. Statuses and purposes are
 * retired and never deleted, each for a reason written at length in
 * validation/admin.ts and admin-actions above: a deleted status erases what a
 * past visit said, a deleted purpose silently zeroes a weekly metric. Neither
 * argument applies to a person who has left the team, and the client asked for
 * the data to be gone rather than hidden.
 *
 * FIVE STEPS, IN THIS ORDER, AND THE ORDER IS THE DESIGN:
 *
 *   1. the four guards, below
 *   2. read the photo paths, BEFORE step 3 deletes the rows holding them
 *   3. public.delete_member() — one transaction, eight tables
 *   4. the private bucket, by the member's own folder prefix
 *   5. auth.admin.deleteUser(), last
 *
 * WHY STORAGE SITS BETWEEN THE ROWS AND THE AUTH USER. Storage is not
 * transactional and cannot join the RPC. After the rows, so a teardown that
 * rolls back has not already destroyed the photographs of visits that still
 * exist. Before the auth user, so the id naming the folder is still meaningful
 * if this half fails. Files with no rows are an orphan recoverable by prefix;
 * rows with no files would be visits whose evidence vanished under a delete
 * that never happened. `deleteMaterial()` makes the opposite call for the
 * opposite reason — there it is one row to one file, and a file with no row is
 * invisible and permanent.
 *
 * WHAT IS NOT DELETED: materials. The library is shared by the whole team and
 * `materials.uploaded_by` is an audit stamp rather than ownership, so its FK is
 * `on delete set null` and the poster outlives the admin who uploaded it.
 */
export async function deleteMember(
  _prev: DeleteMemberState,
  formData: FormData,
): Promise<DeleteMemberState> {
  const gate = await requireAdmin();
  if (!gate.ok) return denied(gate.error);

  const parsed = deleteMemberSchema.safeParse({
    member: textOf(formData, "member"),
    confirm_name: textOf(formData, "confirm_name"),
  });
  if (!parsed.success) {
    return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  const { member, confirm_name } = parsed.data;

  // GUARD 1 — not yourself. First because it needs no query, and because an
  // admin who reaches this by accident should be told before anything is read.
  // FO027 says the same thing in the database.
  if (member === gate.user.id) {
    return denied(
      "You cannot delete your own account. Ask another admin to do it.",
    );
  }

  /*
   * The target, read from the database.
   *
   * GUARD 2 IS THE TYPED NAME, and it is compared against THIS name — never
   * against one posted alongside the id. A form that sends both the id and the
   * name it should match is a form where a tampered request supplies its own
   * answer and passes. The whole value of a typed confirmation is that one half
   * of the comparison came from somewhere the person deleting cannot reach.
   */
  const { data: target, error: readError } = await gate.supabase
    .from("profiles")
    .select("id, name, role")
    .eq("id", member)
    .maybeSingle();

  if (readError) {
    logError("admin:delete-member-read", readError);
    return denied(
      toFriendlyMessage(readError, "We could not check that account."),
    );
  }
  if (!target) {
    return denied("That member no longer exists. The list may be out of date.");
  }

  const actualName = target.name ?? "";

  /*
   * A member with no name cannot be confirmed, so they are refused with the
   * remedy rather than with an impossible instruction.
   *
   * `profiles.name` is nullable and `confirmationMatches` fails closed on an
   * empty target — deliberately, since matching "" against "" would make an
   * empty press delete somebody. That leaves one dead end: the list renders the
   * "Unnamed member" fallback, the admin types it, and the comparison against
   * "" refuses for ever with `Type "" exactly to confirm`. The trigger is
   * disabled for these rows too; this is the half a hand-made request meets.
   */
  if (actualName.trim() === "") {
    return denied(
      "That member has no name recorded, so there is nothing to type to confirm. Give them a name first, then delete them.",
    );
  }

  if (!confirmationMatches(confirm_name, actualName)) {
    return {
      error: "That name does not match. Nothing was deleted.",
      fieldErrors: {
        confirm_name: `Type “${actualName}” exactly to confirm.`,
      },
    };
  }

  // GUARD 3 — never the last admin. Without it the app becomes unadministrable
  // and there is no self-signup, so nothing in the product could put it right.
  if (target.role === "admin") {
    const { count, error: countError } = await gate.supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");

    if (countError) {
      logError("admin:delete-member-admin-count", countError);
      return denied(
        toFriendlyMessage(countError, "We could not check that account."),
      );
    }
    if ((count ?? 0) <= 1) {
      return denied(
        "That is the only admin account. Create another admin first, then delete this one.",
      );
    }
  }

  /*
   * GUARD 4 — the cross-member safety net, said in the app so it can NAME the
   * schools.
   *
   * Since 0028 an institute belongs to exactly one rep, and FO026 refuses a
   * plan row for anybody else's at planning AND at arrival — so a NEW
   * cross-member visit cannot be made. Two ways one exists anyway: rows from
   * before 0028, when campus was the only boundary; and an admin reassigning an
   * institute AFTER somebody visited it, which `reassignInstitute` allows and
   * which leaves the old owner's visits exactly where they are.
   *
   * `delete_member()` raises FO027 for this and the `on delete restrict` on
   * visits.institute_id would refuse it regardless, so the OUTCOME is already
   * safe without a line of this. What this adds is the half an admin can act
   * on: which institutes, by name. A refusal that does not say which school is
   * in the way leaves them opening the registry row by row.
   *
   * Written in TypeScript rather than passed out of the RPC because no database
   * text reaches a screen in this app — the same rule log_visit()'s FO001-FO009
   * mapping follows. The function keeps the check; this keeps the sentence.
   *
   * An admin's RLS scope returns every institute and every visit, so these two
   * reads see the whole picture. A race between this and the call is what the
   * FO027 branch below is for.
   */
  const { data: owned, error: ownedError } = await gate.supabase
    .from("institutes")
    .select("id, name")
    .eq("registered_by", member);

  if (ownedError) {
    logError("admin:delete-member-owned", ownedError);
    return denied(
      toFriendlyMessage(ownedError, "We could not check that member's institutes."),
    );
  }

  const ownedIds = (owned ?? []).map((row) => row.id);
  if (ownedIds.length > 0) {
    const [foreignVisits, foreignPlans] = await Promise.all([
      gate.supabase
        .from("visits")
        .select("institute_id")
        .in("institute_id", ownedIds)
        .neq("member", member),
      gate.supabase
        .from("daily_plans")
        .select("institute_id")
        .in("institute_id", ownedIds)
        .neq("member", member),
    ]);

    if (foreignVisits.error || foreignPlans.error) {
      logError(
        "admin:delete-member-foreign",
        foreignVisits.error ?? foreignPlans.error,
      );
      return denied(
        toFriendlyMessage(
          foreignVisits.error ?? foreignPlans.error,
          "We could not check that member's institutes.",
        ),
      );
    }

    const blockedIds = new Set([
      ...(foreignVisits.data ?? []).map((row) => row.institute_id),
      ...(foreignPlans.data ?? []).map((row) => row.institute_id),
    ]);

    if (blockedIds.size > 0) {
      const names = (owned ?? [])
        .filter((row) => blockedIds.has(row.id))
        .map((row) => row.name)
        .sort((a, b) => a.localeCompare(b));

      return denied(
        `Nothing was deleted. ${names.length === 1 ? "One institute" : `${names.length} institutes`} ` +
          `owned by ${actualName} carr${names.length === 1 ? "ies" : "y"} work logged by somebody ` +
          `else (${names.join(", ")}). Reassign ${names.length === 1 ? "it" : "them"} to another rep first, then delete.`,
      );
    }
  }

  /*
   * The service-role client, before anything is destroyed.
   *
   * Created here rather than at step 5 on purpose: it throws when
   * SUPABASE_SERVICE_ROLE_KEY is missing or malformed, and discovering that
   * AFTER the rows had gone would leave an account that can still sign in with
   * no profile, no data and no way for this screen to finish the job. Same
   * guard, same reasoning, as createMember above — only the timing matters more.
   */
  let db;
  try {
    db = createAdminClient();
  } catch (error) {
    logError("admin:delete-member-client", error);
    return denied(
      "Accounts cannot be deleted right now — the server is missing a setting. Please tell whoever set the app up.",
    );
  }

  /*
   * STEP 2 — the photo paths, read before the visits that hold them are gone.
   *
   * The folder listing in step 4 is the primary source and this is the
   * cross-check: `list()` finds abandoned uploads that never became a visit,
   * and this finds anything whose path was written somewhere unexpected. The
   * union of the two is what gets removed, because neither alone is complete.
   */
  const { data: photoRows, error: photoError } = await gate.supabase
    .from("visits")
    .select("photo_url")
    .eq("member", member)
    .not("photo_url", "is", null);

  if (photoError) {
    // Not fatal. A listing we could not take is a handful of files that may be
    // missed, and the folder walk below is the one that usually finds them all.
    logError("admin:delete-member-photos-read", photoError);
  }

  const recordedPhotos = (photoRows ?? [])
    .map((row) => row.photo_url)
    .filter(
      (path): path is string =>
        // Only ever files under this member's own folder. A path pointing
        // anywhere else is somebody else's object and is left alone, whatever
        // the row claims.
        typeof path === "string" && path.startsWith(`${member}/`),
    );

  // STEP 3 — the teardown itself, in one transaction. Every guard above is
  // repeated inside it, because this action is the courtesy and the function is
  // the control.
  const { data: removed, error: rpcError } = await gate.supabase.rpc(
    "delete_member",
    { p_member: member },
  );

  if (rpcError) {
    logError("admin:delete-member", rpcError);
    /*
     * FO027 — reached only by a race, because all four of its cases are
     * checked above. Two admins deleting at once, or a colleague logging a
     * visit at one of these institutes in the gap between guard 4 and this
     * call. Mapped by CODE, never by message, so no database text reaches the
     * screen; the wording lives in errors.ts with the rest.
     *
     * "Nothing was changed" is the literal truth — every guard in the function
     * runs before the first delete, inside the same transaction.
     */
    if (rpcError.code === "FO027") {
      return denied(
        toFriendlyMessage(
          rpcError,
          "That member could not be deleted. Nothing was changed.",
        ) + " Reload the page and try again.",
      );
    }
    if (rpcError.code === "42501") {
      return denied("Only an admin can delete a member.");
    }
    return denied(
      toFriendlyMessage(
        rpcError,
        "We could not delete that member. Nothing was changed.",
      ),
    );
  }

  /*
   * STEP 4 — the photographs.
   *
   * Removed as the ADMIN, not the service role: `visit_photos_delete` (0001)
   * already allows `is_admin()` over the whole bucket, so RLS is still the
   * thing granting this — the same reasoning flushPhotos states.
   *
   * A file that is already gone is not an error. The nightly purge (0003/0004)
   * deletes past the retention window, so an older member's folder is expected
   * to be thinner than their visit count.
   */
  let photos = 0;
  try {
    const paths = new Set(recordedPhotos);

    // The folder walk, paged: storage's default page is small and a rep with a
    // year of visits has more objects than one call returns.
    for (let offset = 0; ; offset += PHOTO_PAGE) {
      const { data: files, error: listError } = await gate.supabase.storage
        .from("visit-photos")
        .list(member, { limit: PHOTO_PAGE, offset });

      if (listError) {
        logError("admin:delete-member-photo-list", listError);
        break;
      }
      for (const file of files ?? []) paths.add(`${member}/${file.name}`);
      if (!files || files.length < PHOTO_PAGE) break;
    }

    const all = [...paths];
    for (let i = 0; i < all.length; i += REMOVE_BATCH) {
      const { data, error: removeError } = await gate.supabase.storage
        .from("visit-photos")
        .remove(all.slice(i, i + REMOVE_BATCH));

      if (removeError) {
        logError("admin:delete-member-photo-remove", removeError);
        break;
      }
      photos += data?.length ?? 0;
    }
  } catch (error) {
    // The rows are already gone and cannot come back, so a storage failure must
    // not throw away the rest of the teardown. It is logged, and the leftover
    // files are recoverable by prefix — which is why this runs before step 5,
    // while the id still names something.
    logError("admin:delete-member-photos", error);
  }

  /*
   * STEP 5 — the auth user, last.
   *
   * The profile is already gone, so from step 3 onwards this account cannot do
   * anything: getCurrentUser() has no profile to read and requireAdmin()
   * refuses it. This closes the sign-in itself.
   *
   * A failure here is reported rather than swallowed, and it is the one partial
   * outcome worth naming out loud: the person's data is gone and their login is
   * not. Told plainly, because the remedy — delete the user in the Supabase
   * dashboard — is not something this screen can offer.
   */
  const { error: authError } = await db.auth.admin.deleteUser(member);
  if (authError) {
    logError("admin:delete-member-auth", authError);
    revalidatePath("/settings");
    revalidatePath("/", "layout");
    return denied(
      `${actualName}'s data was deleted, but their sign-in could not be removed. ` +
        "They can no longer use the app, but the login still exists — " +
        "please tell whoever set the app up.",
    );
  }

  // Everything an institute, a visit or a name appears on.
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  revalidatePath("/institutes", "layout");
  revalidatePath("/team");
  revalidatePath("/review");
  revalidatePath("/pending");

  return {
    error: null,
    fieldErrors: {},
    ok: true,
    deleted: {
      name: actualName,
      // Straight from the RPC, which counted as it went. Defaulted to an empty
      // object so a database answering something unexpected renders as "no
      // detail" rather than crashing the panel that just succeeded.
      removed:
        removed && typeof removed === "object" && !Array.isArray(removed)
          ? (removed as Record<string, number>)
          : {},
      photos,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Photo flush                                                         */
/* ------------------------------------------------------------------ */

/** Storage takes a list per call; keep each one modest. */
const REMOVE_BATCH = 100;

/**
 * How many objects to ask for per `list()` call when walking one member's
 * folder.
 *
 * Storage's own default page is 100 and it does NOT tell a caller there is
 * more, so a single call silently truncates a rep with a year of visits behind
 * them — and a truncated list here means photographs left in the bucket after
 * the member who took them is gone. `deleteMember` pages until a short page
 * comes back, which is the only reliable end-of-list signal on offer.
 */
const PHOTO_PAGE = 100;

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
