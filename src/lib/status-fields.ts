import "server-only";

import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

export type StatusField = {
  id: string;
  status: string;
  fieldName: string;
  fieldType: "select" | "text" | "date";
  options: string[];
  isRequired: boolean;
  sortOrder: number;
};

/**
 * CAMPUS-SCOPED SINCE 0067, with no filter of this function's own — same
 * stance as `listStatusCatalogue()`. `status_fields_select` used to be
 * `using (true)`, so a field belonging to another campus's status came back
 * regardless of whether that status was visible; 0067 rewrote the policy to
 * ask institute_statuses_select's own visibility for the status each field
 * belongs to. That is what makes the no-arg calls on `/log` and `/log-call`
 * safe to ship straight to the client: the full row set they fetch is already
 * trimmed to what the signed-in caller may see.
 */
export async function listStatusFields(status?: string): Promise<StatusField[]> {
  const supabase = await createClient();
  let query = supabase
    .from("status_fields")
    .select("id, status, field_name, field_type, options, is_required, sort_order")
    .order("sort_order")
    .order("field_name");

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    logError("status-fields:list", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    fieldName: row.field_name,
    fieldType: row.field_type as "select" | "text" | "date",
    options: Array.isArray(row.options) ? row.options : [],
    isRequired: Boolean(row.is_required),
    sortOrder: row.sort_order ?? 0,
  }));
}
