"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin";
import { logError, toFriendlyMessage } from "@/lib/errors";
import { ensureAreas } from "@/lib/locations";
import { canonicalAreaName, findExisting } from "@/lib/location-names";
import { areaSchema } from "@/lib/validation/admin";
import type { AreaNode } from "@/lib/locations";
import type { InstituteFormState } from "@/lib/institute-form-state";
import {
  CAMPUS_REQUIRED,
  fieldErrorsFrom,
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
 * Correcting an institute's details — an ADMIN's job, and only theirs.
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
 * WHY THIS NEEDS NO MIGRATION. `institutes_update` (0028) is already
 * `is_admin() or (campus_id = my_campus() and registered_by = auth.uid())` on
 * both halves, so an admin could always write these columns; there was simply
 * no screen that did. Every CHECK from 0001 — the type, the pincode, both
 * mobiles, the class-11 streams, the class-12 object — applies to an UPDATE
 * exactly as it does to an INSERT.
 */
export async function updateInstitute(
  _prev: InstituteFormState,
  formData: FormData,
): Promise<InstituteFormState> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error, fieldErrors: {} };

  const id = (formData.get("institute_id") ?? "").toString().trim();
  if (!UUID.test(id)) {
    return { error: "That institute could not be identified.", fieldErrors: {} };
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

  const { data, error } = await gate.supabase
    .from("institutes")
    .update(institute)
    .eq("id", id)
    // `select` so a policy that matched no row comes back as no data rather
    // than as a silent success. An admin passes `institutes_update`, so this
    // is the backstop for a deleted institute and for a session that stopped
    // being an admin between the gate above and this write.
    .select("id")
    .maybeSingle();

  if (error) {
    logError("institutes:update", error);
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
