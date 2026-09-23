import { z } from "zod";
import { ACTIVITY_KEYS, hasLifecycle } from "@/lib/validation/visit";
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
 * A purpose: its label, the activity it counts as, and — for the two activities
 * that have one — its lifecycle.
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
 *
 * THE LIFECYCLE IS REQUIRED TOO, AND ONLY SOMETIMES, and leaving it out made
 * half the vocabulary unaddable. `purposes_lifecycle_matches_activity` (0025)
 * demands Set or Done on a session or a campus visit and NULL on everything
 * else, so a form that never sent one could add "Other" and "Follow-up" all day
 * and was refused with a raw 23514 the moment an admin tried to add a session
 * purpose. Sessions Set, Sessions Done, Campus Visits Set and Campus Visits Done
 * are four of the eight weekly metrics; without a lifecycle there is no way to
 * feed any of them.
 *
 * It is what tells "Fix a session" from "Complete a session" — both map to the
 * `session` activity, and without it Sessions Set and Sessions Done would be
 * indistinguishable. So it is asked at the moment the activity is chosen, and
 * refused on an activity that may not carry one: the CASE below is the same
 * shape as `plannedActivityIsValid()`, `visits_lifecycle_matches_activity`
 * (0001) and 0025's CHECK. Four copies of one rule, which is what 0025's
 * assertion block exists to keep in step.
 */
export const PURPOSE_LIFECYCLES = ["Set", "Done"] as const;
export type PurposeLifecycle = (typeof PURPOSE_LIFECYCLES)[number];

export const purposeSchema = z
  .object({
    label: name(120, "The purpose"),
    activity: z.enum(ACTIVITY_KEYS, {
      message: "Choose what this purpose counts as.",
    }),
    /**
     * Empty means "not asked", which is the right answer for the four
     * one-shot activities and a missing one for the other two. It arrives as
     * "" from a picker that mounts empty, so it is normalised here rather than
     * at each call site.
     *
     * ABSENT ENTIRELY is tolerated for the same reason `visitSchema` tolerates
     * a missing `accuracy`: during a deploy an admin's cached page posts a form
     * with no such field. It is read as "not asked", so a session purpose from
     * such a page is still refused — by the rule below, with the sentence that
     * explains it, rather than as an unreadable field.
     */
    lifecycle: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === undefined || v === "" ? null : v))
      .nullable()
      .refine((v) => v === null || v === "Set" || v === "Done", {
        message: "Choose Set or Done.",
      }),
  })
  .superRefine((value, ctx) => {
    if (hasLifecycle(value.activity)) {
      if (value.lifecycle === null) {
        ctx.addIssue({
          code: "custom",
          path: ["lifecycle"],
          message:
            "Say whether this purpose SETS the session or campus visit, or COMPLETES one.",
        });
      }
      return;
    }
    if (value.lifecycle !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["lifecycle"],
        message: "This activity does not have a Set or Done state.",
      });
    }
  });

/** Retiring and restoring both target one existing purpose, by id. */
export const purposeUpdateSchema = z.object({
  id: z.uuid("That purpose could not be identified."),
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

/**
 * Recording, by hand, which admin created an account.
 *
 * FOR THE ROWS THAT PREDATE MIGRATION 0034 AND NOTHING ELSE. `createMember()`
 * stamps `created_by` itself from the signed-in admin, so every account made
 * from now on arrives with one. The ~39 that already existed have no record of
 * who made them anywhere in the database, and 0034 deliberately backfills none
 * rather than guessing — so an admin supplies the answer from the hierarchy
 * screen, one person at a time.
 *
 * TWO IDS, AND ONE RULE THAT CAN BE CHECKED WITHOUT A QUERY. "The creator must
 * be an admin" is not expressed here, for the reason `reassignSchema` above
 * gives about campuses: a schema cannot know a role without a lookup, and a
 * second opinion about it in the app is how it drifts from the trigger that
 * actually decides. FO028 refuses a rep parent; the action checks it so the
 * admin gets a sentence, and the picker only ever offers admins.
 *
 * What IS checked here is self-parenthood, because it needs no lookup at all —
 * two ids and an inequality. FO028 refuses it too. This is the copy that names
 * the field rather than arriving as a database code.
 */
export const memberCreatorSchema = z
  .object({
    member: z.uuid("That person could not be identified."),
    created_by: z.uuid("Choose the admin who created them."),
  })
  .refine((v) => v.member !== v.created_by, {
    path: ["created_by"],
    message: "Nobody creates their own account.",
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

/**
 * What `removeEntry` will actually delete — and what it deliberately will not.
 *
 * "purpose" WAS on this list and has been taken off. Deleting a purpose is not
 * removal, it is silent arithmetic: `purposes` is the only thing that decides
 * which weekly metric a visit counts toward, so deleting the last one feeding a
 * metric zeroes that metric for ever and nothing anywhere says so — Sessions Set
 * simply comes in flat. It also strands every `daily_plans` row pointing at it,
 * and with Log Visit's Activity selector gone there is no by-hand fallback to
 * recover with.
 *
 * `purposes.is_active` (0025) is the removal path instead, through
 * `setPurposeActive()`. Retiring takes a purpose out of the rep's picker and
 * leaves every plan that used it able to resolve its mapping, which is the same
 * bargain the status vocabulary makes and for the same reason.
 *
 * Taken off the LIST rather than only out of the panel, because deleting the
 * button never closes the path behind it — the lesson FO020 records about the
 * rep's abandon button. The action is the boundary; the UI is the courtesy.
 */
export const REMOVABLE = ["state", "city", "area"] as const;
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

/**
 * The campus field, written once and used by BOTH member schemas.
 *
 * Lifted out of `newMemberSchema` when the editor arrived rather than copied
 * into it. It mirrors `enforce_profile_campus()` (FO021), and a second copy
 * free to drift would mean the create form and the edit form disagreeing about
 * a rule the database decides. The asymmetry it encodes is the point, and is
 * worth stating twice: a rep is scoped to one campus; an admin sees every
 * campus and a campus on one would be a fact that decides nothing.
 *
 * Declared HERE, above its first use, and that is not a style choice — a `const`
 * referenced by a module-scope initialiser above it is a temporal dead zone
 * error at import time, which would take every schema in this file with it.
 */
const campusField = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine(
    (v) =>
      v === null ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    "Choose one of the listed campuses.",
  );

export const newMemberSchema = z
  .object({
    name: name(120, "The name"),
    /*
     * FORMAT ONLY, AND THAT IS ALL A SCHEMA CAN DO.
     *
     * `z.email()` is already strict — it refuses a missing "@", a domain with
     * no dot, a one-character TLD, spaces, doubled dots, a leading or trailing
     * dot, an underscore in the domain, and `localhost`. What it cannot refuse
     * is a well-formed address aimed at the wrong place: `…@gamil.con` passes
     * every one of those rules, and passed them on the day a rep was created
     * with it. No stricter pattern would have caught it, because the mistake is
     * not in the shape. See `email-typos.ts` for the half that can, and for why
     * that half only ever warns.
     *
     * The 254 cap is the practical ceiling on an address (RFC 5321's envelope
     * limit). Not a real defence — anything that long is a paste accident — but
     * it keeps an absurd string out of an auth call.
     */
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "That email address is too long.")
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
    campus_id: campusField,
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

/**
 * Editing a team member: THE NAME AND THE CAMPUS, AND NOTHING ELSE.
 *
 * What is missing from this schema is the specification, not an oversight, so
 * each absence is written down:
 *
 *   EMAIL     is the sign-in credential and lives in `auth.users`, which
 *             PostgREST does not expose at all. Changing it is changing how
 *             somebody logs in, and doing it from a row in a table of twenty
 *             people is how the wrong account gets locked out.
 *   PASSWORD  has its own path. An editor that could set one would be an
 *             editor that could take an account over.
 *   ID        is the `auth.users` foreign key and is referenced by eight
 *             tables. It is not editable in any meaningful sense.
 *   ROLE      is deliberately out. Flipping it inverts the campus requirement
 *             in both directions (FO021 demands one for a rep and forbids one
 *             for an admin), and `guard_profile_role` (0001) has its own
 *             opinion about who may do it. It deserves its own decision, not a
 *             dropdown beside a name.
 *
 * `retag` IS NOT A FIELD ABOUT THE MEMBER. It answers "was the old campus
 * wrong, or did they move?" — the difference between a mis-allocation, where
 * the institutes they own should follow them, and a genuine transfer, where
 * those institutes belong to the campus they were worked from. It is carried
 * here because the form sends it; `correct_member_campus()` (0035) is what acts
 * on it. A checkbox that is absent reads as false, which is why the form sends
 * an explicit value rather than relying on the box being ticked.
 */
export const memberUpdateSchema = z
  .object({
    member: z.uuid("That person could not be identified."),
    name: name(120, "The name"),
    campus_id: campusField,
    /**
     * The target's role, sent by the form so the campus rule can be checked
     * without a lookup — NOT a field that may be changed. `updateMember()`
     * reads the role from the database and refuses if the two disagree, so a
     * tampered value can only ever cause a refusal.
     */
    role: z.enum(ROLES),
    retag: z.boolean(),
  })
  .superRefine((v, ctx) => {
    // The same two branches newMemberSchema applies, for the same reason: FO021
    // would refuse it anyway, and a rejection the form could have prevented is
    // a rejection the form should have prevented.
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

export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;

/**
 * Deleting a member — which is a TRUE delete, unlike everything else an admin
 * removes on this screen.
 *
 * Statuses and purposes are retired and never deleted, each for a written
 * reason: a status erases what a past visit said, a purpose silently zeroes a
 * weekly metric. Neither reason applies to a person who has left, and the
 * client asked for the account and its data to be gone rather than hidden. So
 * this is the one removal on Settings that cannot be undone from inside the
 * app, and the schema is shaped around saying so.
 *
 * THE TYPED NAME IS THE CONFIRMATION, and this schema deliberately does NOT
 * check it against anything. It cannot: the only name available here is one
 * that arrived in the same POST as the id, and comparing a posted pair to
 * itself is a check a tampered form passes trivially. `deleteMember()` reads
 * the name from `profiles` and compares against THAT. All this does is insist
 * something was typed, so the action is never reached with an empty box.
 */
export const deleteMemberSchema = z.object({
  member: z.uuid("That member could not be identified."),
  confirm_name: z
    .string()
    .trim()
    .min(1, "Type the member's name to confirm.")
    .max(120, "That is not the member's name."),
});

export type DeleteMemberInput = z.infer<typeof deleteMemberSchema>;

/**
 * Do these two names match closely enough to count as a confirmation?
 *
 * Trim and case-fold, and nothing cleverer. The point of typing a name is to
 * make the admin look at WHICH member they are about to delete, not to test
 * their typing — so trailing whitespace and a lowercase first letter are not
 * the failure this guard is for. Anything beyond that (collapsing inner
 * spaces, stripping punctuation) starts accepting a name that is not the name.
 *
 * Exported so the browser can disable the button on exactly the rule the
 * server will apply, rather than on a second guess at it.
 */
export function confirmationMatches(typed: string, actual: string): boolean {
  const normalise = (v: string) => v.trim().toLocaleLowerCase();
  const wanted = normalise(actual);
  return wanted.length > 0 && normalise(typed) === wanted;
}

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
