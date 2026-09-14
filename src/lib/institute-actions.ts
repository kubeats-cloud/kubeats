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
import type { InstituteFormState } from "@/lib/institute-form-state";
import {
  CAMPUS_REQUIRED,
  fieldErrorsFrom,
  instituteFormDataToInput,
  instituteSchema,
} from "@/lib/validation/institute";
import { CHECK_FIELDS } from "@/lib/visit-form-state";

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
