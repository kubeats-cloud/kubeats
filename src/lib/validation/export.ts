import { z } from "zod";
import { monthEndOf, monthStartOf } from "@/lib/periods";
import { todayISO } from "@/lib/dates";

/**
 * What the export endpoint accepts.
 *
 * THE DEFAULT IS THE CURRENT MONTH, resolved from `todayISO()` — the app's one
 * definition of today, which reads the Asia/Kolkata calendar day. Taking the
 * month from `new Date()` here would give a range that depends on where the
 * code runs, so an export taken after 18:30 UTC on the last day of a month
 * would be labelled with the next one.
 *
 * VALIDATED, NOT TRUSTED, even though only an admin reaches it. The dates go
 * into `.gte()`/`.lte()` on three queries; a malformed one comes back from
 * PostgREST as a 400 the admin cannot act on, and an inverted range silently
 * returns zero rows and looks like a quiet month.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isoDate = z
  .string()
  .regex(ISO_DATE, "Use a date in YYYY-MM-DD form.")
  .refine((value) => {
    // Rejects 2026-02-31 and friends, which match the pattern and are not days.
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    );
  }, "That is not a real date.");

/** The widest range the export will build, as a guard rather than a rule. */
export const MAX_RANGE_DAYS = 400;

/**
 * The rep's own institutes download: a month at a time, not a year.
 *
 * A SEPARATE NUMBER FROM `MAX_RANGE_DAYS`, which is an admin report's guard.
 * Lowering that one would silently cap every admin and team-lead export too;
 * this is a rule about the small control on the rep's Institutes tab, so it is
 * enforced only on the rep branch of the route.
 */
export const REP_ACTIVITY_EXPORT_MAX_DAYS = 31;

/** Inclusive day count between two ISO dates, so 1 October – 31 is 31 days. */
export function rangeLengthInDays(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
}

/**
 * What is wrong with a rep's chosen download range, or `null` when it is fine.
 *
 * Shared by the control (to disable its button and say why) and the route (to
 * refuse a hand-edited URL), so the sentence a rep reads is the same one the
 * endpoint would answer with.
 */
export function repActivityExportRangeProblem(
  start: string,
  end: string,
): string | null {
  if (!start || !end) return "Choose both a start and an end date.";
  if (start > end) return "The start date has to be on or before the end date.";
  if (rangeLengthInDays(start, end) > REP_ACTIVITY_EXPORT_MAX_DAYS) {
    return `Choose a range of ${REP_ACTIVITY_EXPORT_MAX_DAYS} days or fewer.`;
  }
  return null;
}

export const exportRangeSchema = z
  .object({
    start: isoDate.optional(),
    end: isoDate.optional(),
    member: z.uuid("That is not a member id.").optional(),
  })
  .transform((input) => {
    const today = todayISO();
    const start = input.start ?? monthStartOf(today);
    const end = input.end ?? monthEndOf(start);
    return { start, end, member: input.member };
  })
  .refine((value) => value.start <= value.end, {
    message: "The start date has to be on or before the end date.",
    path: ["start"],
  })
  .refine(
    (value) => rangeLengthInDays(value.start, value.end) <= MAX_RANGE_DAYS,
    {
      message: `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`,
      path: ["end"],
    },
  );

export type ExportRangeInput = z.infer<typeof exportRangeSchema>;

/** The default range, for the form to mount with. */
export function defaultExportRange(): { start: string; end: string } {
  const start = monthStartOf(todayISO());
  return { start, end: monthEndOf(start) };
}
