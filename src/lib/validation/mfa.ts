/**
 * Whether this session still owes a second factor.
 *
 * ONE RULE, AND IT IS NOT "IS THIS AN ADMIN": a session needs AAL2 if and only
 * if that user has a VERIFIED factor. Keyed on the factor rather than on the
 * role, the whole feature is inert on every account until its owner personally
 * enrols — which is what removes the lockout window rather than merely making
 * it small. An admin who has not enrolled signs in exactly as they did before
 * this shipped, and so does every rep, because the condition below is false for
 * them for the same reason.
 *
 * PURE ON PURPOSE. No Supabase import, no React, no I/O — the caller hands in
 * the two facts and this decides. That is what lets the test suite state "a rep
 * is unaffected" as an assertion rather than as a hope, and it is why the proxy
 * and the server helpers can share one answer instead of each having an
 * opinion.
 */

/** The shape we need off a Supabase factor, without importing its types. */
export interface FactorLike {
  status: string;
  factor_type?: string;
}

/**
 * Does this user have a factor that actually counts?
 *
 * UNVERIFIED FACTORS DO NOT COUNT, and that is load-bearing rather than tidy.
 * `mfa.enroll()` creates the factor immediately and it stays `unverified` until
 * the first code is accepted, so an admin who opens the enrolment screen, scans
 * nothing and closes the tab has a factor row and no authenticator. Counting it
 * would lock them out of their own account with a code that exists nowhere.
 * Supabase takes the same view for its own `nextLevel`; this mirrors it so the
 * two cannot disagree.
 */
export function hasVerifiedFactor(
  factors: readonly FactorLike[] | null | undefined,
): boolean {
  return (factors ?? []).some((factor) => factor.status === "verified");
}

/**
 * Is this request sitting in the half-authenticated state?
 *
 * THE STATE THIS EXISTS FOR. `signInWithPassword()` returns a REAL session
 * before any code is typed — AAL1, fully able to read and write as that user.
 * Without a gate, an admin who closes the code screen navigates to "/" and
 * carries on, and the second factor is a screen you walk around rather than a
 * control. So every request is asked this question, not just the login.
 *
 * `aal` comes from the access token's own claim and must be read from a
 * VERIFIED token — see `readAal()` in `lib/mfa.ts` for why `getSession()` is
 * not allowed to answer it.
 */
export function mfaChallengeRequired(input: {
  verifiedFactor: boolean;
  aal: string | null;
}): boolean {
  return input.verifiedFactor && input.aal !== "aal2";
}
