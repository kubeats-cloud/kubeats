"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError, toFriendlyMessage } from "@/lib/errors";
import { ensureAreas } from "@/lib/locations";
import { canonicalAreaName, findExisting } from "@/lib/location-names";
import { areaSchema } from "@/lib/validation/admin";
import type { AreaNode } from "@/lib/locations";
import type { InstituteFormState } from "@/lib/institute-form-state";
import {
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  const { data, error } = await supabase
    .from("institutes")
    // registered_by must equal auth.uid() — the RLS insert policy requires it,
    // so this is not merely bookkeeping.
    .insert({ ...parsed.data, registered_by: user.id })
    .select("id")
    .single();

  if (error) {
    logError("institutes:create", error);
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
