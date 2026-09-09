/**
 * The three target periods, and the date range each one counts over.
 *
 * This sits on top of weeks.ts rather than replacing it. That file owns the
 * Monday-to-Saturday reporting week, its two different "ends", and the UTC
 * string arithmetic that keeps the grid stable wherever the app runs; all of
 * that is unchanged and still the authority for the weekly case. What is new
 * here is only "which dates does a day / a month cover", asked the same way.
 *
 * Every date is a plain YYYY-MM-DD string and every calculation goes through
 * UTC, for the reason weeks.ts spells out: `new Date("2026-09-01")` parses as
 * UTC midnight but `getDay()` reads it locally, so in any timezone behind UTC
 * the first of the month silently reads as the last of the previous one.
 *
 * Which day it *is* remains a question only dates.ts answers — todayISO(), the
 * Indian calendar day the database agrees with through app_today().
 */

import { formatDate, formatMonthYear, todayISO } from "@/lib/dates";
import { mondayOf, weekCountEnd, formatWeekRange, weekLabel } from "@/lib/weeks";

/**
 * Four periods, and two vocabularies over them.
 *
 * The date arithmetic below is the same question for all four, so it is written
 * once. What differs is which periods a given screen offers:
 *
 *   PERIODS         all four — what the helpers here understand
 *   REPORT_PERIODS  daily, monthly, yearly — how the activity report is read.
 *                   No weekly, because month-and-year is how the client asked
 *                   to see history, and a fourth tab nobody uses is clutter.
 *
 * THERE IS NO LONGER A TARGET_PERIODS.
 *
 * It listed the periods a rep could commit to numbers for. Stage 2 of the
 * redesign (docs/flow-redesign-plan.md, changes 3 and 4) ended commitment
 * altogether: the daily target turned out to BE the daily plan and was merged
 * into it, and the weekly screen became a read-only account of what was
 * actually done. Nothing sets a target any more, so a list of periods you may
 * set one for describes nothing.
 *
 * The database is untouched — public.targets still exists, still has its rows,
 * and targets_period_valid still accepts all three periods. Reviving the
 * feature means restoring this list and the screens that read it, not a
 * migration. That is the whole reason it was removed from the app rather than
 * from the schema.
 *
 * `weekly` is still a period here, and still the one the week summary counts
 * over; it just is not a period anyone commits to.
 */
export const PERIODS = ["daily", "weekly", "monthly", "yearly"] as const;
export type Period = (typeof PERIODS)[number];

export const REPORT_PERIODS = ["daily", "monthly", "yearly"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

/** For sentences: "Commit to this day", "reopened this month". */
export const PERIOD_NOUN: Record<Period, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value);
}

export function isReportPeriod(value: unknown): value is ReportPeriod {
  return (
    typeof value === "string" && (REPORT_PERIODS as readonly string[]).includes(value)
  );
}

const DAY_MS = 86_400_000;

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseISO(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Rejects the likes of 2026-02-31, which Date would roll forward.
  return toISO(date) === value ? date : null;
}

/** The first of the month containing `dateISO`. */
export function monthStartOf(dateISO: string = todayISO()): string {
  const date = parseISO(dateISO) ?? parseISO(todayISO())!;
  return `${toISO(date).slice(0, 7)}-01`;
}

/** The last day of the month containing `dateISO`. */
export function monthEndOf(dateISO: string): string {
  const date = parseISO(dateISO) ?? parseISO(todayISO())!;
  // Day 0 of the next month is the last day of this one, which avoids having
  // to know about 30/31 days or February.
  const next = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  );
  return toISO(next);
}

/** The 1st of January of the year containing `dateISO`. */
export function yearStartOf(dateISO: string = todayISO()): string {
  const date = parseISO(dateISO) ?? parseISO(todayISO())!;
  return `${toISO(date).slice(0, 4)}-01-01`;
}

/** The 31st of December of the year containing `dateISO`. */
export function yearEndOf(dateISO: string): string {
  const date = parseISO(dateISO) ?? parseISO(todayISO())!;
  return `${toISO(date).slice(0, 4)}-12-31`;
}

/**
 * Snaps any date onto the grid its period requires, matching the
 * targets_period_start_aligned CHECK in migration 0013.
 *
 * The database refuses a weekly row that does not start on a Monday or a
 * monthly one that does not start on the 1st, so nothing should ever reach it
 * unsnapped — this is what makes sure of that on the way in.
 */
export function periodStartOf(period: Period, dateISO: string = todayISO()): string {
  const safe = parseISO(dateISO) ? dateISO : todayISO();
  switch (period) {
    case "daily":
      return safe;
    case "weekly":
      return mondayOf(safe);
    case "monthly":
      return monthStartOf(safe);
    case "yearly":
      return yearStartOf(safe);
  }
}

/**
 * The inclusive date range a period's ACHIEVED figures are counted over.
 *
 * The weekly case deliberately ends on the Sunday rather than the Saturday the
 * rep is shown, which is weeks.ts's weekCountEnd(): work does happen on
 * Sundays, and counting Monday to Saturday would drop that day out of every
 * weekly total permanently. Daily and monthly have no such split — a day is a
 * day, and a month ends when it ends.
 */
export function periodRange(
  period: Period,
  periodStart: string,
): { start: string; end: string } {
  switch (period) {
    case "daily":
      return { start: periodStart, end: periodStart };
    case "weekly":
      return { start: periodStart, end: weekCountEnd(periodStart) };
    case "monthly":
      return { start: periodStart, end: monthEndOf(periodStart) };
    case "yearly":
      return { start: periodStart, end: yearEndOf(periodStart) };
  }
}

/** Steps one period back (-1) or forward (+1) from `periodStart`. */
export function shiftPeriod(
  period: Period,
  periodStart: string,
  by: number,
): string {
  const date = parseISO(periodStart) ?? parseISO(todayISO())!;
  switch (period) {
    case "daily":
      return toISO(new Date(date.getTime() + by * DAY_MS));
    case "weekly":
      return mondayOf(toISO(new Date(date.getTime() + by * 7 * DAY_MS)));
    case "monthly":
      return toISO(
        new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + by, 1)),
      );
    case "yearly":
      return toISO(new Date(Date.UTC(date.getUTCFullYear() + by, 0, 1)));
  }
}

/** The period containing today. */
export function currentPeriodStart(period: Period): string {
  return periodStartOf(period, todayISO());
}

export function isCurrentPeriod(period: Period, periodStart: string): boolean {
  return periodStart === currentPeriodStart(period);
}

export function isFuturePeriod(period: Period, periodStart: string): boolean {
  return periodStart > currentPeriodStart(period);
}

/**
 * The range as a person reads it. The weekly case defers to weeks.ts so the
 * Targets screen and the Dashboard print a week identically — two spellings of
 * the same week is how they drifted apart once before.
 */
export function formatPeriodRange(period: Period, periodStart: string): string {
  switch (period) {
    case "daily":
      return formatDate(periodStart);
    case "weekly":
      return formatWeekRange(periodStart);
    case "monthly":
      return formatMonthYear(periodStart);
    case "yearly":
      return periodStart.slice(0, 4);
  }
}

/** A short relative label for the navigator: "Today", "This week", "Last month". */
export function periodLabel(period: Period, periodStart: string): string {
  if (period === "weekly") return weekLabel(periodStart);

  const current = currentPeriodStart(period);
  const noun = period === "daily" ? "day" : period === "monthly" ? "month" : "year";
  if (periodStart === current) {
    return period === "daily" ? "Today" : `This ${noun}`;
  }
  if (periodStart === shiftPeriod(period, current, -1)) {
    return period === "daily" ? "Yesterday" : `Last ${noun}`;
  }
  if (periodStart === shiftPeriod(period, current, 1)) {
    return period === "daily" ? "Tomorrow" : `Next ${noun}`;
  }
  return formatPeriodRange(period, periodStart);
}

/**
 * Reads a period-start from a URL, falling back to the current one.
 *
 * Anything malformed, or off the period's grid, is snapped rather than
 * rejected: a hand-edited ?start=2026-09-03 on the weekly view lands on that
 * week's Monday instead of erroring.
 */
export function normalisePeriodStart(
  period: Period,
  value: string | undefined,
): string {
  if (!value || !parseISO(value)) return currentPeriodStart(period);
  return periodStartOf(period, value);
}
