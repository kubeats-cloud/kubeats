"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type LoginState } from "@/lib/auth-actions";
import { loginSchema } from "@/lib/validation/auth";

const INITIAL: LoginState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, isPending] = useActionState(signIn, INITIAL);
  const [clientError, setClientError] = useState<string | null>(null);

  // First pass with the same schema the server action uses, so an obvious typo
  // is caught without a round trip. The server still re-validates.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: data.get("email"),
      password: data.get("password"),
    });

    if (!parsed.success) {
      event.preventDefault();
      setClientError("Enter a valid email address and your password.");
      return;
    }
    setClientError(null);
  }

  const error = clientError ?? state.error;

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="next" value={next} />

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

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={72}
          required
          disabled={isPending}
          aria-invalid={error ? true : undefined}
          className="h-11"
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
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
