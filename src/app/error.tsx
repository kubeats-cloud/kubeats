"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/states";
import { GENERIC_ERROR } from "@/lib/errors";

/**
 * The boundary for everything OUTSIDE the signed-in app.
 *
 * `(app)/error.tsx` has covered the signed-in screens for a long time, and a
 * reader could be forgiven for assuming that was the whole story. It was not:
 * that boundary only catches throws BELOW the `(app)` segment, so three kinds
 * of failure walked straight past it to Next's own unstyled default page —
 * the white "A server error occurred" with no branding and no way back.
 *
 *   /login, /verify, /privacy   outside the (app) group entirely, so nothing
 *                               was catching them. /login is the one screen
 *                               every single user meets.
 *   the (app) layout's own JSX  an error thrown while a LAYOUT renders is not
 *                               caught by that segment's error.tsx — it goes
 *                               to the PARENT. This is the exact shape of the
 *                               login crash, where a bad constant in the
 *                               sign-out button took every page down and
 *                               showed the generic page while doing it.
 *
 * Both now land here, inside the root layout, so they arrive branded, in the
 * app's own type and colours, with a way to try again.
 *
 * WHAT THIS DOES NOT COVER is the root layout itself — if that throws there is
 * no layout left to render a child into. `global-error.tsx` beside this file
 * is that last step.
 *
 * THE POINT OF HAVING IT AT ALL is that it needs no foresight. Every hardening
 * fix beside it removes one known way to crash; this one catches the ones
 * nobody has thought of yet, which — on the evidence of the login crash — is
 * the category that actually reaches users.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Same shape as (app)/error.tsx, so one grep finds both in the logs.
    console.error("[root] render failed", error.digest ?? error.message);
  }, [error]);

  return (
    /*
     * Centred by hand rather than by a shell. The screens this catches have no
     * layout of their own — /login centres its own card — so without this the
     * notice would sit flush against the top-left corner of an empty page and
     * read like a broken document rather than a handled state.
     */
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/*
          `reset` rather than a reload: these screens re-render from a server
          component, so a transient failure — a Supabase blip during the login
          page's own work — genuinely can come good on a second attempt without
          the cost of a full document fetch.

          The message is the GENERIC one, never `error.message`. Next strips
          server messages in production anyway; this makes the rule hold in
          development too, so nobody develops against a screen that leaks more
          than the real one will.
        */}
        <ErrorState message={GENERIC_ERROR} onRetry={reset} />
      </div>
    </main>
  );
}
