"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/states";
import { GENERIC_ERROR } from "@/lib/errors";

/**
 * Last line of defence for anything a screen throws.
 *
 * Next.js already strips server error messages in production, and we do not
 * render `error.message` regardless — the user gets one plain sentence and a
 * retry, never a stack trace. The digest is logged so a report can be matched
 * to the server log.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] render failed", error.digest ?? error.message);
  }, [error]);

  return <ErrorState message={GENERIC_ERROR} onRetry={reset} />;
}
