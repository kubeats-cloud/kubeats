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

export const targetStatusSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "A status name is required.")
    .max(MAX_LENGTH, "That name is too long.")
    .refine((v) => nameLooksValid(v, MAX_LENGTH), "That name needs some letters."),
});

export type TargetStatusInput = z.infer<typeof targetStatusSchema>;
