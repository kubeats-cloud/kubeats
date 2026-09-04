/**
 * Week arithmetic for the Monday–Saturday reporting week.
 *
 * Every date here is a plain YYYY-MM-DD string, and every calculation goes
 * through UTC. That is deliberate: `new Date("2026-09-04")` is parsed as UTC
 * midnight but `getDay()` reads it in local time, so in any timezone behind UTC
 * a Monday silently reads as the Sunday before. Doing the arithmetic in UTC and
 * only formatting for display keeps the grid stable wherever the app runs, and
 * matches `weekly_targets_week_starts_monday` in the database.
 *
 * Sunday is not part of the reporting week. It still exists in the calendar —
 * a visit could be logged on one — but it never falls inside a week window, so
 * the Saturday end date is a real boundary, not a display detail.
 */

const DAY_MS = 86_400_000;

/** YYYY-MM-DD for a UTC-midnight Date. */
function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parses YYYY-MM-DD as UTC midnight. Returns null for anything malformed. */
function parseISO(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Rejects the likes of 2026-02-31, which Date would roll forward.
  return toISO(date) === value ? date : null;
}

/** Today, in the server's local calendar, as YYYY-MM-DD. */
export function todayISO(): string {
  const now = new Date();
  return toISO(new Date(now.getTime() - now.getTimezoneOffset() * 60_000));
}

/** The Monday of the week containing `dateISO`. Defaults to this week. */
export function mondayOf(dateISO: string = todayISO()): string {
  const date = parseISO(dateISO) ?? parseISO(todayISO())!;
  // getUTCDay: 0 = Sunday. A Sunday belongs to the week that just ended, so it
  // steps back six days rather than forward one.
  const dayFromMonday = (date.getUTCDay() + 6) % 7;
  return toISO(new Date(date.getTime() - dayFromMonday * DAY_MS));
}

/** The Saturday that closes the week starting at `weekStart`. */
export function weekEnd(weekStart: string): string {
  const monday = parseISO(weekStart) ?? parseISO(mondayOf())!;
  return toISO(new Date(monday.getTime() + 5 * DAY_MS));
}

export function addWeeks(weekStart: string, count: number): string {
  const monday = parseISO(weekStart) ?? parseISO(mondayOf())!;
  return toISO(new Date(monday.getTime() + count * 7 * DAY_MS));
}

/**
 * The `?week=` parameter, normalised. Anything missing, malformed or not a
 * Monday falls back to the current week rather than erroring — a hand-edited
 * URL should land somewhere sensible, not on a stack trace.
 */
export function normaliseWeekParam(value: string | undefined): string {
  if (!value) return mondayOf();
  const parsed = parseISO(value);
  if (!parsed) return mondayOf();
  return mondayOf(value);
}

export function isCurrentWeek(weekStart: string): boolean {
  return weekStart === mondayOf();
}

export function isFutureWeek(weekStart: string): boolean {
  return weekStart > mondayOf();
}

/** True when `dateISO` falls inside the Mon–Sat window. */
export function isInWeek(dateISO: string | null, weekStart: string): boolean {
  if (!dateISO) return false;
  return dateISO >= weekStart && dateISO <= weekEnd(weekStart);
}

const DAY_MONTH = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "31 Aug – 5 Sep 2026", or "This week" for the current one. */
export function formatWeekRange(weekStart: string): string {
  const monday = parseISO(weekStart);
  const saturday = parseISO(weekEnd(weekStart));
  if (!monday || !saturday) return weekStart;
  return `${DAY_MONTH.format(monday)} – ${DAY_MONTH_YEAR.format(saturday)}`;
}

/** A short relative label for the navigator: "This week", "Last week", … */
export function weekLabel(weekStart: string): string {
  const current = mondayOf();
  const weeks = Math.round(
    (parseISO(weekStart)!.getTime() - parseISO(current)!.getTime()) / (7 * DAY_MS),
  );
  if (weeks === 0) return "This week";
  if (weeks === -1) return "Last week";
  if (weeks === 1) return "Next week";
  if (weeks < 0) return `${Math.abs(weeks)} weeks ago`;
  return `In ${weeks} weeks`;
}
