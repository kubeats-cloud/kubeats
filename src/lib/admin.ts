import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { logError } from "@/lib/errors";

/**
 * The admin surface's reads, and the one gate everything on it goes through.
 */

export interface AdminGate {
  ok: true;
  user: CurrentUser;
  supabase: Awaited<ReturnType<typeof createClient>>;
}

/**
 * The single server-side admin check.
 *
 * `profileStatus === "ready"` is required as well as the role: getCurrentUser
 * falls back to "rep" when the profile cannot be read, and an unreadable
 * profile must never be treated as an admin. Note this is a check for the sake
 * of a decent error message — every write underneath it is *also* covered by an
 * RLS policy keyed on is_admin(), so a bug here cannot by itself hand a rep
 * admin powers.
 */
export async function requireAdmin(): Promise<
  AdminGate | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Your session has expired. Please sign in again." };
  }
  if (user.role !== "admin" || user.profileStatus !== "ready") {
    return { ok: false, error: "Only an admin can do that." };
  }
  return { ok: true, user, supabase: await createClient() };
}

/* ------------------------------------------------------------------ */
/* Purposes                                                            */
/* ------------------------------------------------------------------ */

/**
 * The whole status vocabulary, RETIRED ONES INCLUDED.
 *
 * Deliberately not `listStatusCatalogue()`, which is what the rest of the app
 * reads: that one is for offering statuses to a rep and is the place retired
 * ones are filtered out. An admin managing the vocabulary has to see what they
 * retired, or there is no way to restore it and no way to understand why a
 * status they remember is not in the picker.
 *
 * The usage counts are what decide whether a status can still be renamed or
 * deleted at all — 0026's three foreign keys RESTRICT both — so the panel shows
 * them rather than letting an admin discover the rule by being refused.
 */
export interface StatusAdminRow {
  status: string;
  category: string;
  tone: string;
  sortOrder: number;
  isActive: boolean;
  asksExpectedDate: boolean;
  asksSessionDetail: boolean;
  asksHeadCount: boolean;
  /** How many institutes, visits and history rows are pinned to this status. */
  usedBy: number;
}

export async function listStatusRows(): Promise<StatusAdminRow[]> {
  const supabase = await createClient();

  const [statuses, institutes, visits, history] = await Promise.all([
    supabase
      .from("institute_statuses")
      .select(
        "status, category, tone, sort_order, is_active, asks_expected_date, asks_session_detail, asks_head_count",
      )
      .order("sort_order")
      .order("status"),
    supabase.from("institutes").select("status").not("status", "is", null),
    supabase.from("visits").select("status_set_to").not("status_set_to", "is", null),
    supabase.from("institute_status_history").select("status"),
  ]);

  if (statuses.error) {
    logError("admin:statuses", statuses.error);
    return [];
  }

  // Counted in the app rather than with three grouped queries: the volumes are
  // small, and an admin needs "is this pinned at all", not an exact census.
  const used = new Map<string, number>();
  const bump = (status: string | null) => {
    if (status) used.set(status, (used.get(status) ?? 0) + 1);
  };
  for (const row of institutes.data ?? []) bump(row.status);
  for (const row of visits.data ?? []) bump(row.status_set_to);
  for (const row of history.data ?? []) bump(row.status);

  return (statuses.data ?? []).map((row) => ({
    status: row.status,
    category: row.category,
    tone: row.tone ?? "neutral",
    sortOrder: row.sort_order ?? 100,
    isActive: row.is_active ?? true,
    asksExpectedDate: row.asks_expected_date ?? false,
    asksSessionDetail: row.asks_session_detail ?? false,
    asksHeadCount: row.asks_head_count ?? false,
    usedBy: used.get(row.status) ?? 0,
  }));
}

export interface PurposeRow {
  id: string;
  label: string;
  /**
   * Which of the six fixed activities a visit planned under this purpose counts
   * as (migration 0024). NOT NULL in the database; typed nullable here only so
   * a page rendered against a database where 0024 has not been applied degrades
   * to "not set" rather than throwing.
   */
  activity: string | null;
  /**
   * Set or Done for the two activities that have one, null for the other four
   * (migration 0025). It is what tells "Fix a session" from "Complete a
   * session" — both map to `session`, and without it Sessions Set and Sessions
   * Done would be indistinguishable — so the panel SHOWS it rather than leaving
   * an admin to infer which end of the metric a purpose feeds from its wording.
   */
  lifecycle: string | null;
  /**
   * False once an admin has retired it: still readable, so every plan that
   * used it can resolve its mapping for ever, and no longer offered to a rep.
   * `listPurposes()` in visits.ts is where the filtering actually happens.
   */
  isActive: boolean;
}

/**
 * Every purpose, retired ones INCLUDED.
 *
 * The opposite of `listPurposes()`, which a rep's picker reads and which filters
 * on `is_active`. An admin maintaining the vocabulary has to see what they
 * retired, or restoring it is impossible and the panel looks like a delete after
 * all. Retired rows sort last so the working list stays at the top.
 */
export async function listPurposeRows(): Promise<PurposeRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purposes")
    .select("id, label, activity, lifecycle, is_active")
    .order("is_active", { ascending: false })
    .order("label");

  if (error) {
    logError("admin:purposes", error);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    activity: row.activity,
    lifecycle: row.lifecycle,
    // Defaulted like every other nullable read here, so a page rendered against
    // a database without 0025 shows the list rather than an empty panel.
    isActive: row.is_active ?? true,
  }));
}

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */

/** A rep an institute could be reassigned to. */
export interface CampusRep {
  id: string;
  name: string;
}

/**
 * The reps on one campus — the only people an institute may be reassigned to.
 *
 * AN ADMIN IS NEVER IN THIS LIST, and that is the point rather than an
 * oversight: an admin has no campus (`enforce_profile_campus`, FO021), so
 * `campus_id` cannot match, and an institute owned by an admin would be one no
 * rep could see. Ownership is a rep's thing.
 *
 * A null `campusId` returns nothing rather than everyone. An institute with no
 * campus is a broken row — FO022 refuses to create one — and offering the whole
 * team as candidates would be inviting an admin to make it worse.
 */
export async function listRepsForCampus(
  campusId: string | null,
): Promise<CampusRep[]> {
  if (!campusId) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("role", "rep")
    .eq("campus_id", campusId)
    .order("name");

  if (error) {
    logError("admin:campus-reps", error);
    return [];
  }
  return (data ?? []).map((row) => ({ id: row.id, name: row.name ?? "Unnamed rep" }));
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  /** Null for an admin, who has no campus and sees every one. */
  campusName: string | null;
  /**
   * The same campus as an id, so the editor can preselect it.
   *
   * The name is for reading and this is for writing; keeping both means the
   * dialog never has to match a campus by its label, which two campuses in one
   * city could share. Null for an admin, exactly as `campusName` is.
   */
  campusId: string | null;
  /**
   * How many institutes this member OWNS — `institutes.registered_by`.
   *
   * Carried so the campus editor can say "this will move 14 institutes" BEFORE
   * an admin confirms, rather than reporting it afterwards. Correcting a rep's
   * campus without taking their pipeline with them leaves every one of these
   * invisible to them (0028's strict AND), so the number is the whole of what
   * the admin is deciding about.
   *
   * Zero for an admin, who registers nothing, and zero for a rep who has not
   * registered anything yet.
   */
  ownedInstitutes: number;
  /**
   * THE ADMIN WHO CREATED THIS ACCOUNT — `profiles.created_by`, migration 0034.
   *
   * A RECORD, NOT A PERMISSION, and the distinction is the whole of the
   * feature: nothing reads this to decide what anyone may see. `registered_by`
   * on an institute went the other way — 0028 turned an audit stamp into the
   * column `institutes_select` keys on — so it is worth saying plainly that
   * this one has not and must not.
   *
   * Null is an ordinary state, not an absence to be apologised for: every
   * account that predates 0034 has none (that file backfills nothing rather
   * than guessing), and the foreign key is `on delete set null`, so deleting a
   * departed admin returns their creations to it. Those are the rows the
   * hierarchy screen offers a picker for.
   */
  createdBy: string | null;
  /**
   * Resolved through the self-embed below. Null when `createdBy` is null, and
   * — in principle — when the creator's row is unreadable, which cannot happen
   * here: this function is only ever called in an admin's scope, and
   * `profiles_select` gives an admin every row.
   */
  createdByName: string | null;
  /** From auth.users, which only the service-role client can read. */
  email: string | null;
  createdAt: string | null;
  /**
   * Whether this row is the admin reading the page.
   *
   * Deciding it HERE rather than in the component, because the component would
   * need the viewer's id passed down to it and a prop that is only ever used
   * for one comparison is a prop that can be forgotten on one of the two
   * layouts. `deleteMember()` refuses a self-delete regardless — this is what
   * stops the button being offered in the first place.
   */
  isSelf: boolean;
  /**
   * Whether deleting this member would leave nobody able to administer the app.
   *
   * True only for the sole remaining admin. There is no self-signup and no
   * other route to an admin account, so this is a one-way door with nothing in
   * the product able to reopen it. Enforced in the action and again in the RPC;
   * this is the third copy, and the only one that prevents the tap.
   */
  isLastAdmin: boolean;
  /**
   * Whether this member has no `profiles.name` at all.
   *
   * `name` is nullable and `createMember` always sets one, so this is close to
   * unreachable — but it is the one state where the confirmation box cannot
   * work: the list shows the "Unnamed member" fallback, the admin types that,
   * and the action compares it against the empty string in the database and
   * refuses for ever. A button that can never succeed is exactly the failure
   * the Settings panels were already fixed for once, so it is disabled with a
   * reason instead.
   */
  isUnnamed: boolean;
}

/**
 * The name out of a many-to-one embed, whichever shape it arrives in.
 *
 * PostgREST returns a many-to-one embed as an OBJECT at runtime, and the type
 * supabase-js infers for it calls it an ARRAY. Both are read, so neither shape
 * can silently produce null and be mistaken for a real absence — which for
 * `campuses` would read as "this admin has no campus", a meaningful answer in
 * its own right.
 *
 * ONE CALLER AGAIN. It briefly had two: 0034's creator lookup was written as a
 * self-embed and is now resolved in TypeScript instead — see the note in
 * listTeamMembers() for why that embed could never have worked.
 */
function embeddedName(row: unknown, key: string): string | null {
  const embed = (row as Record<string, unknown>)[key] as
    | { name: string | null }
    | { name: string | null }[]
    | null
    | undefined;
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0]?.name ?? null) : embed.name;
}

/**
 * The team list.
 *
 * Names and roles come from `profiles` through the caller's own session, so RLS
 * still decides what is visible. Only the email addresses need the service-role
 * client, because auth.users is not exposed to PostgREST at all.
 */
export async function listTeamMembers(): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    /*
     * NO SELF-EMBED HERE, AND THAT IS A SCAR.
     *
     * This shipped as `creator:profiles!profiles_created_by_fkey(name)` and
     * took every admin screen down: PostgREST answered
     *
     *   PGRST200 — Could not find a relationship between 'profiles' and
     *   'profiles' in the schema cache. Searched for a foreign key
     *   relationship between 'profiles' and 'profiles' using the hint
     *   'profiles_created_by_fkey' … but no matches were found.
     *
     * and a failed query here returns [] — so the team list, Assign, Field
     * Presence, the hierarchy and the member editor all rendered empty against
     * a table with every row intact.
     *
     * THE CONSTRAINT NAME IS THE WRONG KIND OF HINT FOR A SELF-RELATION.
     * The foreign key was there all along — a dangling `created_by` is still
     * refused with 23503 naming `profiles_created_by_fkey` — and RLS was never
     * involved: the service role, which bypasses policies entirely, got the
     * identical PGRST200. PostgREST disambiguates a self-join by the
     * REFERENCING COLUMN (`profiles!created_by`), not by the constraint.
     *
     * SO THE EMBED IS GONE RATHER THAN RESPELLED. `profiles!created_by` does
     * work, but this query already fetches EVERY profile — it runs only in an
     * admin's scope, where `profiles_select` returns the whole table — so the
     * creator's name is already in hand and a second read of the same table to
     * find it is a round trip to learn something we have. Resolving it in
     * TypeScript also means no admin screen can ever again depend on
     * PostgREST's relationship graph agreeing with the schema.
     *
     * The map is COMPLETE BY CONSTRUCTION, which is what makes this safe:
     * FO028 refuses a `created_by` that is not an admin, admins are profiles,
     * and the foreign key is ON DELETE SET NULL — so a non-null `created_by`
     * always names a row in this very result set.
     */
    .select("id, name, role, created_at, campus_id, campuses(name), created_by")
    .order("name");

  if (error) {
    logError("admin:team", error);
    return [];
  }

  /*
   * Who owns how many institutes, for the campus editor's "this will move N".
   *
   * ONE COLUMN FOR THE WHOLE REGISTRY and tallied here, rather than a grouped
   * query per member — the same call `listStatusRows()` above makes about its
   * usage counts, and for the same reason: the volumes are small and a
   * group-by would need a view. This runs in an admin's scope, where
   * `institutes_select` is `is_admin() or …`, so the count is the true one
   * rather than the caller's slice of it.
   *
   * A failure is a missing NUMBER, not a broken list. The editor then shows no
   * count and says so, which is better than a team screen that will not load.
   */
  const owned = new Map<string, number>();
  const { data: institutes, error: ownedError } = await supabase
    .from("institutes")
    .select("registered_by")
    .not("registered_by", "is", null);

  if (ownedError) logError("admin:team-owned-institutes", ownedError);
  for (const row of institutes ?? []) {
    if (row.registered_by) {
      owned.set(row.registered_by, (owned.get(row.registered_by) ?? 0) + 1);
    }
  }

  /*
   * Who is reading, and how many admins there are — the two facts the Delete
   * button needs and the list did not carry.
   *
   * Both are counted from the rows already fetched rather than with a second
   * query: an admin's RLS scope returns every profile, which is the only scope
   * this function is ever called in (Settings is admin-only). Counting from a
   * narrower read would undercount admins and make the last-admin guard fire on
   * a team that has three.
   */
  const viewer = await getCurrentUser();
  const adminCount = (profiles ?? []).filter((p) => p.role === "admin").length;

  /*
   * id -> name, built from the rows already fetched. This is what replaced the
   * self-embed; see the note on the select above for why that embed could not
   * work and why a second query would be a round trip to learn what is already
   * in hand.
   */
  const names = new Map<string, string | null>(
    (profiles ?? []).map((profile) => [profile.id, profile.name]),
  );

  const emails = new Map<string, string | null>();
  try {
    const db = createAdminClient();
    const { data, error: authError } = await db.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (authError) logError("admin:team-emails", authError);
    for (const user of data?.users ?? []) emails.set(user.id, user.email ?? null);
  } catch (error) {
    // An email column that fails to load is a degraded list, not a broken page.
    logError("admin:team-emails", error);
  }

  return (profiles ?? []).map((profile) => ({
    id: profile.id,
    name: profile.name ?? "Unnamed member",
    role: profile.role,
    // Embedded through the foreign key. Null is the correct answer for an
    // admin, who has no campus — not a scoping failure, so no warning here.
    campusName: embeddedName(profile, "campuses"),
    campusId: profile.campus_id ?? null,
    ownedInstitutes: owned.get(profile.id) ?? 0,
    createdBy: profile.created_by ?? null,
    /*
     * Looked up in the rows we already have rather than embedded — see the
     * select above.
     *
     * Null means "no creator recorded", which for every account made before
     * 0034 is simply the truth. It cannot mean "the creator was not found":
     * FO028 keeps `created_by` pointing at an admin, and the FK's ON DELETE SET
     * NULL means a deleted creator leaves null rather than a dangling id.
     */
    createdByName: profile.created_by
      ? (names.get(profile.created_by) ?? null)
      : null,
    email: emails.get(profile.id) ?? null,
    createdAt: profile.created_at ?? null,
    isSelf: viewer?.id === profile.id,
    isLastAdmin: profile.role === "admin" && adminCount <= 1,
    // The RAW column, not the display fallback above — that is the whole point.
    isUnnamed: (profile.name ?? "").trim() === "",
  }));
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

export interface PhotoSelection {
  paths: string[];
  /** Visits in range that still expect a photo, whether or not it survives. */
  visits: number;
}

/**
 * Which photo files belong to visits dated on or before `cutoff`.
 *
 * Selected through the visits log rather than by file age, because "photos from
 * before last Monday" is a question about visits, and the answer stays stable
 * whether a file was uploaded at the gate or an hour later. Files with no visit
 * behind them — an upload from a form the rep abandoned — are not reachable
 * this way; the nightly age-based purge is what sweeps those up.
 */
export async function selectPhotosUpTo(cutoff: string): Promise<PhotoSelection> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visits")
    .select("photo_url")
    .not("photo_url", "is", null)
    .lte("date", cutoff);

  if (error) {
    logError("admin:photo-select", error);
    throw error;
  }

  const rows = data ?? [];
  const paths = [
    ...new Set(
      rows
        .map((row) => row.photo_url)
        .filter((path): path is string => typeof path === "string" && path.length > 0),
    ),
  ];
  return { paths, visits: rows.length };
}

/** How many photo files exist right now, for the panel's headline. */
export async function countStoredPhotos(): Promise<number | null> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("visits")
    .select("id", { count: "exact", head: true })
    .not("photo_url", "is", null);

  if (error) {
    logError("admin:photo-count", error);
    return null;
  }
  return count ?? 0;
}

/**
 * The retention window, read from the database rather than repeated here.
 *
 * `visit_photo_retention_days()` in migration 0003 is the single definition; if
 * it cannot be read (the migration has not been applied yet) the panel falls
 * back to the documented default rather than refusing to render.
 */
export async function getPhotoRetentionDays(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("visit_photo_retention_days");
  if (error || typeof data !== "number") {
    if (error) logError("admin:retention-days", error);
    return 30;
  }
  return data;
}
