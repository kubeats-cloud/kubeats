import { z } from "zod";

/**
 * What an admin is allowed to type, checked identically in the browser and on
 * the server. Nothing here decides *who* may do these things — that is
 * `requireAdmin()` in admin-actions.ts, plus the RLS policies underneath it.
 */

const name = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} is too long.`)
    // A name made only of punctuation passes a length check but is not a name.
    .refine((v) => /\p{L}|\p{N}/u.test(v), `${label} needs some letters.`);

export const purposeSchema = z.object({
  label: name(120, "The purpose"),
});

export const stateSchema = z.object({
  name: name(80, "The state name"),
});

export const citySchema = z.object({
  state_id: z.uuid("Choose a state first."),
  name: name(80, "The city name"),
});

export const areaSchema = z.object({
  city_id: z.uuid("Choose a city first."),
  name: name(120, "The area name"),
});

export const REMOVABLE = ["purpose", "state", "city", "area"] as const;
export type RemovableKind = (typeof REMOVABLE)[number];

export const removeSchema = z.object({
  kind: z.enum(REMOVABLE),
  id: z.uuid(),
});

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */

export const ROLES = ["rep", "admin"] as const;
export type MemberRole = (typeof ROLES)[number];

/**
 * The password is temporary and handed over in person, but it is still a
 * password: eight characters is the floor, above Supabase's own six, and it
 * must not be the email address.
 */
export const MIN_PASSWORD = 8;

export const newMemberSchema = z
  .object({
    name: name(120, "The name"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email("That does not look like an email address.")),
    password: z
      .string()
      .min(MIN_PASSWORD, `At least ${MIN_PASSWORD} characters.`)
      .max(72, "That password is too long."),
    role: z.enum(ROLES),
  })
  .refine((v) => v.password.toLowerCase() !== v.email, {
    path: ["password"],
    message: "The password must not be the email address.",
  });

export type NewMemberInput = z.infer<typeof newMemberSchema>;

/* ------------------------------------------------------------------ */
/* Photo flush                                                         */
/* ------------------------------------------------------------------ */

/** The presets the client actually asked for, plus a free choice of date. */
export const FLUSH_PRESETS = [
  { key: "7", label: "Older than a week", days: 7 },
  { key: "14", label: "Older than a fortnight", days: 14 },
  { key: "30", label: "Older than a month", days: 30 },
  { key: "custom", label: "On or before a date I choose…", days: null },
] as const;

export const flushSchema = z.object({
  /** Photos on visits dated on or before this day are deleted. */
  cutoff: z
    .string()
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Choose a date.")
    .refine((v) => {
      const date = new Date(`${v}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime());
    }, "That is not a real date."),
  intent: z.enum(["count", "delete"]),
});

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

export function textOf(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
