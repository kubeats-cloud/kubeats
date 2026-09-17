"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signOut } from "@/lib/auth-actions";
import { verifyMfaCode } from "@/lib/mfa-actions";
import { EMPTY_MFA_STATE } from "@/lib/mfa-state";

export function VerifyForm({ next }: { next: string }) {
  const [state, formAction, isPending] = useActionState(
    verifyMfaCode,
    EMPTY_MFA_STATE,
  );

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />

        <div className="space-y-2">
          <Label htmlFor="code">6-digit code</Label>
          <Input
            id="code"
            name="code"
            /*
              `inputMode` numeric rather than `type="number"`, which would bring
              a spinner and would silently drop a leading zero on some browsers.
              autoComplete "one-time-code" is what lets a phone offer the code
              from the notification.
            */
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={7}
            required
            disabled={isPending}
            aria-invalid={state.error ? true : undefined}
            className="h-11 text-center text-lg tracking-[0.3em]"
            placeholder="000000"
          />
        </div>

        {state.error && (
          <p role="alert" className="text-danger text-sm">
            {state.error}
          </p>
        )}

        <Button type="submit" className="h-11 w-full" disabled={isPending}>
          {isPending ? "Checking…" : "Continue"}
        </Button>
      </form>

      {/* Its own form: nesting one inside the other is invalid HTML and the
          inner submit would post the outer action instead. */}
      <form action={signOut}>
        <Button type="submit" variant="ghost" className="h-11 w-full">
          Sign in as someone else
        </Button>
      </form>
    </div>
  );
}
