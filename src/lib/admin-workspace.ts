import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";
import { instituteNameOr } from "@/lib/institute-scope";
import { signVisitPhotos } from "@/lib/photos";
import type { VisitPhoto } from "@/lib/photos";
import { activityLabelFor } from "@/lib/validation/visit";
import { attributeToCurrentStatus } from "@/lib/visits";
import { mondayOf, weekCountEnd } from "@/lib/weeks";
import { todayISO } from "@/lib/dates";

/**
 * The reading side of the admin workspace.
 *
 * Everything here runs as the signed-in admin, not as the service role. That is
 * deliberate: RLS already says an admin may read the whole team's work, so
 * going through the ordinary client means these screens are governed by the
 * same policy as everything else. If the policy were ever wrong, these queries
 * would come back empty rather than quietly leaking past it.
 *
 * Nothing here writes. The admin's destructive tools live in admin-actions.ts,
 * where they can be guarded one at a time.
 */

export interface VisitRow {
  id: string;
  date: string;
  activity: string;
  activityLabel: string;
  lifecycle: string | null;
  status: string | null;
  notes: string | null;
  reportedAt: string | null;
  /**
   * The one value an admin scans down the register: where this visit left the
   * institute. Status first — see the note where it is built.
   */
  standing: string | null;
  memberId: string;
  memberName: string;
  instituteId: string;
  instituteName: string;
  city: string | null;
  photo: VisitPhoto | null;
  /**
   * PER-INSTITUTE, NOT PER-VISIT, and both of the fields below are.
   *
   * They answer "where does this school stand now", which is a different
   * question from everything else on the row — so ten visits to one school
   * repeat the same two values ten times down the column. That repetition is
   * accepted rather than designed around: the alternative is grouping the
   * register by institute, which would stop it being a register of visits.
   */

  /**
   * When the institute's status last actually CHANGED —
   * `institutes.status_updated_at`, maintained by the `institutes_touch_status`
   * trigger (0001) on every path that writes a status.
   *
   * AUTHORITATIVE, and deliberately not `max(institute_status_history.
   * changed_at)`. The two cannot disagree — `record_institute_status_change()`
   * (0011) fires on exactly the same condition, and its backfill seeded itself
   * from this column — but this one is a value on a row already being joined,
   * where the other is an aggregate over a second table. History stays the
   * source for the TIMELINE on the institute's own page; that is a different
   * question and it has a different shape.
   *
   * Null when the institute has never had a status set. Both triggers skip a
   * re-set of the SAME status, so this is the last real change rather than the
   * last write.
   */
  instituteStatusUpdatedAt: string | null;
  /**
   * The follow-up date owed at this INSTITUTE — derived, because there is no
   * such column.
   *
   * `follow_up_date` lives on `visits` (date only since 0023), so a
   * per-institute answer has to be chosen from among them:
   * `attributeToCurrentStatus()` picks the newest visit whose `status_set_to`
   * is the status the institute currently holds. Pending reads the same rule
   * through the same helper, so the two screens cannot disagree about a school.
   *
   * Null is ordinary and means one of three things, none of them an error: the
   * institute has no status, no visit accounts for the status it has, or the
   * visit that does was logged before Rule 5 began asking for a date.
   */
  instituteFollowUpDate: string | null;
}

export interface VisitFilters {
  member?: string;
  institute?: string;
  activity?: string;
  from?: string;
  to?: string;
  /** "reported" | "unreported" — whether a closing report has been filed. */
  reported?: string;
  /**
   * The institute's CURRENT status — `institutes.status`, the same value the
   * badge on /institutes shows and the same one Pending keys on.
   *
   * NOT `visits.status_set_to`, which is what the register's existing "Status"
   * column renders. Those are two different questions and the screen labels
   * them differently on purpose: `status_set_to` is where THIS visit left the
   * institute, which a later visit may since have superseded; this is where the
   * institute stands today.
   */
  instituteStatus?: string;
}

/**
 * TWO literal select strings, and they must stay literals.
 *
 * supabase-js can only infer a row type from a literal, so building either by
 * concatenation — or deriving the second from the first — would hand back
 * GenericStringError instead of a row, the trap that has caught this codebase
 * before. The cost is that the shared columns are written out twice and have to
 * be kept in step by hand.
 *
 * WHY TWO RATHER THAN ONE `!inner`. PostgREST filters on an embedded resource
 * restrict the PARENT only when the embed is an inner join, so the institute
 * status filter needs `institutes!inner`. Making that unconditional would
 * change the semantics of every other call: an inner join drops any visit whose
 * institute the caller cannot read. Today that would drop nothing — both
 * callers are admin-only and `institutes_select` is `is_admin() or …` — but
 * that is a property of who happens to call this function, not of the function,
 * and a register that silently omitted rows would be the hardest kind of bug to
 * notice. So the inner join is used only where it is asked for.
 *
 * `status` and `status_updated_at` ride in BOTH: `status_updated_at` is the
 * Last status update column, and `status` is what the per-institute follow-up
 * is derived against below. Neither depends on the filter being active.
 */
const VISIT_SELECT =
  "id, date, activity, lifecycle_status, status_set_to, notes, reported_at, visit_outcome, institute_interested, photo_url, member, institute_id, profiles!visits_member_fkey(name), institutes(name, city, status, status_updated_at)";

/** VISIT_SELECT with the institute embed made inner. Nothing else differs. */
const VISIT_SELECT_STATUS =
  "id, date, activity, lifecycle_status, status_set_to, notes, reported_at, visit_outcome, institute_interested, photo_url, member, institute_id, profiles!visits_member_fkey(name), institutes!inner(name, city, status, status_updated_at)";

interface RawVisit {
  id: string;
  date: string;
  activity: string;
  lifecycle_status: string | null;
  status_set_to: string | null;
  notes: string | null;
  reported_at: string | null;
  visit_outcome: string | null;
  institute_interested: boolean | null;
  photo_url: string | null;
  member: string;
  institute_id: string;
  profiles: { name: string | null } | null;
  institutes: {
    name: string | null;
    city: string | null;
    status: string | null;
    status_updated_at: string | null;
  } | null;
}

/** Keeps one page of results honest about how much there is behind it. */
export const REVIEW_PAGE_SIZE = 50;

export async function listTeamVisits(
  filters: VisitFilters = {},
): Promise<
  { ok: true; visits: VisitRow[]; total: number } | { ok: false }
> {
  const supabase = await createClient();

  /*
   * The inner-join variant ONLY when the status filter is on. See the note on
   * the two constants: an unconditional inner join would change what this
   * function returns for every other caller, and it would do it silently.
   */
  let query = supabase
    .from("visits")
    .select(filters.instituteStatus ? VISIT_SELECT_STATUS : VISIT_SELECT, {
      count: "exact",
    })
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(REVIEW_PAGE_SIZE);

  // Each filter is optional and independent; an absent one is not a filter of
  // "null", it is no filter at all.
  if (filters.member) query = query.eq("member", filters.member);
  if (filters.institute) query = query.eq("institute_id", filters.institute);
  if (filters.activity) query = query.eq("activity", filters.activity);
  if (filters.from) query = query.gte("date", filters.from);
  if (filters.to) query = query.lte("date", filters.to);
  if (filters.reported === "reported") query = query.not("reported_at", "is", null);
  if (filters.reported === "unreported") query = query.is("reported_at", null);
  // Dotted path, and it only restricts the rows because the embed above is
  // inner. With the outer embed this would filter the EMBED — every visit would
  // still come back, just with `institutes: null` on the ones that did not
  // match — which is the trap the two constants exist to avoid.
  if (filters.instituteStatus) {
    query = query.eq("institutes.status", filters.instituteStatus);
  }

  const { data, error, count } = await query;

  if (error) {
    logError("admin:visits", error);
    return { ok: false };
  }

  const rows = (data ?? []) as unknown as RawVisit[];
  const [photos, followUps] = await Promise.all([
    signVisitPhotos(rows.map((r) => r.photo_url)),
    instituteFollowUps(rows),
  ]);

  return {
    ok: true,
    total: count ?? rows.length,
    visits: rows.map((row) => ({
      id: row.id,
      date: row.date,
      activity: row.activity,
      activityLabel: activityLabelFor(row.activity),
      lifecycle: row.lifecycle_status,
      status: row.status_set_to,
      notes: row.notes,
      reportedAt: row.reported_at,
      /**
       * THE STATUS IS THE SUMMARY NOW — the third time this column has been
       * remapped, and the first time onto a field that cannot go quiet.
       *
       * It read `visit_outcome`, with `institute_interested` behind it. Phase 2
       * stage 1 withdraws both questions from the form, so for every visit
       * logged from now on both are null and this column would be a dash — the
       * exact failure stage 3 logged when it withdrew them the first time.
       *
       * `status_set_to` is the better answer anyway: it is what the rep
       * actually decided, it is what Pending and the institute badge read, and
       * from stage 4b it is compulsory, so it cannot be blank.
       *
       * The two old fields stay BEHIND it rather than being taken out. They
       * cost one comparison each and they are what keeps the hundreds of visits
       * already filed from going blank in the one column an admin scans down —
       * including any logged with "No change", which have no status at all.
       */
      standing:
        row.status_set_to ??
        row.visit_outcome ??
        (row.institute_interested === null
          ? null
          : row.institute_interested
            ? "Interested"
            : "Not interested"),
      memberId: row.member,
      memberName: row.profiles?.name ?? "Unknown",
      instituteId: row.institute_id,
      instituteName: instituteNameOr(row.institutes?.name, "admin-workspace"),
      city: row.institutes?.city ?? null,
      photo: row.photo_url ? (photos.get(row.photo_url) ?? { status: "expired" }) : null,
      instituteStatusUpdatedAt: row.institutes?.status_updated_at ?? null,
      instituteFollowUpDate: followUps.get(row.institute_id) ?? null,
    })),
  };
}

/**
 * The follow-up date owed at each institute on this page of the register.
 *
 * ONE EXTRA QUERY, and it has to be a query rather than a column: nothing
 * carries a per-institute follow-up date. `visits.follow_up_date` is per-visit,
 * so the per-institute answer is CHOSEN from among them by
 * `attributeToCurrentStatus()` — the newest visit whose `status_set_to` is the
 * status the institute holds now. Pending derives it the same way through the
 * same helper, which is the point of the helper.
 *
 * Bounded by the page rather than by the table: at most REVIEW_PAGE_SIZE rows
 * arrive, so at most that many distinct institutes are asked about, and
 * `visits_institute_id_idx` and `visits_status_set_to_idx` both already exist.
 * The `.in()` on status narrows it further — only the statuses actually present
 * on this page can produce a match, so a register filtered to one school does
 * not read every visit that ever set any status.
 *
 * A FAILURE IS A MISSING COLUMN, NOT A BROKEN SCREEN. The register's job is to
 * show the team's visits; a derived convenience that could not be computed
 * returns an empty map and every cell renders as "—". Logged, so it is not
 * silent.
 *
 * Runs as the signed-in admin like everything else here, so RLS decides what it
 * sees — which for an admin is every visit, and is what makes the answer
 * correct across reps: if A set "Session scheduled" and B later set "Session
 * done", B's visit is the one that matches and A's is rightly ignored.
 */
async function instituteFollowUps(
  rows: readonly RawVisit[],
): Promise<Map<string, string | null>> {
  const empty = new Map<string, string | null>();

  /*
   * Only institutes that actually HAVE a current status can be matched — a null
   * status has no visit to attribute it to, by definition. Built as a Map so
   * the helper can answer "what is this institute at" without a scan.
   */
  const currentStatus = new Map<string, string | null>();
  for (const row of rows) {
    const status = row.institutes?.status ?? null;
    if (status) currentStatus.set(row.institute_id, status);
  }
  if (currentStatus.size === 0) return empty;

  const statuses = [...new Set(currentStatus.values())].filter(
    (status): status is string => status !== null,
  );

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visits")
    .select("institute_id, status_set_to, follow_up_date")
    .in("institute_id", [...currentStatus.keys()])
    .in("status_set_to", statuses)
    // NEWEST FIRST, and this is the helper's precondition rather than a
    // presentation choice: it takes the first match, so reversing this returns
    // the oldest qualifying visit. `created_at` breaks a same-day tie in the
    // order things happened, which 0033 made reachable by letting a rep visit
    // one institute twice in a day.
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    logError("admin:visit-follow-ups", error);
    return empty;
  }

  const attribution = attributeToCurrentStatus(data ?? [], currentStatus);
  return new Map(
    [...attribution].map(([instituteId, visit]) => [
      instituteId,
      visit.follow_up_date ?? null,
    ]),
  );
}

/**
 * A visit somebody is still inside.
 *
 * Shown to an admin so a rep whose flow was orphaned can be unblocked the same
 * day rather than waiting for the 01:30 sweep — with one-open-visit-at-a-time,
 * an orphan stops that rep working anywhere.
 */
export interface OpenCheckIn {
  planId: string;
  /**
   * Added so one rep's open visits can be asked for. The Overview shows the
   * whole team and never needed it; the member hub does, and matching on
   * `memberName` instead would break on two reps sharing a name.
   */
  memberId: string;
  memberName: string;
  instituteName: string;
  checkinAt: string;
  /** Older than today, so almost certainly orphaned rather than in progress. */
  stale: boolean;
  locationManual: boolean;
}

export interface Overview {
  visitsToday: number;
  visitsThisWeek: number;
  reportsThisWeek: number;
  photosThisWeek: number;
  openLoops: number;
  activeToday: { id: string; name: string; visits: number }[];
  openCheckIns: OpenCheckIn[];
  recent: VisitRow[];
}

/**
 * The supervisor's landing screen, in one round of queries.
 *
 * Counts use `head: true` so Postgres returns a number and no rows — the page
 * needs "how many", not "which", and pulling a thousand rows to call .length on
 * them is how a dashboard becomes the slowest screen in an app.
 */
/**
 * Everyone currently inside a visit, or just one rep's.
 *
 * The predicate is the one `daily_plans_one_open_visit` indexes — checked in,
 * not checked out, not swept — so it asks exactly the question that decides
 * whether a rep is blocked from starting anywhere else.
 *
 * ONE DEFINITION, TWO CALLERS. The Overview asks for the whole team and the
 * member hub asks for one rep; before this was extracted the hub would either
 * have had to load the entire Overview to reach it, or keep a second copy of
 * the predicate that could drift from the index it mirrors.
 *
 * `stale` is relative to `todayISO()`, never a fresh Date: the app and
 * `app_today()` share one definition of the day (migration 0008), and a visit
 * counted as yesterday's by one and today's by the other is how a rep gets
 * told they are stuck when they are not.
 *
 * A failure is an EMPTY LIST, not a throw. This panel says "nobody is
 * mid-visit"; being wrong about that is better than taking down the screen it
 * sits on — the same call every other read on the Overview makes.
 */
export async function listOpenCheckIns(memberId?: string): Promise<OpenCheckIn[]> {
  const supabase = await createClient();
  const today = todayISO();

  let query = supabase
    .from("daily_plans")
    .select(
      "id, member, date, checkin_at, checkin_location_manual, profiles!daily_plans_member_fkey(name), institutes(name)",
    )
    .not("checkin_at", "is", null)
    .is("checkout_at", null)
    .eq("checkout_missing", false)
    .order("checkin_at", { ascending: true });

  if (memberId) query = query.eq("member", memberId);

  const { data, error } = await query;

  if (error) {
    logError("admin:open-checkins", error);
    return [];
  }

  return (
    (data ?? []) as unknown as {
      id: string;
      member: string;
      date: string;
      checkin_at: string;
      checkin_location_manual: boolean | null;
      profiles: { name: string | null } | null;
      institutes: { name: string | null } | null;
    }[]
  ).map((row) => ({
    planId: row.id,
    memberId: row.member,
    memberName: row.profiles?.name ?? "Unknown",
    instituteName: instituteNameOr(row.institutes?.name, "admin-workspace"),
    checkinAt: row.checkin_at,
    stale: row.date < today,
    locationManual: row.checkin_location_manual ?? false,
  }));
}

export async function getOverview(): Promise<
  { ok: true; data: Overview } | { ok: false }
> {
  const supabase = await createClient();
  const today = todayISO();
  const weekStart = mondayOf();
  const weekEnd = weekCountEnd(weekStart);

  const countOf = (build: (q: ReturnType<typeof baseCount>) => typeof q) => {
    return build(baseCount());
  };
  function baseCount() {
    return supabase.from("visits").select("id", { count: "exact", head: true });
  }

  const [todayCount, weekCount, reported, photos, loops, recent, actives, openIns] =
    await Promise.all([
      countOf((q) => q.eq("date", today)),
      countOf((q) => q.gte("date", weekStart).lte("date", weekEnd)),
      countOf((q) =>
        q.gte("date", weekStart).lte("date", weekEnd).not("reported_at", "is", null),
      ),
      countOf((q) =>
        q.gte("date", weekStart).lte("date", weekEnd).not("photo_url", "is", null),
      ),
      /*
       * Open loops: still "Set", and not yet closed by a later visit.
       *
       * `closed_at` IS NOT OPTIONAL HERE. Stage 3 closes a loop with a SECOND
       * visit and leaves this row at `lifecycle_status = 'Set'` for ever, so
       * without it this counted every Set ever logged and the tile could only
       * ever go up. Same predicate as `isPending()` in activity-report.ts and
       * `openLoopsAt()` in visits.ts — all three must agree, or two "open"
       * numbers disagree under one word.
       */
      countOf((q) => q.eq("lifecycle_status", "Set").is("closed_at", null)),
      listTeamVisits({}),
      supabase
        .from("visits")
        .select("member, profiles!visits_member_fkey(name)")
        .eq("date", today),
      // Everyone currently inside a visit. One definition, shared with the
      // member hub — see listOpenCheckIns().
      listOpenCheckIns(),
    ]);

  if (todayCount.error || weekCount.error || !recent.ok) {
    logError("admin:overview", todayCount.error ?? weekCount.error ?? "recent failed");
    return { ok: false };
  }

  // Who was out today, and how much they logged. Built here rather than in SQL
  // because it is a handful of rows and a group-by would need a view.
  const tally = new Map<string, { id: string; name: string; visits: number }>();
  for (const row of (actives.data ?? []) as unknown as {
    member: string;
    profiles: { name: string | null } | null;
  }[]) {
    const found = tally.get(row.member);
    if (found) found.visits += 1;
    else
      tally.set(row.member, {
        id: row.member,
        name: row.profiles?.name ?? "Unknown",
        visits: 1,
      });
  }

  return {
    ok: true,
    data: {
      visitsToday: todayCount.count ?? 0,
      visitsThisWeek: weekCount.count ?? 0,
      reportsThisWeek: reported.count ?? 0,
      photosThisWeek: photos.count ?? 0,
      openLoops: loops.count ?? 0,
      activeToday: [...tally.values()].sort((a, b) => b.visits - a.visits),
      openCheckIns: openIns,
      recent: recent.visits.slice(0, 8),
    },
  };
}

export interface AssignmentRow {
  id: string;
  date: string;
  purpose: string;
  held: boolean;
  memberName: string;
  instituteName: string;
}

/** What has been allocated and not yet done — the other half of the Assign screen. */
export async function listAssignments(): Promise<AssignmentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_plans")
    .select(
      "id, date, purpose, meetings_actual, assigned_by, profiles!daily_plans_member_fkey(name), institutes(name)",
    )
    .not("assigned_by", "is", null)
    .gte("date", todayISO())
    .order("date", { ascending: true });

  if (error) {
    logError("admin:assignments", error);
    return [];
  }

  return ((data ?? []) as unknown as {
    id: string;
    date: string;
    purpose: string;
    meetings_actual: number | null;
    profiles: { name: string | null } | null;
    institutes: { name: string | null } | null;
  }[]).map((row) => ({
    id: row.id,
    date: row.date,
    purpose: row.purpose,
    held: row.meetings_actual !== null,
    memberName: row.profiles?.name ?? "Unknown",
    instituteName: instituteNameOr(row.institutes?.name, "admin-workspace"),
  }));
}
