"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestPasswordReset,
  type ForgotPasswordState,
} from "@/lib/auth-actions";
import { forgotPasswordSchema } from "@/lib/validation/auth";

const INITIAL: ForgotPasswordState = { status: "idle", error: null };

/**
 * The one generic confirmation shows for ANY submitted email, registered or
 * not — the server action never tells the two apart (see its doc comment),
 * and repeating that decision in the UI would undo it.
 */
const SENT_MESSAGE =
  "If that email is registered, we've sent a link to reset your password. Check your inbox.";

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(requestPasswordReset, INITIAL);
  const [clientError, setClientError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const parsed = forgotPasswordSchema.safeParse({ email: data.get("email") });

    if (!parsed.success) {
      event.preventDefault();
      setClientError("Enter a valid email address.");
      return;
    }
    setClientError(null);
  }

  if (state.status === "sent") {
    return (
      <p
        role="status"
        aria-live="polite"
        className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
      >
        {SENT_MESSAGE}
      </p>
    );
  }

  const error = clientError ?? state.error;

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          required
          disabled={isPending}
          aria-invalid={error ? true : undefined}
          className="h-11"
          placeholder="you@example.com"
        />
      </div>

      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="bg-danger-subtle text-danger-subtle-foreground rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="h-11 w-full">
        {isPending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
