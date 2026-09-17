"use server";

import { revalidatePath } from "next/cache";
/*
 * Same reason as auth-actions.ts: a constant exported from a "use server"
 * file is a server reference by the time a client component reads it. See
 * mfa-state.ts.
 */
import type { MfaState } from "@/lib/mfa-state";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { safeNextPath } from "@/lib/validation/auth";
import { codeSchema } from "@/lib/validation/mfa-input";

/**
 * Everything that changes a factor, kept server-side.
 *
 * Enrolment could have run in the browser — the SDK is happy to — and does not,
 * for the reason the rest of this app does not either: the session cookies are
 * written by the server client, `signIn()` already works this way, and one
 * place that mutates auth state is easier to reason about than two. The QR and
 * the secret come back through the action's return value and are rendered; they
 * are the enrolling admin's own, and are shown once.
 */

const GENERIC_CODE_ERROR = "That code was not accepted. Try the next one.";

/* ------------------------------------------------------------------ */
/* The login challenge                                                 */
/* ------------------------------------------------------------------ */

/**
 * The second half of signing in, for an admin who has enrolled.
 *
 * Finding the factor here rather than trusting a hidden field is deliberate:
 * the only factor this can ever verify is one belonging to the caller's own
 * session, so there is nothing for a forged form to point at.
 *
 * On success the session is reissued at AAL2 and the cookies are written, which
 * is what the proxy gate reads on the very next request. Nothing else has to be
 * told.
 */
export async function verifyMfaCode(
  _prev: MfaState,
  formData: FormData,
): Promise<MfaState> {
  const parsed = codeSchema.safeParse(formData.get("code"));
  if (!parsed.success) {
    return { error: "Enter the 6-digit code from your authenticator app." };
  }

  const next = safeNextPath(formData.get("next"));
  const supabase = await createClient();

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    console.error("[mfa] list factors failed", { code: listError.code });
    return { error: "We could not check your security settings. Please try again." };
  }

  // `.all`, not `.totp`: the typed `totp` array is ALREADY narrowed to verified
  // factors (`Factor<'totp', 'verified'>[]`), so filtering it for status reads
  // as a check and is a no-op. Going through `.all` keeps the predicate the
  // thing that decides, which is what the rest of this file assumes.
  const factor = (factors?.all ?? []).find(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );
  if (!factor) {
    // No verified factor means the gate would not have sent them here — most
    // likely another admin has just cleared it for them. Sending them to "/"
    // lets the proxy make that call fresh rather than stranding them.
    redirect("/");
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: parsed.data,
  });

  if (error) {
    // Same reticence as signIn(): the real reason is logged, never returned.
    // A wrong code and an expired challenge must look identical.
    console.error("[mfa] verify rejected", { code: error.code, status: error.status });
    if (error.status === 429) {
      return { error: "Too many attempts. Please wait a moment and try again." };
    }
    return { error: GENERIC_CODE_ERROR };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

/* ------------------------------------------------------------------ */
/* Enrolment                                                           */
/* ------------------------------------------------------------------ */

/**
 * Step one: create the factor and hand back its QR code.
 *
 * The factor is `unverified` from here until `confirmEnrolment()` succeeds, and
 * an unverified factor does not raise `nextLevel` — so an admin who gets this
 * far and closes the tab has changed nothing about their next login. That is
 * the property that makes enrolment safe to start casually.
 *
 * ANY LEFTOVER UNVERIFIED FACTOR IS CLEARED FIRST. Supabase refuses a second
 * factor under the same friendly name, so an abandoned attempt would make every
 * later attempt fail with an error about a name the admin never typed.
 */
export async function startEnrolment(): Promise<MfaState> {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return { error: "Only an admin can set this up." };

  const supabase = await createClient();

  const { data: existing } = await supabase.auth.mfa.listFactors();
  // MUST read `.all`. `.totp` contains only VERIFIED factors, so the obvious
  // spelling of this loop — filter `.totp` for status !== "verified" — is
  // always empty and cleans up nothing, leaving the abandoned factor that
  // breaks the next attempt. The bug this loop exists to prevent.
  const stale = (existing?.all ?? []).filter((f) => f.status !== "verified");
  for (const factor of stale) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `authenticator-${Date.now()}`,
  });

  if (error || !data) {
    console.error("[mfa] enrol failed", { code: error?.code });
    return { error: "We could not start the setup. Please try again." };
  }

  return {
    error: null,
    enrolment: {
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
    },
  };
}

/**
 * Step two: the first code, which is what makes the factor real.
 *
 * From the moment this succeeds the account has a verified factor, so the proxy
 * gate starts applying to it on the next request. That is the one irreversible
 * moment in the flow, which is why the screen says so before this runs.
 */
export async function confirmEnrolment(
  _prev: MfaState,
  formData: FormData,
): Promise<MfaState> {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return { error: "Only an admin can set this up." };

  const factorId = String(formData.get("factor_id") ?? "");
  const parsed = codeSchema.safeParse(formData.get("code"));
  if (!factorId || !parsed.success) {
    return { error: "Enter the 6-digit code from your authenticator app." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: parsed.data,
  });

  if (error) {
    console.error("[mfa] enrolment verify rejected", { code: error.code });
    return { error: GENERIC_CODE_ERROR };
  }

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { error: null, ok: true };
}

/** Turning it off for yourself. Still requires a live session, so not a bypass. */
export async function removeOwnFactor(): Promise<MfaState> {
  const user = await getCurrentUser();
  if (!isAdmin(user)) return { error: "Only an admin can change this." };

  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  for (const factor of data?.all ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { error: null, ok: true };
}

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

/**
 * ADMIN-TO-ADMIN RESET — the recovery path, and the whole reason a lost phone
 * is an inconvenience rather than a lockout.
 *
 * One admin clears another's factor. The cleared admin then signs in with their
 * password alone, because with no verified factor the gate's condition is false
 * for them again, and they re-enrol on a new device. There are no recovery
 * codes to mislay because there are none: a recovery code could not raise a
 * session to AAL2 anyway, so it could not have satisfied the gate.
 *
 * SERVICE ROLE, AND THEREFORE GATED HARD. `createAdminClient()` bypasses RLS
 * entirely — the same key `createMember()` uses — so the caller's own admin
 * role is checked here first, exactly as that function does. The client will
 * not check it for you.
 *
 * THE LATERAL RISK IS REAL AND ACCEPTED: an attacker holding one admin's
 * password can clear the other's factor. That is inherent to admin-to-admin
 * reset, and the alternative — nobody can — is the lockout this exists to
 * prevent. Every reset is logged with both ids for that reason.
 *
 * If BOTH admins lose their devices, the break-glass is the Supabase dashboard
 * (Authentication → Users → delete the factor) or a service-role script calling
 * the same API. That is a credential separate from this app, which is what
 * makes "no scenario locks out every admin" true rather than hopeful.
 */
export async function clearMemberFactors(
  _prev: MfaState,
  formData: FormData,
): Promise<MfaState> {
  const actor = await getCurrentUser();
  if (!isAdmin(actor)) return { error: "Only an admin can do that." };

  const userId = String(formData.get("member_id") ?? "");
  if (!userId) return { error: "Choose whose sign-in code to reset." };

  /*
   * `createAdminClient()` throws when SUPABASE_SERVICE_ROLE_KEY is missing or
   * malformed — a deployment fault, but an uncaught one here leaves the form
   * and lands on the error boundary, which tells the admin nothing and loses
   * what they typed. Caught so it reads as a refusal like every other failure
   * on this screen. Same guard as admin.ts and mfa-admin.ts.
   */
  let db;
  try {
    db = createAdminClient();
  } catch (clientError) {
    console.error("[mfa] service-role client unavailable", {
      message: clientError instanceof Error ? clientError.message : "unknown error",
    });
    return {
      error:
        "Sign-in codes cannot be reset right now — the server is missing a setting. Please tell whoever set the app up.",
    };
  }

  const { data, error } = await db.auth.admin.mfa.listFactors({ userId });
  if (error) {
    console.error("[mfa] admin list factors failed", { code: error.code });
    return { error: "We could not read that person's security settings." };
  }

  const factors = data?.factors ?? [];
  if (factors.length === 0) {
    return { error: "That person has no sign-in code set up." };
  }

  for (const factor of factors) {
    const { error: deleteError } = await db.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId,
    });
    if (deleteError) {
      console.error("[mfa] admin delete factor failed", { code: deleteError.code });
      return { error: "We could not reset that person's sign-in code." };
    }
  }

  // Both ids, deliberately: this is a privileged act on somebody else's
  // account and the log is the only record that it happened.
  console.warn("[mfa] factors cleared by admin", { actor: actor?.id, target: userId });

  revalidatePath("/settings");
  return { error: null, ok: true };
}
