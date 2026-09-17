/**
 * What the app's sign-out answers with when it refuses.
 *
 * A PLAIN MODULE, NOT "use server", AND THAT IS THE WHOLE POINT OF IT EXISTING.
 * These two lived in `auth-actions.ts` beside the action that returns them,
 * which reads better and took the app down.
 *
 * Every RUNTIME export of a "use server" file is registered as a server
 * function reference — the build proves it, listing `exportedName:
 * "SIGN_OUT_READY"` in `server-reference-manifest.json` next to the actions. So
 * a client component importing the constant does not get `{ blockedBy: null }`,
 * it gets a callable reference to a server function. Handing that to
 * `useActionState` as the initial state threw during render.
 *
 * It threw on EVERY authenticated page, because the thing importing it is the
 * sign-out button in the top bar and the top bar is part of the `(app)` layout.
 * And it surfaced as Next's GLOBAL error page rather than this app's own
 * ErrorState, because an error raised in a layout's own JSX is not caught by
 * that segment's `error.tsx` — it bubbles past it to the root, where there is
 * no boundary but the global one. A user could log in and never see a screen.
 *
 * `admin-form-state.ts` carries the same warning and was written after the same
 * bug cost an afternoon in Phase 4. `tests/unit/use-server-exports.test.ts` now
 * fails the build rather than leaving the next person to rediscover it a third
 * time. An INTERFACE is erased at compile time and would have been harmless
 * here; it travels with the constant anyway, so the pair cannot drift apart.
 */

export interface SignOutState {
  /** The visit still holding them, or null when there is nothing in the way. */
  blockedBy: { planId: string; instituteName: string } | null;
}

export const SIGN_OUT_READY: SignOutState = { blockedBy: null };
