import { z } from "zod";
import { nameLooksValid } from "@/lib/validation/admin";

/**
 * Admin #8 / Rep #2 — a target status is just a name.
 *
 * Reuses `nameLooksValid()`, the generic "is this a usable name" check every
 * admin-entered name in this app already answers to (purposes, states,
 * cities, institute statuses) — not institute-status machinery itself, which
 * this table has none of.
 */
const MAX_LENGTH = 80;

/**
 * Which campus a target status belongs to, or every campus (migration 0066).
 *
 * A SEPARATE COPY of statusSchema's own campusIdField in
 * src/lib/validation/admin.ts, not a shared import — deliberately. Part 0's
 * investigation found target_statuses to be its own vocabulary, not
 * institute_statuses and not the call outcome, and the client's three
 * campus-scoping parts were each scoped to touch one table's own files.
 *
 * "" is the ALL_CAMPUSES sentinel the form sends, and is required on the
 * form itself, defaulting to it. UNDEFINED is accepted too and treated the
 * same as "" — a caller (a pre-existing test, a cached page from before this
 * field existed) that omits the key entirely means the same thing a blank
 * picker does: every campus, not an error. The same tolerance
 * `purposeSchema`'s `lifecycle` field gives a form posted from before 0025.
 */
const campusIdField = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === "" ? null : v))
  .nullable()
  .refine(
    (v) =>
      v === null ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    "Choose one of the listed campuses.",
  );

export const targetStatusSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A status name is required.")
    .max(MAX_LENGTH, "That name is too long.")
    .refine((v) => nameLooksValid(v, MAX_LENGTH), "That name needs some letters."),
  campus_id: campusIdField,
});

export type TargetStatusInput = z.infer<typeof targetStatusSchema>;

/**
 * Re-scoping an EXISTING target status to another campus, or to every
 * campus. Separate from targetStatusSchema for the same reason
 * statusCampusSchema is separate from statusSchema: the name is not being
 * changed here, so there is nothing to re-validate about it beyond knowing
 * which row is meant.
 */
export const targetStatusCampusSchema = z.object({
  name: z.string().trim().min(1, "That status could not be identified.").max(MAX_LENGTH),
  campus_id: campusIdField,
});
