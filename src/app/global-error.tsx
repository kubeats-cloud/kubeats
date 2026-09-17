"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/states";
import { GENERIC_ERROR } from "@/lib/errors";
import "./globals.css";

/**
 * The last boundary there is: the root layout itself failed.
 *
 * IT RENDERS ITS OWN <html> AND <body>, and that is a Next requirement rather
 * than a style choice. This component REPLACES the root layout — which is the
 * thing that has just thrown — so there is no document shell left to render
 * into. Omitting them produces a page with no structure at all, which is a
 * worse outcome than the one being handled.
 *
 * WHY globals.css IS IMPORTED HERE. The root layout is normally what pulls it
 * in, and the root layout is exactly what is not running. Without this import
 * the tokens `ErrorState` is built from — the danger colours, the radius, the
 * type scale — do not exist, and the branded screen degrades into unstyled
 * black text on white: the very thing this file was added to stop.
 *
 * WHY next/font IS NOT. The root layout sets `--font-inter` on <html>, and
 * re-invoking the font loader in the boundary that exists because the root
 * layout failed is a needless dependency on something adjacent to the failure.
 * It costs nothing to skip: `--font-sans` in globals.css falls through to
 * `ui-sans-serif, system-ui, sans-serif`, so the page renders in the platform
 * font rather than in nothing.
 *
 * HOW RARE THIS IS. The root layout takes no props, awaits nothing, reads no
 * environment variable and runs no query — it is a static shell. So reaching
 * this file means something further down failed catastrophically: a bad module
 * import, a bundler fault, a broken deploy. That is precisely when a user
 * deserves a sentence rather than a stack trace, and precisely when nothing
 * clever is available to offer them.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  /*
   * Next hands this boundary a `reset` as well. It is named in the type and
   * deliberately not destructured — see the note on the Reload button below
   * for why it is the wrong offer here, and so that the next reader can tell
   * "considered and rejected" from "forgotten".
   */
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] render failed", error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <main className="flex min-h-dvh items-center justify-center p-6">
          <div className="w-full max-w-md">
            {/*
              A RELOAD, NOT `reset`, and this is the one place the two differ.
              `reset` re-renders the same tree — including the root layout that
              has just failed — so on the failures that actually reach this
              file it tries the broken thing again. Fetching the document
              afresh is the only offer with a real chance of working, and it is
              also how a user picks up a fixed deploy.

              `reset` is named in the props above and deliberately left
              unused, so that this is visibly a decision rather than an
              oversight.
            */}
            <ErrorState
              message={GENERIC_ERROR}
              onRetry={() => window.location.reload()}
              retryLabel="Reload the page"
            />
          </div>
        </main>
      </body>
    </html>
  );
}
