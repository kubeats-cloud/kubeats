import { z } from "zod";

/**
 * Admission slabs — the same rules migration 0044 enforces, said in TypeScript.
 *
 * ⚠ TWO STATEMENTS OF ONE RULE, DELIBERATELY. The client asked for the
 * validation in BOTH places and they do different jobs: this one turns a
 * mistake into a sentence beside the field before anything is sent;
 * `save_slabs()` is what holds against a hand-rolled request. CLAUDE.md states
 * the same arrangement for Rule 12 (the photo), which is said three times.
 *
 * The cases are kept in step by `tests/unit/slabs.test.ts`, which runs this
 * copy over the same shapes the migration's messages describe. A rule that
 * drifted would show up there rather than as a rep being refused by the
 * database for something the form accepted.
 *
 * ⚠ THE ADMISSION-COUNT NUMBER HAS NO SOURCE YET, and nothing here consumes
 * one. These are RANGES only: no function picks "the slab you are in", because
 * there is no count to pick it with. Anything that pretended to would be
 * inventing data — see 0044's header.
 */

/** Program-wise carries a College and a Programme; Total carries neither. */
export const SLAB_SCOPES = ["program", "total"] as const;
export type SlabScope = (typeof SLAB_SCOPES)[number];

export const SLAB_STATUSES = ["pending", "approved", "rejected"] as const;
export type SlabStatus = (typeof SLAB_STATUSES)[number];

/**
 * How each status reads, and what it lets the rep do.
 *
 * ⚠ THERE IS NO "REVOKED". Revoking an approved set moves it to `rejected`,
 * because a revoked set is one the rep must edit and resubmit — which is what
 * rejected already means. A fourth status would be a second name for one state
 * and every screen and query would have to learn it.
 */
export const SLAB_STATUS_LABEL: Record<SlabStatus, string> = {
  pending: "Awaiting approval",
  approved: "Approved",
  rejected: "Needs changes",
};

export const SLAB_STATUS_TONE: Record<SlabStatus, "warning" | "success" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

/** An approved set is frozen; everything else is the rep's to edit. */
export function slabsEditable(status: SlabStatus | null): boolean {
  return status !== "approved";
}

export interface SlabRow {
  start: number;
  /** Null is the open-ended LAST slab ("1200 and above"), never a missing value. */
  end: number | null;
}

/** One row as the form holds it: text, because an empty end is a real answer. */
const slabInput = z.object({
  start: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
  end: z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((v) => (v === null || v === undefined ? "" : String(v).trim())),
});

export const slabSetSchema = z.object({
  institute_id: z.uuid("That institute could not be identified."),
  scope: z.enum(SLAB_SCOPES),
  college: z.string().trim().max(120, "That college name is too long.").default(""),
  program: z.string().trim().max(120, "That programme name is too long.").default(""),
  slabs: z.array(slabInput).min(1, "Add at least one slab."),
});

export type SlabSetInput = z.infer<typeof slabSetSchema>;

export interface SlabProblem {
  /** 1-based, matching the message and the row on screen. Null for set-wide. */
  index: number | null;
  message: string;
}

/**
 * Every rule, in the order a reader would check them.
 *
 * ⚠ WALKED IN THE ORDER GIVEN, NEVER SORTED FIRST. The order IS part of what is
 * being validated: sorting would silently repair "1–10, 21–30, 11–20" into
 * something the rep did not type, and "the next slab starts where the last one
 * ended" is the whole rule. 0044 walks it the same way for the same reason.
 *
 * Returns EVERY problem rather than the first. A rep fixing a six-row table one
 * refusal at a time is the experience this is meant to avoid.
 */
export function validateSlabSet(input: SlabSetInput): SlabProblem[] {
  const problems: SlabProblem[] = [];

  // The scope's shape first: it decides what the rest of the form even means.
  if (input.scope === "total" && (input.college !== "" || input.program !== "")) {
    problems.push({
      index: null,
      message:
        "A total slab set covers every programme, so it carries no college or programme.",
    });
  }
  if (input.scope === "program" && (input.college === "" || input.program === "")) {
    problems.push({
      index: null,
      message: "A program-wise slab set needs both a college and a programme.",
    });
  }

  const last = input.slabs.length - 1;
  let previousEnd: number | null = null;

  input.slabs.forEach((row, i) => {
    const at = i + 1;
    const start = row.start === "" ? null : Number(row.start);
    const end = row.end === "" ? null : Number(row.end);

    if (start === null || !Number.isInteger(start)) {
      problems.push({ index: at, message: `Slab ${at}: a start is required.` });
      // Nothing after this can be checked against a start that is not a number.
      previousEnd = null;
      return;
    }
    if (start < 0) {
      problems.push({ index: at, message: `Slab ${at}: a start cannot be negative.` });
    }
    if (row.end !== "" && !Number.isInteger(end)) {
      problems.push({ index: at, message: `Slab ${at}: the end must be a whole number.` });
      previousEnd = null;
      return;
    }

    // EXACTLY ONE OPEN-ENDED SLAB, and it is the last.
    if (i < last && end === null) {
      problems.push({
        index: at,
        message: `Slab ${at} needs an end. Only the last slab is open-ended.`,
      });
    }
    if (i === last && end !== null) {
      problems.push({
        index: at,
        message: `The last slab must be open-ended — leave its end blank for "${start} and above".`,
      });
    }

    if (end !== null && end < start) {
      problems.push({ index: at, message: `Slab ${at}: the end cannot be before the start.` });
    }

    // CONTIGUOUS: no gap and no overlap, which is one rule rather than two.
    if (previousEnd !== null && start !== previousEnd + 1) {
      problems.push({
        index: at,
        message: `Slab ${at} must start at ${previousEnd + 1}, right after the previous slab ends.`,
      });
    }

    previousEnd = end;
  });

  return problems;
}

/**
 * What the NEXT slab should start at — the auto-suggest the client asked for.
 *
 * Null when there is nothing to suggest from: an empty set starts wherever the
 * rep says, and a set whose last row has no end has nothing after it. Returning
 * 0 for "no idea" would put a number in a box that nobody chose.
 */
export function nextSlabStart(slabs: SlabRow[]): number | null {
  if (slabs.length === 0) return null;
  const previous = slabs[slabs.length - 1];
  if (previous.end === null || !Number.isInteger(previous.end)) return null;
  return previous.end + 1;
}

/**
 * The key that identifies a SET. One place, because four call sites compare it
 * and `coalesce(college, '')` is how 0044 matches the same rows.
 */
export function slabSetKey(row: {
  scope: SlabScope;
  college: string | null;
  program: string | null;
}): string {
  return row.scope === "total"
    ? "total"
    : `program:${row.college ?? ""}:${row.program ?? ""}`;
}
