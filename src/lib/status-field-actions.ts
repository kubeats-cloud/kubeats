"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin";
import { logError } from "@/lib/errors";

const addStatusFieldSchema = z.object({
  status: z.string().trim().min(1, "Status is required."),
  fieldName: z.string().trim().min(1, "Field name is required.").max(80, "Field name must be 80 characters or fewer."),
  fieldType: z.enum(["select", "text", "date"]).default("select"),
  optionsRaw: z.string().optional(),
  isRequired: z.boolean().default(false),
});

export type StatusFieldActionResult = {
  error: string | null;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
};

export async function addStatusField(formData: FormData): Promise<StatusFieldActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return { error: gate.error, fieldErrors: {} };
  }

  const rawStatus = String(formData.get("status") ?? "").trim();
  const rawFieldName = String(formData.get("field_name") ?? "").trim();
  const rawFieldType = String(formData.get("field_type") ?? "select").trim();
  const rawOptions = String(formData.get("options") ?? "").trim();
  const rawRequired = formData.get("is_required") === "true" || formData.get("is_required") === "on";

  const parsed = addStatusFieldSchema.safeParse({
    status: rawStatus,
    fieldName: rawFieldName,
    fieldType: rawFieldType,
    optionsRaw: rawOptions,
    isRequired: rawRequired,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (typeof path === "string") {
        fieldErrors[path] = issue.message;
      }
    }
    return { error: "Please correct the field configuration.", fieldErrors };
  }

  const { status, fieldName, fieldType, isRequired } = parsed.data;

  let options: string[] = [];
  if (fieldType === "select") {
    options = rawOptions
      .split(/[\n,]/)
      .map((opt) => opt.trim())
      .filter((opt) => opt.length > 0);

    // Deduplicate options while preserving order
    options = Array.from(new Set(options));

    if (options.length === 0) {
      return {
        error: "Dropdown fields require at least one option.",
        fieldErrors: { options: "Enter at least one option (separated by comma or newline)." },
      };
    }
  }

  const supabase = await createClient();

  // Check if status exists
  const { data: statusRow, error: statusError } = await supabase
    .from("institute_statuses")
    .select("status")
    .eq("status", status)
    .maybeSingle();

  if (statusError || !statusRow) {
    return { error: `Status "${status}" does not exist.`, fieldErrors: { status: "Unknown status" } };
  }

  const { error: insertError } = await supabase.from("status_fields").insert({
    status,
    field_name: fieldName,
    field_type: fieldType,
    options,
    is_required: isRequired,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        error: `Field "${fieldName}" already exists for status "${status}".`,
        fieldErrors: { field_name: "Field name already exists for this status" },
      };
    }
    logError("status-fields:insert", insertError);
    return { error: "Could not save the field configuration. Please try again.", fieldErrors: {} };
  }

  revalidatePath("/settings");
  revalidatePath("/log");
  revalidatePath("/pending");
  revalidatePath("/", "layout");

  return { error: null, ok: true };
}

export async function deleteStatusField(fieldId: string): Promise<StatusFieldActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return { error: gate.error };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("status_fields").delete().eq("id", fieldId);

  if (error) {
    logError("status-fields:delete", error);
    return { error: "Could not remove the field. Please try again." };
  }

  revalidatePath("/settings");
  revalidatePath("/log");
  revalidatePath("/pending");
  revalidatePath("/", "layout");

  return { error: null, ok: true };
}
