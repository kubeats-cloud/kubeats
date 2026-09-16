import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasVerifiedFactor, mfaChallengeRequired } from "@/lib/validation/mfa";

/**
 * Reading the two facts the gate needs, from sources that can be trusted.
 *
 * This file exists mostly to hold one decision, so it is worth stating at the
 * top: `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` would answer both
 * questions in a single call and IS NOT USED, because it reads the session
 * through `getSession()`. CLAUDE.md's rule — and the SDK's own security notice
 * — is that a cookie-borne session must not be trusted on the server: nothing
 * checks the JWT's signature on that path, so a tampered cookie claiming
 * `aal: "aal2"` would walk straight through the gate that exists to stop it.
 *
 * So the two facts come from two verified sources instead:
 *
 *   verified factor   `getUser()`, which checks the token with the auth server
 *                     and returns `user.factors`
 *   aal               `getClaims()`, which verifies the JWT
 *
 * Both are the SDK's own recommended replacements for `getSession()`.
 */

/** A minimal client shape, so the proxy's client and the server's both fit. */
type AnyClient = Pick<SupabaseClient, "auth">;

/**
 * The `aal` claim off a VERIFIED token, or null if it cannot be established.
 *
 * Null is the safe answer rather than a degraded one: `mfaChallengeRequired()`
 * treats anything that is not "aal2" as still owing a code, so a claims read
 * that fails sends an enrolled admin to the code screen instead of past it.
 * Failing closed is the only acceptable direction for this particular question.
 */
export async function readAal(supabase: AnyClient): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return null;
    const aal = data.claims.aal;
    return typeof aal === "string" ? aal : null;
  } catch {
    return null;
  }
}

/**
 * The gate's answer for this request.
 *
 * `factors` must come from a verified `getUser()` result. Passing the user
 * object straight through keeps the proxy from making a second round trip: it
 * has already called `getUser()` to decide whether anyone is signed in at all,
 * so the factor half of this question costs nothing, and only the claims read
 * is added.
 */
export async function challengeRequiredFor(
  supabase: AnyClient,
  user: { factors?: { status: string }[] | null } | null,
): Promise<boolean> {
  if (!user) return false;

  // Asked FIRST and short-circuited, so an un-enrolled admin and every rep
  // never reach the claims read at all. That is what keeps this off the hot
  // path for the people it does not apply to.
  const verifiedFactor = hasVerifiedFactor(user.factors);
  if (!verifiedFactor) return false;

  const aal = await readAal(supabase);
  return mfaChallengeRequired({ verifiedFactor, aal });
}
