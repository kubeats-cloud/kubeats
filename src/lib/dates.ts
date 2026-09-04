/**
 * Every date this app puts on a screen goes through here.
 *
 * WHY THIS EXISTS
 *
 * `new Date(x).toLocaleDateString()` asks the *runtime* for the locale and the
 * timezone. On the server that is UTC; in a rep's browser in Ahmedabad it is
 * UTC+5:30. For most of the day the two agree on what to print, so nothing
 * looks wrong — and then at 00:00 IST the client rolls over to tomorrow while
 * the server is still on yesterday, the two render different text, and React
 * refuses to hydrate the page (error #418). The whole app freezes on its
 * loading fallback until 05:30 IST, when UTC catches up.
 *
 * That is not a display bug that shows the wrong day. It is a nightly outage,
 * and it was found by a test run that happened to cross local midnight.
 *
 * THE RULE
 *
 * Nothing about a printed date may come from the runtime. Two things could:
 *
 *   the timezone — pinned to Asia/Kolkata below, which fixes the outage above;
 *   the wording  — pinned by assembling the string here, which is subtler.
 *
 * The second one deserves its own paragraph, because naming a locale is not
 * enough. Month abbreviations come from CLDR, and CLDR revises them: en-GB's
 * September went from "Sep" to "Sept" in 2022. A Worker on current ICU would
 * print "Sept" where a rep's older Android Chrome printed "Sep" — the same
 * mismatch and the same frozen page, except permanent rather than nightly, and
 * suffered only by the people on the cheapest phones. So the month names live
 * in this file as data. Intl is used for the calendar arithmetic, which is the
 * part it is genuinely needed for, and for nothing else.
 *
 * Asia/Kolkata rather than the viewer's own zone, because this is a tool for
 * one team in India and a visit's "day" is their day. A rep travelling with a
 * laptop still set to another zone sees the Indian working day, which is the
 * one the numbers are counted against.
 *
 * NOT THE SAME THING as the week maths in weeks.ts. That decides which day a
 * visit *belongs to*, and it does it in UTC on purpose so a stored date-only
 * string cannot drift. This file only decides how a value is spelled out.
 */

export const APP_TIME_ZONE = "Asia/Kolkata";

/** The only month wording the app has. See the header — deliberately not CLDR's. */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Splits an instant into its Asia/Kolkata calendar fields.
 *
 * Every part requested is numeric and en-US fixes the digits as Latin, so the
 * locale reaches nothing that survives this function: it shapes parts that are
 * read as numbers and thrown away. `hourCycle: "h23"` rather than
 * `hour12: false`, which leaves midnight as "24" on some engines.
 */
const PARTS = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: APP_TIME_ZONE,
});

interface Fields {
  year: string;
  month: number;
  day: number;
  hour: string;
  minute: string;
}

function fieldsOf(date: Date): Fields {
  const found: Record<string, string> = {};
  for (const part of PARTS.formatToParts(date)) found[part.type] = part.value;
  return {
    year: found.year,
    month: Number(found.month),
    day: Number(found.day),
    hour: found.hour,
    minute: found.minute,
  };
}

/**
 * Accepts what the database actually hands back: a date-only `YYYY-MM-DD`, a
 * full timestamp, a Date, or null.
 *
 * A date-only string is deliberately read as UTC midnight — that is how
 * Postgres `date` columns arrive and how weeks.ts already treats them. Shown in
 * Asia/Kolkata it lands at 05:30 the same morning, so the calendar day is the
 * one that was stored. Nudging it to local midnight instead would move a date
 * near the boundary onto the previous day.
 */
function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "4 Sep 2026". Returns "" for anything unusable, never "Invalid Date". */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const { year, month, day } = fieldsOf(date);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** "4 Sep" — the near end of a range, where one year at the far end is enough. */
export function formatDayMonth(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const { month, day } = fieldsOf(date);
  return `${day} ${MONTHS[month - 1]}`;
}

/** "4 Sep 2026, 14:15" — the moment something was filed or submitted. */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const { year, month, day, hour, minute } = fieldsOf(date);
  return `${day} ${MONTHS[month - 1]} ${year}, ${hour}:${minute}`;
}

/** "14:15", for a follow-up slot where the day is already on screen. */
export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const { hour, minute } = fieldsOf(date);
  return `${hour}:${minute}`;
}

/**
 * Today's calendar day in Asia/Kolkata, as YYYY-MM-DD.
 *
 * For the one case a *client* component needs a day during render. Reading the
 * day from the runtime's own clock is the same bug this file exists for: the
 * server says the 4th while a browser in India says the 5th, the two render
 * different text, and hydration fails.
 */
export function todayInAppZone(now: Date = new Date()): string {
  const { year, month, day } = fieldsOf(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}
