import { describe, expect, it } from "vitest";
import { hasVerifiedFactor, mfaChallengeRequired } from "@/lib/validation/mfa";
import {
  MFA_VERIFY_PATH,
  isAdminOnlyPath,
  isAuthPath,
  isPublicPath,
  isRepOnlyPath,
} from "@/lib/nav";

/**
 * The gate, and the two promises made about it.
 *
 * The feature's whole safety argument is that it is keyed on a VERIFIED FACTOR
 * rather than on a role, so it is inert until each admin personally enrols.
 * That is a claim about a boolean, which means it can be asserted rather than
 * hoped for — and these are the assertions. If one of them starts failing, an
 * admin somewhere is about to be locked out of a live app.
 */

const verified = [{ status: "verified", factor_type: "totp" }];
const unverified = [{ status: "unverified", factor_type: "totp" }];

describe("who the gate applies to", () => {
  /*
   * PROMISE ONE: a rep's login is untouched.
   *
   * Not "we do not show them the prompt" — the condition is false for them, so
   * there is no prompt to show. A rep has no factor because enrolment lives in
   * Settings, which is already admin-only routing.
   */
  it("never challenges someone with no factors", () => {
    for (const factors of [undefined, null, []]) {
      expect(hasVerifiedFactor(factors)).toBe(false);
      expect(
        mfaChallengeRequired({ verifiedFactor: false, aal: "aal1" }),
      ).toBe(false);
    }
  });

  /*
   * PROMISE TWO: an admin who has not enrolled signs in exactly as today.
   *
   * This is the Amit-and-Pavan case on the first login after the deploy, and it
   * is the same assertion as the rep one above — which is the point. The gate
   * cannot tell them apart, because it never asks about the role.
   */
  it("treats an un-enrolled admin exactly like a rep", () => {
    const rep = mfaChallengeRequired({ verifiedFactor: false, aal: "aal1" });
    const admin = mfaChallengeRequired({ verifiedFactor: false, aal: "aal1" });
    expect(rep).toBe(admin);
    expect(admin).toBe(false);
  });

  /*
   * An enrolment begun and abandoned must not lock the account. `mfa.enroll()`
   * writes the factor row immediately and it stays unverified until the first
   * code is accepted, so counting it would demand a code from an authenticator
   * that was never set up.
   */
  it("ignores an unverified factor", () => {
    expect(hasVerifiedFactor(unverified)).toBe(false);
  });

  it("counts a verified factor, even beside an abandoned one", () => {
    expect(hasVerifiedFactor(verified)).toBe(true);
    expect(hasVerifiedFactor([...unverified, ...verified])).toBe(true);
  });
});

describe("the half-authenticated state", () => {
  /*
   * THE STATE THE PROXY GATE EXISTS FOR. A password alone produces a valid
   * AAL1 session; these are the cases that must still owe a code.
   */
  it("still owes a code at aal1", () => {
    expect(mfaChallengeRequired({ verifiedFactor: true, aal: "aal1" })).toBe(true);
  });

  it("is satisfied only by aal2", () => {
    expect(mfaChallengeRequired({ verifiedFactor: true, aal: "aal2" })).toBe(false);
  });

  /*
   * FAILS CLOSED. A claims read that cannot establish the level returns null,
   * and null is not "aal2" — so an enrolled admin is sent to the code screen
   * rather than past it. The only acceptable direction for this question.
   */
  it("fails closed on an unreadable or odd level", () => {
    for (const aal of [null, "", "aal0", "AAL2", "aal3", "unknown"]) {
      expect(mfaChallengeRequired({ verifiedFactor: true, aal }), String(aal)).toBe(
        true,
      );
    }
  });
});

describe("the code screen's route", () => {
  /*
   * THE TRAP THIS PINS. At "/login/verify" the prefix match in nav.ts makes it
   * an AUTH_PATH; the proxy bounces signed-in users off those, the MFA gate
   * sends them back, and the two correct rules make a redirect loop. Moving the
   * route under /login would reintroduce it silently, so the shape is asserted
   * rather than commented.
   */
  it("is top-level, not under /login", () => {
    expect(MFA_VERIFY_PATH).toBe("/verify");
    expect(MFA_VERIFY_PATH.startsWith("/login")).toBe(false);
  });

  it("is not an auth path, or a signed-in admin would be bounced off it", () => {
    expect(isAuthPath(MFA_VERIFY_PATH)).toBe(false);
  });

  it("is not public — being signed in is the precondition for being here", () => {
    expect(isPublicPath(MFA_VERIFY_PATH)).toBe(false);
  });

  it("belongs to neither role's area", () => {
    // Both roles reach it: the gate is keyed on a factor, not on a role, so a
    // rep who somehow enrolled must be able to finish signing in too.
    expect(isAdminOnlyPath(MFA_VERIFY_PATH)).toBe(false);
    expect(isRepOnlyPath(MFA_VERIFY_PATH)).toBe(false);
  });
});
