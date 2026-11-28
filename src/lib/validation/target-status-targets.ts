import { z } from "zod";

export interface StatusTargetValue {
  statusName: string;
  value: number;
}

export const statusTargetCountSchema = z
  .union([z.string(), z.number()])
  .transform((value) =>
    typeof value === "number" ? String(value) : value.trim(),
  )
  .transform((value) => (value === "" ? "0" : value))
  .refine((value) => /^\d{1,3}$/.test(value), "Whole numbers from 0 to 999.")
  .transform(Number);

/** Stable field names let status names contain whitespace and punctuation. */
export function statusTargetFieldName(statusName: string): string {
  return `target_status.${encodeURIComponent(statusName)}`;
}

/**
 * Build controlled form state from the visible vocabulary and any saved rows.
 * A newly-added status has no child row yet and therefore starts at zero.
 */
export function mapStatusTargetFormValues(
  statusNames: readonly string[],
  saved: readonly StatusTargetValue[],
): Record<string, string> {
  const savedByName = new Map(saved.map((row) => [row.statusName, row.value]));
  return Object.fromEntries(
    statusNames.map((name) => [name, String(savedByName.get(name) ?? 0)]),
  );
}

/** Parse only server-supplied visible names; crafted fields are ignored. */
export function parseVisibleStatusTargets(
  formData: FormData,
  statusNames: readonly string[],
):
  | { success: true; values: StatusTargetValue[]; payload: Record<string, number> }
  | { success: false; fieldErrors: Record<string, string> } {
  const values: StatusTargetValue[] = [];
  const fieldErrors: Record<string, string> = {};

  for (const statusName of statusNames) {
    const fieldName = statusTargetFieldName(statusName);
    // A status added or renamed after this particular form was rendered has no
    // field in the post. Leave it untouched instead of inventing a zero.
    if (!formData.has(fieldName)) continue;
    const raw = formData.get(fieldName);
    const parsed = statusTargetCountSchema.safeParse(
      typeof raw === "string" ? raw : "",
    );
    if (!parsed.success) {
      fieldErrors[fieldName] = parsed.error.issues[0]?.message ?? "Invalid number.";
      continue;
    }
    values.push({ statusName, value: parsed.data });
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors };
  }

  return {
    success: true,
    values,
    payload: Object.fromEntries(values.map((row) => [row.statusName, row.value])),
  };
}
