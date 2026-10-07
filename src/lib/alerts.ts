import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import type { AlertEvent, AlertKind } from "@/lib/alert-kinds";

/*
 * The vocabulary and the copy live in `alert-kinds.ts`, NOT here, and the split
 * is load-bearing: this module imports `@/lib/supabase/server`, so anything it
 * exports is unreachable from a Client Component. The Dashboard banner renders
 * `describeAlert()`. See that file's header for the build error this prevents.
 *
 * Re-exported so a Server Component needs one import rather than two.
 */
export { ALERT_KINDS, describeAlert } from "@/lib/alert-kinds";
export type { AlertEvent, AlertKind } from "@/lib/alert-kinds";

/**
 * Reading what the database noticed (Phase E1, migration 0040).
 *
 * THESE ROWS ARE NOT WRITTEN HERE AND CANNOT BE. `alert_events` grants
 * `authenticated` exactly `select` and `update (seen_at)` — no insert, no
 * delete, for a rep or an admin. Only `materialise_daily_alerts()` running as
 * the service role from pg_cron writes one. So this module reads, and
 * `alert-actions.ts` dismisses; there is deliberately no "create an alert"
 * anywhere in `src/`, because the missed-follow-up record is built by counting
 * these rows and a row anyone could write is not a record of anything.
 *
 * THE DELIVERY IS IN-APP, WHICH IS A CHOICE AND NOT A SHORTFALL. The evaluation
 * is exact and server-side — 10:00 IST is 10:00 IST whether or not anybody has
 * the app open — and the seeing happens on the next page load. Any outbound
 * channel added later (the plan recommends WhatsApp) is a SENDER over these
 * same rows, not a second source of truth.
 *
 * SCOPING IS RLS'S, and this module never writes a `member` filter for safety —
 * only for intent. `alert_events_select` is `member = auth.uid() or
 * is_admin()`, so a rep physically cannot read a colleague's row however this
 * file is called. Where a filter appears below it is narrowing an admin's view
 * to one person, which is a different question from permission.
 */

const SELECT = "id, kind, for_date, payload, seen_at, member";

interface RawAlert {
  id: string;
  kind: string;
  for_date: string;
  payload: Record<string, unknown> | null;
  seen_at: string | null;
  member: string;
}

function toAlert(row: RawAlert): AlertEvent {
  const payload = row.payload ?? {};
  // `payload` is jsonb and 0040 guarantees it is an OBJECT, but the keys inside
  // it are per-kind — so each is read defensively rather than asserted. A
  // missing count renders as null, never as 0: "0 follow-ups due" is a sentence
  // that should never appear, and would if an absent key became a number.
  const rawCount = payload.count;
  const rawWeek = payload.week_start;
  return {
    id: row.id,
    kind: row.kind as AlertKind,
    forDate: row.for_date,
    count: typeof rawCount === "number" ? rawCount : null,
    weekStart: typeof rawWeek === "string" ? rawWeek : null,
    seenAt: row.seen_at,
  };
}

/**
 * The unseen alerts for one member, newest first.
 *
 * Covered by `alert_events_unseen`, the partial index on `seen_at is null` —
 * which is why this asks for unseen rows rather than fetching everything and
 * filtering: the banner runs on every dashboard load, and the dismissed rows
 * are the majority after a few weeks.
 */
export async function listUnseenAlerts(
  memberId: string,
): Promise<{ ok: true; alerts: AlertEvent[] } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alert_events")
    .select(SELECT)
    .eq("member", memberId)
    .is("seen_at", null)
    .order("for_date", { ascending: false });

  if (error) {
    logError("alerts:unseen", error);
    return { ok: false };
  }

  return { ok: true, alerts: (data ?? []).map((row) => toAlert(row as RawAlert)) };
}

/* ------------------------------------------------------------------ */
/* The missed-follow-up record                                         */
/* ------------------------------------------------------------------ */

export interface MissedRecordRow {
  memberId: string;
  memberName: string;
  /** Distinct days that ended with a follow-up still open. */
  daysMissed: number;
  /** Follow-ups missed across those days, summed. */
  followUpsMissed: number;
  /** The most recent such day, for "when did this last happen". */
  lastMissed: string | null;
}

export interface MissedDay {
  forDate: string;
  count: number;
}

/**
 * ⚠ THE RECORD IS DERIVED, NOT STORED, and that is the design.
 *
 * "Misses per day" and "days-missed" are both aggregates over
 * `alert_events where kind = 'follow_ups_missed'`, so there is no second table
 * to keep in step and no way for the record to disagree with the alert a rep
 * actually saw. 0040's own header makes the same point from the SQL side.
 *
 * WHY `follow_ups_missed` AND NOT the other two follow-up kinds: the 09:00 row
 * says work was owed and the 16:00 row says some was still open at teatime —
 * neither is a miss. Only the 19:00 run records a day that ENDED with follow-ups
 * open. Counting any other kind here would make every ordinary working day a
 * missed one.
 *
 * SCOPING, AND THE PART WORTH READING. The RLS boundary is
 * `member = auth.uid() or is_admin()`, so a rep gets exactly their own row and
 * needs no argument. `memberIds` narrows an ADMIN's view to their own team and
 * is an intent filter, never a permission one — see this file's header, and
 * 0040 section 4 for why `profiles.created_by` is deliberately not the boundary
 * (it is null for every rep created before 0034, who would otherwise vanish
 * from the one screen built to show them).
 */
export async function missedFollowUpRecord(
  from: string,
  to: string,
  memberIds?: string[],
): Promise<{ ok: true; rows: MissedRecordRow[] } | { ok: false }> {
  const supabase = await createClient();

  let query = supabase
    .from("alert_events")
    .select("member, for_date, payload, profiles!alert_events_member_fkey(name)")
    .eq("kind", "follow_ups_missed")
    .gte("for_date", from)
    .lte("for_date", to)
    .order("for_date", { ascending: false });

  // An empty array means "no team", which must return nothing rather than
  // everyone — `.in()` with [] does exactly that, but only if the empty case is
  // not mistaken for "no filter". So it is tested for presence, not truthiness.
  if (memberIds) query = query.in("member", memberIds);

  const { data, error } = await query;
  if (error) {
    logError("alerts:missed-record", error);
    return { ok: false };
  }

  const byMember = new Map<string, MissedRecordRow>();
  for (const raw of data ?? []) {
    const row = raw as unknown as RawAlert & {
      profiles: unknown;
    };
    // PostgREST types a one-to-one embed as an array; the same narrowing
    // listFollowUpTasks() does, for the same reason.
    const joined = row.profiles;
    const profile = (Array.isArray(joined) ? joined[0] : joined) as
      | { name?: string | null }
      | null;

    const existing = byMember.get(row.member) ?? {
      memberId: row.member,
      memberName: profile?.name ?? "Unknown rep",
      daysMissed: 0,
      followUpsMissed: 0,
      lastMissed: null,
    };

    const count = row.payload?.count;
    existing.daysMissed += 1;
    // One row IS one day — alert_events_unique_per_day guarantees that — so the
    // day count is a row count and the follow-up count is the payload summed.
    existing.followUpsMissed += typeof count === "number" ? count : 0;
    if (!existing.lastMissed || row.for_date > existing.lastMissed) {
      existing.lastMissed = row.for_date;
    }
    byMember.set(row.member, existing);
  }

  return {
    ok: true,
    rows: [...byMember.values()].sort(
      (a, b) => b.daysMissed - a.daysMissed || a.memberName.localeCompare(b.memberName),
    ),
  };
}

/** The individual days behind one rep's count — what a CountLink opens. */
export async function missedDaysFor(
  memberId: string,
  from: string,
  to: string,
): Promise<{ ok: true; days: MissedDay[] } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alert_events")
    .select("for_date, payload")
    .eq("kind", "follow_ups_missed")
    .eq("member", memberId)
    .gte("for_date", from)
    .lte("for_date", to)
    .order("for_date", { ascending: false });

  if (error) {
    logError("alerts:missed-days", error);
    return { ok: false };
  }

  return {
    ok: true,
    days: (data ?? []).map((raw) => {
      const row = raw as unknown as { for_date: string; payload: Record<string, unknown> | null };
      const count = row.payload?.count;
      return { forDate: row.for_date, count: typeof count === "number" ? count : 0 };
    }),
  };
}
