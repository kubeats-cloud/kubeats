import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { istHour, todayISO } from "@/lib/dates";
import type { AlertKind } from "@/lib/alert-kinds";
import {
  hrefFor,
  nextMonday,
  visibleNow,
  type NotificationItem,
} from "@/lib/notification-kinds";
import type { CurrentUser, Role } from "@/lib/auth";

/**
 * What the notification bell shows: what is DUE RIGHT NOW for the reader.
 *
 * =====================================================================
 * WHY THIS DERIVES INSTEAD OF READING `alert_events`
 * =====================================================================
 *
 * Migration 0040 already evaluates these five conditions on a pg_cron schedule
 * and writes a row per rep per day. Reading those rows would have been less
 * code. It would also have been wrong, in two separate ways, and both are worth
 * stating because the next reader will have the same idea:
 *
 *   1. AN ALERT ROW IS A RECORD, AND RECORDS DO NOT RETRACT. `/missed` says so
 *      on the page: "Closing them afterwards does not remove the day - the
 *      record is of what happened, not of what is outstanding now." That is
 *      correct for a record and fatal for a bell. A rep who closes their last
 *      follow-up at 19:30 would still be told, all evening, that follow-ups
 *      were missed - and the only way to clear it would be to dismiss a row
 *      that the missed-follow-up record is counting.
 *
 *   2. A ROW ONLY EXISTS WHERE CRON FIRED. A follow-up raised at 11:00 this
 *      morning is due today and has no 09:00 `follow_ups_due` row, because at
 *      09:00 it did not exist. The bell would be silent about work that is
 *      genuinely owed, which is the one failure a notification must not have.
 *
 * So the bell asks the SAME QUESTIONS - the predicates below are
 * `materialise_daily_alerts()`'s, kept deliberately identical - at the moment
 * the page is rendered. `alert_events` keeps its job (the permanent record
 * behind `/missed` and the dashboard banner) and this keeps its own: what is
 * true now. Neither is derived from the other, and they answer different
 * questions on purpose.
 *
 * =====================================================================
 * SCOPING IS RLS'S, TWICE, AND NEVER THIS FILE'S
 * =====================================================================
 *
 * A rep must see only their own; a team lead only their own reps'; a lead must
 * never see a second lead's team. None of that is enforced here:
 *
 *   `profiles_select`          `supervises(id)` since 0042, so the roster read
 *                              below returns a lead exactly themselves and
 *                              their own reps. It is what names the lines.
 *   `follow_up_tasks_select`   reaches through the parent institute with
 *                              `supervises(i.registered_by)`, so the task rows
 *                              a lead can read are already their team's.
 *   `daily_plans_select`       `supervises(member)`.
 *   `targets_select`           `supervises(member)`.
 *
 * The `.in("member", ids)` filters below are INTENT, not permission - they keep
 * a lead's own (always empty) items out of a per-rep list and let one query
 * serve both roles. Deleting one would change what is shown, never who may see
 * it. This is the rule `alerts.ts` states in its own header and the reason
 * nothing here writes a boundary of its own.
 *
 * ⚠ A LEAD HAS NO ITEMS OF THEIR OWN. They log no visits, own no institutes and
 * hold no targets, so every predicate below is empty for them personally; their
 * bell is entirely per-rep lines. That is not enforced by excluding them - it
 * falls out of there being no rows - which is why the roster below filters to
 * `role = 'rep'` for the same reason 0040's predicates do.
 *
 * ⚠ AN ADMIN HAS NO BELL. Not an empty one computed and discarded: `bellFor()`
 * returns early, so an admin's page load runs none of these queries. The
 * oversight pages are the admin's surface and a per-rep bell over 51 reps would
 * be a feed, which is the thing this is not.
 */

/** The shape the layout hands the bell. */
export interface BellState {
  items: NotificationItem[];
  /** The badge. Equal to `items.length`; named so the UI cannot drift from it. */
  count: number;
}

const EMPTY: BellState = { items: [], count: 0 };

interface Roster {
  /** Rep ids the reader may see items for. A rep's is just themselves. */
  ids: string[];
  /** id -> display name, for a lead's per-rep lines. Empty for a rep. */
  names: Map<string, string>;
}

/**
 * Who this reader's bell covers.
 *
 * For a REP: themselves, with no query - `supervises(self)` is true and reading
 * their own name back would be a round trip for a string we already hold.
 *
 * For a TEAM LEAD: every `role = 'rep'` profile RLS lets them read, which since
 * 0042 is exactly their own team. `team_lead_id` is NOT written into the filter
 * here: the policy already is that filter, and restating it would be a second
 * copy of the boundary that could drift from the first.
 */
async function rosterFor(user: CurrentUser, role: Role): Promise<Roster> {
  if (role === "rep") return { ids: [user.id], names: new Map() };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("role", "rep")
    .order("name");

  if (error) {
    logError("notifications:roster", error);
    return { ids: [], names: new Map() };
  }

  const rows = (data ?? []) as { id: string; name: string | null }[];
  return {
    ids: rows.map((r) => r.id),
    names: new Map(rows.map((r) => [r.id, r.name ?? "A rep"])),
  };
}

/** One line per member who has a count, newest concern first. */
function linesFor(
  kind: AlertKind,
  counts: Map<string, number>,
  roster: Roster,
  isOwn: boolean,
  weekStart: string | null = null,
): NotificationItem[] {
  const out: NotificationItem[] = [];
  for (const [memberId, count] of counts) {
    out.push({
      id: `${kind}:${isOwn ? "self" : memberId}`,
      kind,
      count,
      weekStart,
      memberName: isOwn ? null : (roster.names.get(memberId) ?? "A rep"),
      href: hrefFor(kind),
    });
  }
  return out;
}

/**
 * The bell for the signed-in person, recomputed on this request.
 *
 * `now` is injectable for the reason todayISO()'s is: so a test can ask what
 * the bell shows at 19:00 IST without waiting until 19:00 IST.
 */
export async function bellFor(
  user: CurrentUser,
  role: Role,
  now: Date = new Date(),
): Promise<BellState> {
  // An admin has no bell at all - see this file's header. Returned before any
  // query, so this costs an admin's page load nothing.
  if (role === "admin") return EMPTY;

  const today = todayISO(now);
  const hour = istHour(now);
  const isOwn = role === "rep";

  const roster = await rosterFor(user, role);
  if (roster.ids.length === 0) return EMPTY;

  const supabase = await createClient();
  const items: NotificationItem[] = [];

  /* ---- The three follow-up kinds: ONE query, asked three times ------- */
  /*
   * 0040's own comment: "ONE predicate asked three times." Due today and not
   * done. The three kinds differ only in the hour they become visible, so
   * fetching the rows once and gating each kind on the clock is the same
   * arithmetic with two fewer round trips.
   *
   * An OVERDUE task - due before today, still open - is deliberately NOT
   * counted, exactly as 0040 is careful not to: it was already recorded as
   * missed on its own due date, and counting it again daily would turn one miss
   * into a growing tally against a rep with one outstanding call.
   */
  const followUpKinds: AlertKind[] = [
    "follow_ups_due",
    "follow_ups_pending",
    "follow_ups_missed",
  ];

  if (followUpKinds.some((k) => visibleNow(k, hour, today))) {
    const { data, error } = await supabase
      .from("follow_up_tasks")
      .select("member")
      .eq("due_date", today)
      .is("done_at", null)
      .in("member", roster.ids);

    if (error) {
      logError("notifications:follow-ups", error);
    } else {
      const counts = new Map<string, number>();
      for (const row of (data ?? []) as { member: string }[]) {
        counts.set(row.member, (counts.get(row.member) ?? 0) + 1);
      }
      /*
       * ⚠ ONE KIND, NOT THREE STACKED. The three share a predicate, so a rep
       * with two open calls at 19:30 satisfies all three at once and a naive
       * loop would put three lines on the bell for one piece of work. The
       * LATEST threshold the clock has passed is the one that describes the
       * situation - missed after 19:00, still open after 16:00, due before that
       * - so the kinds are tried newest-first and the first match wins.
       */
      const kind = [...followUpKinds]
        .reverse()
        .find((k) => visibleNow(k, hour, today));
      if (kind && counts.size > 0) {
        items.push(...linesFor(kind, counts, roster, isOwn));
      }
    }
  }

  /* ---- Phase A: today's plan is empty -------------------------------- */
  if (visibleNow("day_plan_not_set", hour, today)) {
    const { data, error } = await supabase
      .from("daily_plans")
      .select("member")
      .eq("date", today)
      .is("assigned_by", null)
      .in("member", roster.ids);

    if (error) {
      logError("notifications:day-plan", error);
    } else {
      // `assigned_by is null` IS what "planned by the rep" means (0005 gives
      // that column to an admin assignment), so a rep whose whole day was
      // assigned to them still has not planned - which is what the alert is for.
      const planned = new Set(
        ((data ?? []) as { member: string }[]).map((r) => r.member),
      );
      const counts = new Map<string, number>();
      for (const id of roster.ids) if (!planned.has(id)) counts.set(id, 0);
      for (const line of linesFor("day_plan_not_set", counts, roster, isOwn)) {
        items.push({ ...line, count: null });
      }
    }
  }

  /* ---- Phase A: next week is not committed --------------------------- */
  if (visibleNow("weekly_plan_not_set", hour, today)) {
    const monday = nextMonday(today);
    const { data, error } = await supabase
      .from("targets")
      .select("member")
      .eq("period", "weekly")
      .eq("period_start", monday)
      .not("submitted_at", "is", null)
      .in("member", roster.ids);

    if (error) {
      logError("notifications:weekly-plan", error);
    } else {
      // A DRAFT IS NOT A COMMITMENT - Rule 6's lock only applies once submitted
      // - so `submitted_at is not null` is the test, and a rep with a
      // half-filled draft still needs the nudge. 0040 says the same.
      const committed = new Set(
        ((data ?? []) as { member: string }[]).map((r) => r.member),
      );
      const counts = new Map<string, number>();
      for (const id of roster.ids) if (!committed.has(id)) counts.set(id, 0);
      for (const line of linesFor(
        "weekly_plan_not_set",
        counts,
        roster,
        isOwn,
        monday,
      )) {
        items.push({ ...line, count: null });
      }
    }
  }

  return { items, count: items.length };
}
