"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { logError, toFriendlyMessage } from "@/lib/errors";
import { ensureAreas } from "@/lib/locations";
import { canonicalAreaName, findExisting } from "@/lib/location-names";
import { areaSchema } from "@/lib/validation/admin";
import type { AreaNode } from "@/lib/locations";
import type { CounsellorState, InstituteFormState } from "@/lib/institute-form-state";
import {
  CAMPUS_REQUIRED,
  EDIT_ALLOWANCE_SPENT,
  counsellorFormDataToInput,
  counsellorIdSchema,
  counsellorSchema,
  fieldErrorsFrom,
  instituteEditRefusal,
  instituteFormDataToInput,
  instituteSchema,
} from "@/lib/validation/institute";
import { CHECK_FIELDS } from "@/lib/visit-form-state";

/** The shape an institute id has to have before it is worth a round trip. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createInstitute(
  _prev: InstituteFormState,
  formData: FormData,
): Promise<InstituteFormState> {
  const supabase = await createClient();
  const user = await getCurrentUser();

  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  // Re-parsed here even though the browser already did: the client check is a
  // courtesy, this one is the rule.
  const parsed = instituteSchema.safeParse(instituteFormDataToInput(formData));

  if (!parsed.success) {
    return {
      error: CHECK_FIELDS,
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  /**
   * Who decides the campus, and why the rep's path is left exactly as it was.
   *
   * An admin names one; `institutes_insert` already permits `is_admin()` to
   * write any campus, so nothing in the database had to change for this.
   * A rep's choice is IGNORED rather than trusted — their campus comes from
   * `my_campus()` inside the trigger, which is the same answer RLS would
   * enforce anyway, so honouring a submitted value could only ever let a
   * tampered form try for a campus that is not theirs and be refused later.
   */
  const { campus_id: submittedCampus, ...institute } = parsed.data;
  const admin = isAdmin(user);
  const campusId = admin ? submittedCampus : null;

  if (admin && !campusId) {
    return { error: CHECK_FIELDS, fieldErrors: { campus_id: CAMPUS_REQUIRED } };
  }

  const { data, error } = await supabase
    .from("institutes")
    // registered_by must equal auth.uid() — the RLS insert policy requires it,
    // so this is not merely bookkeeping.
    .insert({
      ...institute,
      registered_by: user.id,
      ...(campusId ? { campus_id: campusId } : {}),
    })
    .select("id")
    .single();

  if (error) {
    logError("institutes:create", error);
    // FO022 — enforce_institute_campus() refusing an institute with no campus.
    // The check above is what an admin normally meets; this is the backstop for
    // a submission that got past it, and it names the field rather than telling
    // somebody to "try again" at something that cannot succeed.
    if (error.code === "FO022") {
      return { error: CHECK_FIELDS, fieldErrors: { campus_id: CAMPUS_REQUIRED } };
    }
    return {
      error: toFriendlyMessage(error, "We could not save this institute. Please try again."),
      fieldErrors: {},
    };
  }

  revalidatePath("/institutes");
  // Throws NEXT_REDIRECT — must not sit inside a try/catch.
  redirect(`/institutes/${data.id}`);
}

/**
 * Correcting an institute's details — an admin's job, and the owning rep's ONCE.
 *
 * THIS USED TO READ "an ADMIN's job, and only theirs", and B1 is exactly that
 * sentence changing. A rep registers an institute and sometimes gets a detail
 * wrong; their only remedy was to ask an admin. They now get one correction per
 * institute, counted in `institutes.rep_edits_used` and enforced by
 * `guard_rep_institute_edit()` (FO030, migration 0036). An admin still edits
 * without limit, and an admin's edit never spends the rep's allowance.
 *
 * SHAPED LIKE createInstitute ABOVE, and reading the same schema through the
 * same `instituteFormDataToInput()`, so the two cannot disagree about what a
 * valid institute looks like. The differences are the three things it must
 * NOT do:
 *
 *   NO registered_by.  Who owns an institute decides who can SEE it (0028), so
 *                      moving it is a permissions change. It has its own
 *                      control — `reassignInstitute()`, guarded by FO010 and
 *                      FO025 — and a rename must never be a back door into it.
 *                      `guard_institute_owner` fires `before update of
 *                      registered_by`, so an update that never mentions the
 *                      column never even reaches the trigger.
 *   NO campus_id.      The campus is the outer boundary and it moves with the
 *                      REP, in `correct_member_campus()` (0035), one pipeline
 *                      at a time. `parsed.data` carries one because the schema
 *                      is shared with the create form; it is discarded here,
 *                      explicitly, so a reader sees a decision rather than an
 *                      omission.
 *   NO status.         Rule 4: a status is set by hand from a visit, with the
 *                      photograph and the report that account for it. Writing
 *                      one here would append a row to the institute's status
 *                      history with no visit behind it, and Pending reads that
 *                      history. It is not in `instituteSchema` at all, so this
 *                      is a note rather than a filter.
 *
 * WHY THE REP HALF NEEDED NO RLS CHANGE. `institutes_update` (0028) is already
 * `is_admin() or (campus_id = my_campus() and registered_by = auth.uid())` on
 * both halves, so the OWNER could always write these columns; there was simply
 * no screen that did, and this action refused them. 0036 adds a counter and a
 * trigger, not a policy. Every CHECK from 0001 — the type, the pincode, both
 * mobiles, the class-11 streams, the class-12 object — applies to an UPDATE
 * exactly as it does to an INSERT.
 */
export async function updateInstitute(
  _prev: InstituteFormState,
  formData: FormData,
): Promise<InstituteFormState> {
  /*
   * NO LONGER `requireAdmin()` ON THE FIRST LINE (B1).
   *
   * The owning rep gets one correction per institute. Three things make that
   * safe without widening anything:
   *
   *   RLS       `institutes_update` has been `is_admin() or (campus_id =
   *             my_campus() and registered_by = auth.uid())` on BOTH halves
   *             since 0028. The owner was always permitted by the policy; this
   *             action was the thing refusing them.
   *   FO030     `guard_rep_institute_edit()` (0036) counts the edit and
   *             refuses the second one, in the database, where a tampered
   *             request also has to hear it.
   *   the gate  below, which exists so a rep gets a SENTENCE rather than a
   *             policy that silently matches no row.
   *
   * The three things this must still never do are unchanged, and the long note
   * above this function explains each: no `registered_by`, no `campus_id`, no
   * `status`.
   */
  const supabase = await createClient();
  const user = await getCurrentUser();

  if (!user) {
    return { error: "Your session has expired. Please sign in again.", fieldErrors: {} };
  }

  const id = (formData.get("institute_id") ?? "").toString().trim();
  if (!UUID.test(id)) {
    return { error: "That institute could not be identified.", fieldErrors: {} };
  }

  /*
   * The allowance is read BEFORE the write so the refusal can name itself.
   *
   * RLS scopes this read, so a rep asking about an institute that is not theirs
   * gets null and is told it is not theirs — the same answer the editor page
   * gives, from the same helper.
   */
  const { data: current, error: readError } = await supabase
    .from("institutes")
    .select("registered_by, rep_edits_used")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    logError("institutes:update-gate", readError);
    return {
      error: toFriendlyMessage(readError, "We could not save those changes. Please try again."),
      fieldErrors: {},
    };
  }
  if (!current) {
    return {
      error: "That institute could not be found, or is no longer yours to edit.",
      fieldErrors: {},
    };
  }

  const admin = isAdmin(user);
  const refusal = instituteEditRefusal(
    { registered_by: current.registered_by, rep_edits_used: current.rep_edits_used ?? 0 },
    { isAdmin: admin, viewerId: user.id },
  );

  if (refusal === "allowance-spent") {
    return { error: EDIT_ALLOWANCE_SPENT, fieldErrors: {} };
  }
  if (refusal) {
    return {
      error: "That institute could not be found, or is no longer yours to edit.",
      fieldErrors: {},
    };
  }

  // Re-parsed here even though the browser already did: the client check is a
  // courtesy, this one is the rule. Same sentence, same reason, as create.
  const parsed = instituteSchema.safeParse(instituteFormDataToInput(formData));

  if (!parsed.success) {
    return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  /*
   * Separated out, and then REFUSED rather than silently dropped.
   *
   * `campus_id` rides in `parsed.data` only because the schema is shared with
   * the create form; this editor never renders the field, so a submission
   * carrying one did not come from this screen. Dropping it quietly would
   * answer a tampered form with "saved" for a change that did not happen, which
   * is the weaker of the two answers — the same reasoning `reassignInstitute()`
   * gives for refusing a move it cannot make instead of no-opping.
   *
   * Destructured rather than deleted so TypeScript proves `institute` is
   * exactly the rest of the validated object.
   */
  const { campus_id: submittedCampus, ...institute } = parsed.data;

  if (submittedCampus !== null) {
    return {
      error:
        "An institute's campus moves with the rep who owns it, and is not changed here.",
      fieldErrors: {},
    };
  }

  const { data, error } = await supabase
    .from("institutes")
    .update(institute)
    .eq("id", id)
    // `select` so a policy that matched no row comes back as no data rather
    // than as a silent success. The gate above already answered for the
    // ordinary cases; this is the backstop for a deleted institute, and for a
    // session whose role or ownership changed between that read and this write.
    .select("id")
    .maybeSingle();

  if (error) {
    logError("institutes:update", error);
    /*
     * FO030 — the allowance, refused by the database rather than by the gate
     * above. Reached when a rep spends their edit in another tab between the
     * two, and by any request that did not come through this action at all.
     * Mapped BY CODE, never by message text, like every other FO code.
     */
    if (error.code === "FO030") {
      return { error: EDIT_ALLOWANCE_SPENT, fieldErrors: {} };
    }
    return {
      error: toFriendlyMessage(
        error,
        "We could not save those changes. Please try again.",
      ),
      fieldErrors: {},
    };
  }

  if (!data) {
    return {
      error: "That institute could not be found, or is no longer yours to edit.",
      fieldErrors: {},
    };
  }

  // The registry, the detail page and anything rendering the name from a join.
  revalidatePath("/institutes", "layout");
  // Throws NEXT_REDIRECT — must not sit inside a try/catch.
  redirect(`/institutes/${id}`);
}

export type AddAreaResult =
  | { ok: true; area: AreaNode }
  | { ok: false; message: string };

/**
 * Rule 11 — a rep is never blocked by a missing area.
 *
 * Runs on the ordinary server client, not the service role: the RLS policy
 * already lets any authenticated user insert an area, so nothing here needs
 * elevated rights.
 *
 * Goes through the same find-or-create helper as the PIN lookup and the admin
 * panel. Adding an area from this form used to insert the typed text as-is,
 * which meant "MG Road" and "mg  road" could become two areas depending on
 * which door they came in by — the Phase 4 city bug, one level down.
 */
export async function addArea(
  cityId: string,
  rawName: string,
): Promise<AddAreaResult> {
  const parsed = areaSchema.safeParse({ city_id: cityId, name: rawName });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check the area name.",
    };
  }

  const supabase = await createClient();
  const areas = await ensureAreas(supabase, parsed.data.city_id, [parsed.data.name]);
  const match = findExisting(areas, parsed.data.name, canonicalAreaName);

  if (!match) {
    return { ok: false, message: "We could not add that area." };
  }

  revalidatePath("/institutes");
  return { ok: true, area: match };
}

/* ------------------------------------------------------------------ */
/* Counsellors (migration 0037)                                        */
/* ------------------------------------------------------------------ */

/**
 * Who may write a counsellor at this institute: an admin, or its owning rep.
 *
 * THE SAME QUESTION AS "who may edit this institute", MINUS THE ALLOWANCE —
 * and the difference is the whole of B2's relationship to B1. A counsellor list
 * is a working record that changes as staff change; the one-time allowance is
 * for correcting a REGISTRATION. Capping the list at one change would make it
 * useless within a term, so `instituteEditRefusal()` is deliberately NOT called
 * here. 0036's trigger is scoped to a column list on `institutes`, so writing
 * this table cannot spend the allowance even by accident.
 *
 * NOT THE BOUNDARY. `institute_counsellors_{select,insert,update,delete}`
 * (0037) reach through the parent institute and are what actually decide. This
 * exists so a rep gets a sentence instead of a policy that matches no row.
 */
async function requireCounsellorAccess(instituteId: string): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; error: string }
> {
  if (!UUID.test(instituteId)) {
    return { ok: false, error: "That institute could not be identified." };
  }

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }

  if (isAdmin(user)) return { ok: true, supabase };

  // RLS already hides a colleague's institute, so a null here is the same
  // answer the registry gives: as far as this rep is concerned it is not there.
  const { data, error } = await supabase
    .from("institutes")
    .select("registered_by")
    .eq("id", instituteId)
    .maybeSingle();

  if (error) {
    logError("counsellors:gate", error);
    return { ok: false, error: toFriendlyMessage(error, "We could not check that institute.") };
  }
  if (!data || data.registered_by !== user.id) {
    return {
      ok: false,
      error: "That institute could not be found, or is not yours.",
    };
  }
  return { ok: true, supabase };
}

/**
 * Add one counsellor to an institute.
 *
 * Re-parsed server-side even though the browser already did — "the client check
 * is a courtesy, this one is the rule", the same sentence `createInstitute()`
 * carries, for the same reason.
 */
export async function addCounsellor(
  _prev: CounsellorState,
  formData: FormData,
): Promise<CounsellorState> {
  const instituteId = (formData.get("institute_id") ?? "").toString().trim();
  const gate = await requireCounsellorAccess(instituteId);
  if (!gate.ok) return { error: gate.error, fieldErrors: {} };

  const parsed = counsellorSchema.safeParse(counsellorFormDataToInput(formData));
  if (!parsed.success) {
    return { error: CHECK_FIELDS, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { error } = await gate.supabase.from("institute_counsellors").insert({
    institute_id: instituteId,
    name: parsed.data.name,
    phone: parsed.data.phone,
    email: parsed.data.email,
  });

  if (error) {
    logError("counsellors:add", error);
    // 42501 — the policy refused it. Reached when an institute is reassigned
    // between the gate above and this write, and by any request that did not
    // come through this action.
    if (error.code === "42501") {
      return { error: "That institute is not yours to add a counsellor to.", fieldErrors: {} };
    }
    return {
      error: toFriendlyMessage(error, "We could not add that counsellor."),
      fieldErrors: {},
    };
  }

  revalidatePath("/institutes", "layout");
  return { error: null, fieldErrors: {}, ok: true };
}

/**
 * Remove one counsellor.
 *
 * A REAL DELETE, not a retirement — unlike a status or a purpose, and for the
 * reason those two are retired instead: nothing references a counsellor row, so
 * removing it strands nothing and leaves no past record unreadable. 0037's own
 * header says the same thing from the schema's side.
 *
 * The institute id is passed as well as the counsellor id so the gate can
 * answer before the delete rather than relying on the policy to match no row —
 * a silent no-op would leave the rep pressing a button that appears to do
 * nothing.
 */
export async function removeCounsellor(
  instituteId: string,
  counsellorId: string,
): Promise<CounsellorState> {
  const gate = await requireCounsellorAccess(instituteId);
  if (!gate.ok) return { error: gate.error, fieldErrors: {} };

  const parsed = counsellorIdSchema.safeParse(counsellorId);
  if (!parsed.success) {
    return { error: "That counsellor could not be identified.", fieldErrors: {} };
  }

  const { error } = await gate.supabase
    .from("institute_counsellors")
    .delete()
    .eq("id", parsed.data)
    // Scoped to the institute as well as the id, so a counsellor id from
    // somewhere else cannot be deleted through an institute the caller owns.
    .eq("institute_id", instituteId);

  if (error) {
    logError("counsellors:remove", error);
    return {
      error: toFriendlyMessage(error, "We could not remove that counsellor."),
      fieldErrors: {},
    };
  }

  revalidatePath("/institutes", "layout");
  return { error: null, fieldErrors: {}, ok: true };
}
