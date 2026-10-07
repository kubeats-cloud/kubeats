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

/** "Sep 2026" — a whole month, where naming a day would be misleading. */
export function formatMonthYear(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const { year, month } = fieldsOf(date);
  return `${MONTHS[month - 1]} ${year}`;
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
 * What this app means by "today": the calendar day in Asia/Kolkata.
 *
 * THIS DEFINITION IS SHARED WITH THE DATABASE. `public.app_today()` (migration
 * 0008) is the same expression in SQL, and the two must never drift, because
 * they meet: the app writes a plan row dated by this function, and `log_visit`
 * dates the visit and checks the meeting gate with that one. If they disagree
 * about the day, a rep is told the institute they are standing in front of is
 * not on today's plan.
 *
 * Reading the day from the runtime's own clock is what made them disagree
 * before. The server runs in UTC, so "today" turned over at 05:30 IST: a rep
 * logging at 01:00 filed against yesterday, and an admin assigning at that hour
 * was offered yesterday's date. Both ends now ask the same question — what day
 * is it in India — and get the same answer.
 *
 * `now` is injectable so a test can ask what the answer would be at 00:30 IST
 * without waiting until 00:30 IST.
 */
export function todayISO(now: Date = new Date()): string {
  const { year, month, day } = fieldsOf(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * The hour of the Asia/Kolkata clock, 0-23.
 *
 * ⚠ THE TIME-OF-DAY HALF OF todayISO()'s RULE, and it exists for the same
 * reason. The notification bell asks "is it past 16:00 in India yet?" and the
 * server runs in UTC, so `new Date().getHours()` answers 10:30 for an Indian
 * afternoon and the 16:00 nudge would appear five and a half hours late — the
 * same off-by-one-timezone bug this file was written to end, in the one
 * direction todayISO() does not cover.
 *
 * ⚠ IT IS A READER, NOT A SECOND SOURCE OF TRUTH. The authoritative evaluation
 * of these thresholds is pg_cron's: migration 0040 fires
 * materialise_daily_alerts() at fixed IST times and writes the row that becomes
 * the permanent record. This answers the live question the bell asks between
 * those runs — see `notifications.ts` for why the bell derives rather than
 * reading those rows.
 *
 * The thresholds themselves live in `notification-kinds.ts` beside the kinds
 * they gate, not here: this file knows what time it is in India and nothing
 * about what the app does at 16:00.
 *
 * `now` is injectable for the same reason todayISO()'s is — so a test can ask
 * what the answer would be at 19:00 IST without waiting until 19:00 IST.
 */
export function istHour(now: Date = new Date()): number {
  // `fieldsOf` pins hourCycle "h23", so midnight is "00" rather than the "24"
  // some engines emit for hour12:false — which would make `>= 19` true at
  // midnight and fire every night-time threshold at once.
  return Number(fieldsOf(now).hour);
}

/* ------------------------------------------------------------------ */
/* Day boundaries, for filtering a timestamptz by calendar day         */
/* ------------------------------------------------------------------ */

/**
 * The instant a given Asia/Kolkata calendar day begins, as an ISO timestamp.
 *
 * WHY THIS IS NEEDED AND WHY IT LIVES HERE. The pipeline report filters
 * `institutes.status_updated_at`, which is a `timestamptz`. Comparing it
 * against a bare `YYYY-MM-DD` is wrong at BOTH ends, and wrong in the
 * direction that silently loses rows: PostgREST coerces the bare date to
 * midnight UTC, so `.lte('2026-10-06')` cuts that day off at 05:30 IST and
 * drops almost all of it, while `.gte('2026-10-06')` quietly picks up the last
 * five and a half hours of the 5th. A whole working day either side.
 *
 * So a day has to be turned into an instant, and the only module allowed to
 * know which timezone that is, is this one — the same rule every rendered date
 * already follows.
 *
 * NOT `weeks.ts`, DELIBERATELY. That file does its arithmetic in UTC on
 * purpose, so a stored date-only `YYYY-MM-DD` cannot drift as it is added to
 * and subtracted from. These two functions do the opposite job: they take a
 * calendar day and ask when it starts in a particular place. Putting them
 * there would put a timezone inside the one module that is correct for not
 * having one.
 *
 * THE LITERAL +05:30 IS SAFE HERE, and it is worth saying why, because a
 * hard-coded offset is normally a bug waiting for a clock change. India has
 * not observed daylight saving since 1945 and IST is a single fixed offset for
 * the whole country — so there is no date on which this arithmetic changes.
 * The same assumption is already load-bearing in `0008`'s `app_today()`, which
 * is this function's twin in SQL. If this app ever serves a second timezone,
 * both halves move together, exactly as `todayISO()` and `app_today()` must.
 *
 * Returns null for anything that is not a `YYYY-MM-DD`, so a tampered query
 * string produces no clause rather than an invalid one.
 */
export function istDayStart(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  // Parsed as the instant IST midnight corresponds to, then emitted as UTC so
  // PostgREST receives an unambiguous timestamp rather than an offset it has
  // to interpret.
  const at = new Date(`${iso}T00:00:00+05:30`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * The instant the day AFTER a given Asia/Kolkata day begins.
 *
 * The upper bound of an inclusive range, used with `.lt()` rather than
 * `.lte()`. "Up to and including the 6th" is `< the 7th at 00:00 IST`, which
 * is the only form that includes 23:45 on the 6th — the boundary case the
 * `dates.test.ts` suite pins.
 *
 * Done by stepping the DATE in UTC and then asking `istDayStart()` for the
 * result, rather than adding 24 hours to an instant. The two agree for India
 * because the offset is fixed, but stepping the calendar is the operation that
 * stays correct if that ever stops being true.
 */
export function istDayAfter(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const stepped = new Date(Date.UTC(year, month - 1, day + 1));
  if (Number.isNaN(stepped.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = `${stepped.getUTCFullYear()}-${pad(stepped.getUTCMonth() + 1)}-${pad(
    stepped.getUTCDate(),
  )}`;
  return istDayStart(next);
}
