/**
 * Form state for the two-factor screens.
 *
 * A PLAIN MODULE, NOT "use server", for the reason `sign-out-state.ts` sets out
 * at length: every runtime export of a "use server" file becomes a server
 * function reference, so a constant exported from one is a callable rather than
 * an object by the time a client component reads it.
 *
 * THIS ONE WAS ALREADY WRONG, and had been for some time — `EMPTY_MFA_STATE`
 * was exported from `mfa-actions.ts`. It went unreported because both screens
 * that use it are ones nobody had reached: `/verify`, which only renders once a
 * factor is enrolled, and the sign-in security panel on the admin's Settings
 * page. It was found by sweeping every "use server" module after the same
 * mistake, newly made in `auth-actions.ts`, took the whole app down.
 */

export interface MfaState {
  error: string | null;
  /** Filled only by `startEnrolment`, and only on the way in. */
  enrolment?: { factorId: string; qr: string; secret: string } | null;
  ok?: boolean;
}

export const EMPTY_MFA_STATE: MfaState = { error: null, enrolment: null };
