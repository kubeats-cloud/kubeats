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
