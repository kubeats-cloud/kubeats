import "server-only";

import { cache } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type Role = "rep" | "admin";

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
  role: z.enum(["rep", "admin"]),
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

/** True only when a profile row was actually read and says `admin`. */
export function isAdmin(user: CurrentUser | null): boolean {
  return user?.profileStatus === "ready" && user.role === "admin";
}
