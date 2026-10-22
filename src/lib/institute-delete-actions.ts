"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { toFriendlyMessage } from "@/lib/errors";
import { z } from "zod";

export async function deleteInstitute(id: string): Promise<{ error: string | null }> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };
  if (!z.uuid().safeParse(id).success) return { error: "Institute not found." };
  const { error } = await gate.supabase.rpc("soft_delete_institute", { p_institute: id });
  if (error) return { error: error.code === "22023" ? error.message
    : toFriendlyMessage(error, "We could not delete this institute.") };
  revalidatePath("/", "layout");
  return { error: null };
}
