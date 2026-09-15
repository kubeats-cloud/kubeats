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
}

export async function listPurposeRows(): Promise<PurposeRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purposes")
    .select("id, label, activity")
    .order("label");

  if (error) {
    logError("admin:purposes", error);
    return [];
  }
  return data ?? [];
}

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  /** Null for an admin, who has no campus and sees every one. */
  campusName: string | null;
  /** From auth.users, which only the service-role client can read. */
  email: string | null;
  createdAt: string | null;
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
    .select("id, name, role, created_at, campuses(name)")
    .order("name");

  if (error) {
    logError("admin:team", error);
    return [];
  }

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
    // PostgREST returns a many-to-one embed as an object at runtime, and the
    // inferred type calls it an array. Both are read, so neither shape can
    // silently produce null and be mistaken for "this admin has no campus".
    campusName: (() => {
      const embed = (profile as unknown as {
        campuses?: { name: string | null } | { name: string | null }[] | null;
      }).campuses;
      if (!embed) return null;
      return Array.isArray(embed) ? (embed[0]?.name ?? null) : embed.name;
    })(),
    email: emails.get(profile.id) ?? null,
    createdAt: profile.created_at ?? null,
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
