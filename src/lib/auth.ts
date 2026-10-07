import "server-only";

import { cache } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Three tiers (H1, migration 0041).
 *
 * ⚠ THE `team_lead` ENTRY IS LOAD-BEARING EVEN WHILE NOBODY HOLDS THE ROLE, and
 * it is why this change ships ahead of the UI that assigns it. `profileSchema`
 * below validates against this union; a build that did not know the value would
 * fail the parse, report `profileStatus: "unavailable"` and fall back to
 * `role: "rep"` — and because a team lead HAS a campus (FO021), they would
 * degrade into a working rep who can reach /log and log visits in their own
 * name. Least privilege is the right default everywhere else in this file; for
 * this one value it is not a safe landing.
 */
export type Role = "rep" | "team_lead" | "admin";

export interface Profile {
  id: string;
  name: string | null;
  role: Role;
  mobile: string | null;
}

/**
 * Why the profile might not be here:
 *
 *   ready           row loaded
 *   no-profile      signed in, but no row yet (or RLS hides it)
 *   schema-pending  the profiles table does not exist — the Phase 1 migration
 *                   has not been applied to this project yet
 *   unavailable     the query failed for some other reason
 *
 * Only `ready` means the row is trustworthy. The app must stay usable in the
 * other three states rather than crashing.
 */
export type ProfileStatus =
  | "ready"
  | "no-profile"
  | "schema-pending"
  | "unavailable";

export interface CurrentUser {
  id: string;
  email: string;
  profile: Profile | null;
  profileStatus: ProfileStatus;
  /**
   * Least privilege: without a readable profile row we assume `rep`, never
   * `admin`. Admin-only surfaces must additionally check
   * `profileStatus === "ready"`.
   */
  role: Role;
  /** Something safe to show in the UI, falling back to the email address. */
  name: string;
}

const profileSchema = z.object({
  id: z.string(),
  name: z.string().nullable().default(null),
  role: z.enum(["rep", "team_lead", "admin"]),
  mobile: z.string().nullable().default(null),
});

/** Postgres "undefined table" and PostgREST's schema-cache miss. */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205", "PGRST106"]);

/**
 * The signed-in user plus their profile, or `null` when signed out.
 *
 * Uses `getUser()`, which verifies the token with Supabase — never `getSession()`,
 * whose cookie contents are attacker-supplied and must not be trusted on the
 * server. Wrapped in `cache()` so a layout and its page share one lookup.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  const email = user.email ?? "";
  const base = { id: user.id, email } as const;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, role, mobile")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    const status: ProfileStatus = MISSING_TABLE_CODES.has(error.code ?? "")
      ? "schema-pending"
      : "unavailable";

    if (status === "unavailable") {
      console.error("[auth] could not load profile", {
        code: error.code,
        message: error.message,
      });
    }

    return { ...base, profile: null, profileStatus: status, role: "rep", name: email };
  }

  if (!data) {
    return { ...base, profile: null, profileStatus: "no-profile", role: "rep", name: email };
  }

  const parsed = profileSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[auth] profile row did not match the expected shape", {
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return { ...base, profile: null, profileStatus: "unavailable", role: "rep", name: email };
  }

  const profile = parsed.data;
  return {
    ...base,
    profile,
    profileStatus: "ready",
    role: profile.role,
    name: profile.name?.trim() || email,
  };
});

/**
 * True only when a profile row was actually read and says `admin`.
 *
 * ⚠ ITS MEANING HAS NOT CHANGED AND MUST NOT. A third role is exactly the
 * moment somebody widens this one by habit, and `isAdmin()` gates the shared
 * vocabulary (statuses, purposes, locations), /data, /materials/manage and
 * every Settings mutation — none of which has a team dimension to scope to, so
 * a team lead editing them would write across every other team. Widen call
 * sites to `isStaff()` one at a time instead, which is a visible diff.
 */
export function isAdmin(user: CurrentUser | null): boolean {
  return user?.profileStatus === "ready" && user.role === "admin";
}

/** True only when a profile row was actually read and says `team_lead`. */
export function isTeamLead(user: CurrentUser | null): boolean {
  return user?.profileStatus === "ready" && user.role === "team_lead";
}

/**
 * Admin OR team lead — the workspace roles, as opposed to the field role.
 *
 * Most call sites that ask `isAdmin()` today are really asking "is this person
 * a supervisor looking at somebody else's work", and those become this. The
 * ones that are genuinely asking "may this person change something the whole
 * company shares" stay `isAdmin()`.
 *
 * Nobody is a team lead until H3, so this currently returns exactly what
 * `isAdmin()` returns. That equivalence is the point: it can be adopted at a
 * call site now and reviewed as a no-op.
 */
export function isStaff(user: CurrentUser | null): boolean {
  return (
    user?.profileStatus === "ready" &&
    (user.role === "admin" || user.role === "team_lead")
  );
}

/**
 * The role to BEHAVE as — which is not always the role on the row.
 *
 * ONE PLACE FOR THE DEGRADATION RULE. `getCurrentUser()` already returns
 * `role: "rep"` when the profile could not be read, and `isAdmin()` additionally
 * insists the row actually loaded. With two roles those two facts could be
 * carried separately; with three, every caller that wants "which bar, which
 * gate" would have to re-derive the same ternary, and the first one to get it
 * wrong hands a team lead a rep's navigation.
 *
 * So: unready profile → `rep`, exactly as today. Nothing here is a security
 * boundary — `proxy.ts` and RLS are — this decides what to render.
 */
export function effectiveRole(user: CurrentUser | null): Role {
  return user?.profileStatus === "ready" ? user.role : "rep";
}
