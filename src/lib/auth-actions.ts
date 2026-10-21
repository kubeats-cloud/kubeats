"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { openVisitFor } from "@/lib/visits";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  safeNextPath,
} from "@/lib/validation/auth";
/*
 * THE STATE SHAPE LIVES IN A PLAIN MODULE, and it is not a matter of taste.
 * A "use server" file registers every runtime export as a server function
 * reference, so `SIGN_OUT_READY` declared here reached the sign-out button as
 * a callable rather than an object and threw on render — on every
 * authenticated page, since that button is in the top bar. sign-out-state.ts
 * has the full account.
 */
import { SIGN_OUT_READY, type SignOutState } from "@/lib/sign-out-state";

export interface LoginState {
  error: string | null;
}

export async function signIn(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  // Same wording as a rejected credential: a validation message here would
  // still be a signal about which field the server disliked.
  if (!parsed.success) {
    return { error: "Enter a valid email address and your password." };
  }

  // Re-checked here, not trusted from the field the page rendered: this action
  // is reachable without that page ever running.
  const next = safeNextPath(formData.get("next"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // The real reason is logged for us, never returned to the browser —
    // "no such user" and "wrong password" must be indistinguishable, or the
    // form becomes an account-enumeration oracle.
    console.error("[auth] sign-in rejected", {
      code: error.code,
      status: error.status,
    });

    if (error.status === 429) {
      return { error: "Too many attempts. Please wait a moment and try again." };
    }
    return { error: "Invalid email or password." };
  }

  revalidatePath("/", "layout");
  // Throws NEXT_REDIRECT — must stay outside the try/catch above.
  redirect(next);
}

export interface ForgotPasswordState {
  status: "idle" | "sent";
  error: string | null;
}

/**
 * Requests Supabase Auth's own password-reset email — no custom token, no
 * app-side email sending. `resetPasswordForEmail()` already answers
 * identically whether or not the address is registered; the one case this
 * still has to catch itself is rate limiting, which is an operational fact
 * about the request rather than a leak about the account.
 *
 * ALWAYS "sent" on the happy path, and on every other error too, for the same
 * reason `signIn` above never distinguishes "no such user" from "wrong
 * password": a form that answers differently depending on what it found in
 * `profiles` is an account-enumeration oracle wearing a nicer shape.
 */
export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { status: "idle", error: "Enter a valid email address." };
  }

  // The link has to come back to THIS app, so the redirect is built from the
  // request that is actually here rather than a configured app URL — there is
  // no such variable (env.ts has none), and this keeps the flow portable
  // across environments the way CLAUDE.md asks for.
  const origin = (await headers()).get("origin");
  if (!origin) {
    console.error("[auth] password reset requested with no Origin header");
    return { status: "idle", error: "Something went wrong. Please try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/reset-password`,
  });

  if (error) {
    // Never the email, never the raw message — only enough to find this in
    // the server logs if the rate limit starts firing for real traffic.
    console.error("[auth] password reset request failed", {
      code: error.code,
      status: error.status,
    });

    if (error.status === 429) {
      return { status: "idle", error: "Too many attempts. Please wait a moment and try again." };
    }
    // Falls through to the same "sent" response as success — see the
    // doc comment above for why.
  }

  return { status: "sent", error: null };
}

/**
 * Turns the `?code=` the emailed link lands with into the actual recovery
 * session, via Supabase Auth's own `exchangeCodeForSession()` — not a form
 * action, a plain server function the reset-password page's client component
 * calls once on mount.
 *
 * WHY THIS HAS TO BE A SERVER ACTION AND NOT BROWSER-SIDE CODE. `client.ts`'s
 * `createBrowserClient` uses Supabase's PKCE flow (its own default, unchanged
 * here), so `resetPasswordForEmail()` stores a code_verifier in a COOKIE when
 * it requests the email, and the emailed link's `redirect_to` — this app's own
 * `/reset-password` — comes back carrying `?code=` rather than session tokens
 * in the URL fragment. Exchanging that code for a session needs the matching
 * code_verifier, and only a request that carries the cookie can read it; a
 * Server Component cannot set the resulting session cookies back (server.ts's
 * own comment says so), which is exactly what a Server Action can do.
 *
 * `flowId` MUST be passed through explicitly, and this was found only by
 * reading auth-js itself rather than assuming the one-argument form shown in
 * most examples would work. auth-js keys the stored code_verifier per flow —
 * `sb-<ref>-auth-token-flow-<flowId>-code-verifier`, not a single fixed
 * cookie — and resolves which flow a bare `exchangeCodeForSession(code)` call
 * means by reading `sb_flow_id` out of `window.location` itself when none is
 * given. That default only works in a BROWSER; here, running server-side,
 * `window` does not exist, the lookup falls back to a now-unused fixed key,
 * and the exchange fails with `pkce_code_verifier_not_found` even though the
 * right cookie is sitting right there — verified by reproducing exactly that
 * failure before this parameter was added. GoTrue appends `sb_flow_id` to the
 * redirect itself (`_maybeAppendFlowIdToRedirect`), so the client component
 * reads it out of the URL and this function only has to forward it.
 *
 * Returns a boolean rather than throwing: an expired or already-used code is
 * an ordinary, expected outcome here, not a crash.
 */
export async function exchangeRecoveryCode(
  code: string,
  flowId: string | null,
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );

  if (error) {
    console.error("[auth] recovery code exchange failed", {
      code: error.code,
      status: error.status,
    });
    return { ok: false };
  }

  return { ok: true };
}

export interface ResetPasswordState {
  status: "idle" | "success";
  error: string | null;
}

/**
 * The last step of the reset-link flow: spend the recovery session the
 * emailed link set up to set a new password, via Supabase Auth's own
 * `updateUser()` — then sign out, so "log in again" (IQ6's own wording) means
 * an actual trip through `signIn` above with the new password, not a session
 * left open from the link.
 *
 * The recovery session lives in the same cookies `createClient()` already
 * reads: the browser's Supabase client wrote them the moment it parsed the
 * emailed link's tokens, before this action is ever posted to.
 */
export async function updateAccountPassword(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "idle",
      error: parsed.error.issues[0]?.message ?? "Check the password fields and try again.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No recovery session: the link was never valid, has already been used, or
  // has expired. Same sentence either way — nothing here can tell those apart,
  // and a form is the wrong place to guess.
  if (!user) {
    return {
      status: "idle",
      error: "This reset link is invalid or has expired. Request a new one.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    console.error("[auth] password update failed", {
      code: error.code,
      status: error.status,
    });
    return { status: "idle", error: "Could not update your password. Please try again." };
  }

  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  return { status: "success", error: null };
}

/**
 * The plain sign-out, with no questions asked.
 *
 * Kept exactly as it was and used by the MFA verify screen. The app's own
 * sign-out is `signOutIfFinished` below, which asks one question first; see the
 * note there for why the verify screen deliberately does not.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("[auth] sign-out failed", { code: error.code });
  }

  revalidatePath("/", "layout");
  redirect("/login");
}

/*
 * WHAT THIS GUARD COSTS, recorded because the number is surprising and two
 * plausible cures were tested and rejected.
 *
 * Putting ANY client component that imports a server action into the top bar —
 * which is part of the root layout, and therefore of every route — adds about
 * 90 KiB gzipped to the Worker. Measured against this branch's own baseline:
 * 2975 KiB with the plain server-rendered sign-out form, 3066 with this one.
 *
 * IT IS NOT THE DIALOG. Rendering the refusal as a plain banner with no Radix at
 * all measured 3107 — worse, not better.
 *
 * AND IT IS NOT MODULE PLACEMENT. Splitting `openVisitFor` into its own file and
 * this action into its own file — so that neither the login form's graph nor
 * every route's graph carries `visits.ts` — sounded right and measured 3089:
 * about 23 KiB WORSE, reproducibly, presumably because the Supabase server
 * client then lands in a chunk of its own instead of a shared one. Both splits
 * were reverted rather than kept on a rationale the measurement contradicts.
 *
 * CLAUDE.md is clear that size is no longer a GATE, and at ~30% of a 10 MiB
 * ceiling this is affordable. It is still a fact worth recording, and the fact
 * is that one confirmation costs 90 KiB on every page load.
 */
/**
 * Sign out — unless the rep is still standing in a visit.
 *
 * WHY THE RULE EXISTS. A visit is ended by FINISHING it: the report is filed and
 * "Save and check out" stamps the departure with a live position. A rep who
 * signs out mid-visit does not end it — they abandon it, and the row stays open
 * until the nightly sweep or an admin writes it off as "duration not recorded".
 * That is a real loss of data nobody notices until a week's numbers are short.
 *
 * NOTHING IS WRITTEN HERE, AND THAT IS THE POINT. The obvious alternative was to
 * check the rep out on their way past — and it would have invented a departure
 * time of "whenever they happened to tap sign-out", which the duration report
 * cannot tell from a measured one. Migration 0030 and `sweep_open_checkins()`
 * both refuse to invent that same number, for the same reason, and this refuses
 * to as well. This function READS. It never touches `daily_plans`.
 *
 * WHY IT IS A SERVER ACTION AND NOT A DATABASE RULE. CLAUDE.md's instruction is
 * that load-bearing rules belong in the database as RLS and triggers rather than
 * only in the UI, and it does not apply here for a structural reason: signing
 * out writes no row, so there is nothing for a trigger to fire on and no
 * constraint to attach. The server action IS the boundary — the check runs
 * here, where a client cannot skip it, rather than in the component, which could
 * be bypassed by posting the form directly.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   IT DOES NOT TRAP ANYONE. The two escape valves are untouched and are the
 *   recourse for a rep who genuinely cannot finish — a dead phone, a site they
 *   have already left. `guard_checkout_missing()` (FO020) still lets an admin
 *   clear a stuck visit from Overview, and `sweep_open_checkins()` still closes
 *   one left open overnight. Both record the honest "time not recorded". This
 *   rule makes abandoning a visit deliberate and visible instead of a side
 *   effect of tapping the wrong icon; it does not make it impossible.
 *
 *   IT DOES NOT APPLY TO ADMINS. An admin has no campus and does no field work
 *   (`enforce_profile_campus`, FO021), so the query would find nothing anyway —
 *   but the role is checked first so an admin's sign-out costs no round trip and
 *   cannot be held up by a data oddity.
 *
 *   IT DOES NOT COVER THE MFA SCREEN. `signOut()` above is still plain and is
 *   what `verify-form.tsx` uses. A rep stuck at the verification step cannot
 *   reach `/log` to finish anything, so guarding that door would lock them in
 *   the building rather than out of it. The open visit is then the sweep's, as
 *   it always was.
 */
/*
 * NO PARAMETERS, where every other action in this app takes (prev, formData).
 * `useActionState` accepts an action that ignores both — TypeScript allows a
 * function of fewer arguments — and this one genuinely has nothing to read: the
 * form carries no fields, and the only input is who is signed in, which comes
 * from the session rather than from the request body. Declaring them to match
 * the house shape and then ignoring them would leave two unused parameters
 * standing where a reader would look for the thing being validated.
 */
export async function signOutIfFinished(): Promise<SignOutState> {
  const user = await getCurrentUser();

  // No session, or an unreadable profile: there is nothing to protect and no
  // name to protect it with. Sign out rather than strand somebody in a session
  // they cannot use.
  if (!user) return await finish();
  if (isAdmin(user)) return await finish();

  const open = await openVisitFor(user.id);
  if (!open) return await finish();

  return {
    blockedBy: { planId: open.planId, instituteName: open.instituteName },
  };
}

/**
 * The sign-out itself, shared by both doors.
 *
 * Typed as returning SignOutState so the guarded action can `return await` it,
 * which it never actually does: `redirect()` throws NEXT_REDIRECT, so nothing
 * after it runs. The return type is what lets the call sites read as ordinary
 * code instead of ending in an unreachable return nobody can explain.
 */
async function finish(): Promise<SignOutState> {
  await signOut();
  return SIGN_OUT_READY;
}
