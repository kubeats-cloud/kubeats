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
    (value) => {
      const days =
        (Date.parse(value.end) - Date.parse(value.start)) / 86_400_000 + 1;
      return days <= MAX_RANGE_DAYS;
    },
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
