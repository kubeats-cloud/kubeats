"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { logError, toFriendlyMessage } from "@/lib/errors";
import type { FormState } from "@/lib/visit-form-state";
import {
  fileRejectionReason,
  materialFieldErrors,
  materialFormDataToInput,
  materialSchema,
} from "@/lib/validation/material";

/**
 * Adding to and removing from the shared library.
 *
 * Every action starts with requireAdmin(). That is not the only defence — the
 * materials RLS policies and the storage policies are both keyed on
 * is_admin(), and the bucket enforces size and type on its own — but it means
 * a rep who reaches these gets a sentence rather than a policy rejection, and
 * the two disagree loudly if they ever drift.
 *
 * The file is uploaded by the browser straight to storage before any of this
 * runs, so what arrives here is a path plus a description of what is at it.
 * None of that is trusted: the schema re-checks the type and the size, and the
 * insert re-checks that the path sits under this admin's own folder — the same
 * thing the storage policy required when the object was written.
 */

/** Where a given admin's uploads must live. Mirrors materials_object_insert. */
function ownsPath(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`);
}

export async function createMaterial(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error, fieldErrors: {} };

  const parsed = materialSchema.safeParse(materialFormDataToInput(formData));
  if (!parsed.success) {
    const fieldErrors = materialFieldErrors(parsed.error);
    return {
      error: "Please check the highlighted fields.",
      fieldErrors,
    };
  }

  // The same sentence the browser would have shown, applied again to values
  // that could have been edited after it ran.
  const rejection = fileRejectionReason({
    type: parsed.data.file_type,
    size: parsed.data.file_size,
  });
  if (rejection) {
    return { error: rejection, fieldErrors: { file_path: rejection } };
  }

  if (!ownsPath(parsed.data.file_path, gate.user.id)) {
    // Not reachable through the form; reachable by editing it. The storage
    // policy already refused to write anywhere else, so a path outside this
    // admin's folder means the row would describe someone else's object.
    logError("materials:create", new Error("file_path outside uploader folder"));
    return {
      error: "That upload could not be verified. Please try again.",
      fieldErrors: {},
    };
  }

  const { error } = await gate.supabase.from("materials").insert({
    title: parsed.data.title,
    category: parsed.data.category,
    description: parsed.data.description,
    file_path: parsed.data.file_path,
    file_name: parsed.data.file_name,
    file_type: parsed.data.file_type,
    file_size: parsed.data.file_size,
    uploaded_by: gate.user.id,
  });

  if (error) {
    logError("materials:create", error);
    return {
      error: toFriendlyMessage(error, "We could not save that material."),
      fieldErrors: {},
    };
  }

  revalidatePath("/materials");
  revalidatePath("/materials/manage");
  return { error: null, fieldErrors: {}, ok: true };
}

/**
 * Removing a material.
 *
 * The object goes first, then the row. That order is deliberate: if the object
 * delete fails we stop, and the library still shows a file that still exists.
 * The other way round would leave a file nobody has a row for — invisible in
 * the app and counting against storage forever. The reverse orphan (a row whose
 * object is gone) renders as unavailable and is listed by the housekeeping
 * query at the foot of migration 0012.
 */
export async function deleteMaterial(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error, fieldErrors: {} };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Nothing was selected to remove.", fieldErrors: {} };

  const { data: row, error: readError } = await gate.supabase
    .from("materials")
    .select("id, file_path")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    logError("materials:delete-read", readError);
    return {
      error: toFriendlyMessage(readError, "We could not remove that material."),
      fieldErrors: {},
    };
  }
  if (!row) {
    // Already gone. Someone else's delete is not this admin's problem.
    revalidatePath("/materials");
    revalidatePath("/materials/manage");
    return { error: null, fieldErrors: {}, ok: true };
  }

  const { error: objectError } = await gate.supabase.storage
    .from("materials")
    .remove([row.file_path]);

  if (objectError) {
    logError("materials:delete-object", objectError);
    return {
      error: "We could not remove the file itself, so nothing was deleted.",
      fieldErrors: {},
    };
  }

  const { error: rowError } = await gate.supabase
    .from("materials")
    .delete()
    .eq("id", id);

  if (rowError) {
    logError("materials:delete-row", rowError);
    return {
      error: toFriendlyMessage(rowError, "We could not remove that material."),
      fieldErrors: {},
    };
  }

  revalidatePath("/materials");
  revalidatePath("/materials/manage");
  return { error: null, fieldErrors: {}, ok: true };
}
