import { z } from "zod";
import { ACTIVITY_KEYS } from "@/lib/validation/visit";
import { STATUS_CATEGORIES, STATUS_TONES } from "@/lib/validation/institute";

/**
 * What an admin is allowed to type, checked identically in the browser and on
 * the server. Nothing here decides *who* may do these things — that is
 * `requireAdmin()` in admin-actions.ts, plus the RLS policies underneath it.
 */

/**
 * The one definition of "is this a usable name", used by the schemas below and
 * by the forms, so the browser and the server agree on what they will accept.
 */
export function nameLooksValid(value: string, max: number): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max && /\p{L}|\p{N}/u.test(trimmed);
}

const name = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} is too long.`)
    // A name made only of punctuation passes a length check but is not a name.
    .refine((v) => nameLooksValid(v, max), `${label} needs some letters.`);

/**
 * A purpose, and the activity it counts as.
 *
 * THE ACTIVITY IS REQUIRED, and it is the point of the whole of stage 2. A
 * purpose is what a rep plans a visit under; from stage 3 it is also what
 * decides the visit's `activity`, and seven of the eight weekly metrics are
 * counted by that. So an admin adding "Follow up on the proposal" is deciding
 * which number on the Targets screen that work will land in, and the form makes
 * them say which rather than defaulting to one.
 *
 * `ACTIVITY_KEYS` is the same six-value list `visitSchema` validates against and
 * `purposes_activity_valid` (migration 0024) mirrors as a CHECK. Three copies,
 * two of which the migration's own assertion block compares — see 0024 §4.
 */
export const purposeSchema = z.object({
  label: name(120, "The purpose"),
  activity: z.enum(ACTIVITY_KEYS, {
    message: "Choose what this purpose counts as.",
  }),
});

/**
 * A status an admin adds to the vocabulary.
 *
 * EVERY PART OF IT IS REQUIRED, and none of it has a default, because each
 * answer decides something a rep then lives with:
 *
 *   category   open or closed. It drives Rule 5 — an OPEN status makes a
 *              follow-up date compulsory, enforced by FO016 from the database —
 *              and from stage 5 it decides whether the institute sits in
 *              Pending. Guessing it would be guessing whether somebody is
 *              chased next week.
 *   tone       the badge colour. It tracks the OUTCOME rather than the
 *              category, so nothing can compute it: "First meeting done" is
 *              green and still open.
 *   asks_*     which extra questions the closing report asks. Each maps to a
 *              real column on public.visits — a closed vocabulary of groups,
 *              never free-form fields.
 *
 * The label is the PRIMARY KEY of public.institute_statuses and is what every
 * institute and visit stores, so it is a name, not an id, and renaming one is
 * refused by the foreign keys the moment it has been used.
 */
export const statusSchema = z.object({
  status: name(80, "The status"),
  category: z.enum(STATUS_CATEGORIES, {
    message: "Say whether this leaves the institute open or closed.",
  }),
  tone: z.enum(STATUS_TONES, { message: "Choose a colour for the badge." }),
  asks_expected_date: z.boolean(),
  asks_session_detail: z.boolean(),
  asks_head_count: z.boolean(),
});

export type StatusInput = z.infer<typeof statusSchema>;

/** Retiring, restoring, and renaming all target one existing status. */
export const statusUpdateSchema = z.object({
  status: z.string().trim().min(1, "That status could not be identified.").max(80),
});

export const statusRenameSchema = z.object({
  status: z.string().trim().min(1, "That status could not be identified.").max(80),
  renameTo: name(80, "The new name"),
});

/**
 * Moving an institute to another rep.
 *
 * Two ids and nothing else — the CAMPUS rule is not expressed here on purpose.
 * A schema can check that a uuid looks like a uuid; it cannot know which campus
 * a rep is on without a query, and putting a second opinion about that in the
 * app is how it drifts from the trigger that actually decides. The picker
 * offers only same-campus reps and FO025 refuses the rest.
 */
export const reassignSchema = z.object({
  institute_id: z.uuid("That institute could not be identified."),
  member: z.uuid("Choose a rep to hand it to."),
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
    /**
     * The campus a REP belongs to, and the campus an ADMIN must not have.
     *
     * Mirrors enforce_profile_campus() (FO021) so the admin filling this form
     * gets a sentence rather than a constraint rejection. The asymmetry is the
     * point and is worth stating twice: a rep is scoped to one campus, an admin
     * sees every campus and a campus on one would be a fact that decides
     * nothing.
     */
    campus_id: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine(
        (v) =>
          v === null ||
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
        "Choose one of the listed campuses.",
      ),
  })
  .refine((v) => v.password.toLowerCase() !== v.email, {
    path: ["password"],
    message: "The password must not be the email address.",
  })
  .superRefine((v, ctx) => {
    if (v.role === "rep" && !v.campus_id) {
      ctx.addIssue({
        code: "custom",
        path: ["campus_id"],
        message: "A rep works from one campus. Choose which.",
      });
    }
    if (v.role === "admin" && v.campus_id) {
      ctx.addIssue({
        code: "custom",
        path: ["campus_id"],
        message: "An admin sees every campus, so they are not posted to one.",
      });
    }
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
