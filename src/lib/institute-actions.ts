"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError, toFriendlyMessage } from "@/lib/errors";
import type { AreaNode } from "@/lib/locations";
import type { InstituteFormState } from "@/lib/institute-form-state";
import {
  fieldErrorsFrom,
  instituteFormDataToInput,
  instituteSchema,
} from "@/lib/validation/institute";

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
      error: "Please check the highlighted fields.",
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
 */
export async function addArea(
  cityId: string,
  rawName: string,
): Promise<AddAreaResult> {
  const name = rawName.trim();
  if (!name) return { ok: false, message: "Enter an area name." };
  if (name.length > 120) return { ok: false, message: "That name is too long." };
  if (!cityId) return { ok: false, message: "Choose a city first." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("location_areas")
    .insert({ city_id: cityId, name })
    .select("id, name")
    .single();

  if (error) {
    // Someone already added it — treat that as success and return theirs.
    if (error.code === "23505") {
      const existing = await supabase
        .from("location_areas")
        .select("id, name")
        .eq("city_id", cityId)
        .eq("name", name)
        .maybeSingle();
      if (existing.data) return { ok: true, area: existing.data };
    }

    logError("locations:add-area", error);
    return {
      ok: false,
      message: toFriendlyMessage(error, "We could not add that area."),
    };
  }

  revalidatePath("/institutes");
  return { ok: true, area: data };
}
