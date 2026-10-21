"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import {
  exchangeRecoveryCode,
  updateAccountPassword,
  type ResetPasswordState,
} from "@/lib/auth-actions";
import { resetPasswordSchema } from "@/lib/validation/auth";

const INITIAL: ResetPasswordState = { status: "idle", error: null };

const EXPIRED_MESSAGE = "This reset link is invalid or has expired. Request a new one.";

type Bootstrap =
  | { phase: "checking" }
  | { phase: "ready" }
  | { phase: "invalid"; message: string };

/**
 * GoTrue's own error redirect for a bad token — expired, already used, or
 * tampered with — names the problem in `error_description`, as either a query
 * parameter (the PKCE `?code=` shape this app's client uses) or, if a project
 * is ever reconfigured onto the older implicit flow, a `#error=` hash
 * fragment. Both are checked so this page explains itself either way instead
 * of falling through to a generic timeout message.
 */
function readLinkError(location: Location): string | null {
  for (const raw of [location.search, location.hash]) {
    const params = new URLSearchParams(raw.replace(/^[?#]/, ""));
    const description = params.get("error_description");
    if (description) return description.replaceAll("+", " ");
    if (params.get("error")) return EXPIRED_MESSAGE;
  }
  return null;
}

export function ResetPasswordForm() {
  const [bootstrap, setBootstrap] = useState<Bootstrap>({ phase: "checking" });
  const [state, formAction, isPending] = useActionState(updateAccountPassword, INITIAL);
  const [clientError, setClientError] = useState<string | null>(null);

  // `code` is a SINGLE-USE PKCE auth code: exchanging it twice necessarily
  // fails the second time (the server has already consumed the verifier), and
  // in dev, React's Strict Mode runs this effect twice on mount specifically
  // to surface missing cleanup like this. A ref survives that mount→cleanup→
  // remount cycle — unlike a variable captured by one effect call — which is
  // what makes it able to stop the second invocation from re-running the
  // exchange at all, rather than merely discard whichever of two results
  // arrives second. That distinction is why there is no `cancelled`-style
  // guard here any more: the FIRST invocation's cleanup fires immediately on
  // the synthetic remount, before its still-in-flight exchange resolves, so a
  // "was this effect cancelled" flag would discard that invocation's own
  // eventual SUCCESS — which is exactly what happened before this comment was
  // written (verified: the exchange returned `ok: true` and the page still
  // showed "Checking your reset link…" forever). The ref makes a second call
  // impossible instead, so whichever single call happens is the one whose
  // result should always apply.
  const hasBootstrapped = useRef(false);

  useEffect(() => {
    const settle = (next: Bootstrap) => setBootstrap(next);

    async function bootstrapSession() {
      if (hasBootstrapped.current) return;
      hasBootstrapped.current = true;

      const linkError = readLinkError(window.location);
      if (linkError) {
        settle({ phase: "invalid", message: linkError });
        return;
      }

      const query = new URLSearchParams(window.location.search);
      const code = query.get("code");
      if (code) {
        // GoTrue appends its own flow id alongside the code — see the doc
        // comment on exchangeRecoveryCode for why this cannot be left out.
        const flowId = query.get("sb_flow_id");
        const result = await exchangeRecoveryCode(code, flowId);
        settle(
          result.ok
            ? { phase: "ready" }
            : { phase: "invalid", message: EXPIRED_MESSAGE },
        );
        return;
      }

      // No `?code=` and no `?error=`: fall back to checking for a session the
      // OLDER implicit-flow link would have set up directly from the URL
      // fragment (Supabase's browser client parses that on its own). Covers a
      // project reconfigured off PKCE without this page needing to know which
      // mode is active.
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      settle(
        data.session
          ? { phase: "ready" }
          : { phase: "invalid", message: EXPIRED_MESSAGE },
      );
    }

    void bootstrapSession();
  }, []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const parsed = resetPasswordSchema.safeParse({
      password: data.get("password"),
      confirmPassword: data.get("confirmPassword"),
    });

    if (!parsed.success) {
      event.preventDefault();
      setClientError(parsed.error.issues[0]?.message ?? "Check the password fields and try again.");
      return;
    }
    setClientError(null);
  }

  if (state.status === "success") {
    return (
      <div className="space-y-4">
        <p
          role="status"
          aria-live="polite"
          className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
        >
          Password updated. You can now log in with your new password.
        </p>
        <Button asChild className="h-11 w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  if (bootstrap.phase === "checking") {
    return <p className="text-muted-foreground text-sm">Checking your reset link…</p>;
  }

  if (bootstrap.phase === "invalid") {
    return (
      <div className="space-y-4">
        <p
          role="alert"
          aria-live="polite"
          className="bg-danger-subtle text-danger-subtle-foreground rounded-md px-3 py-2 text-sm"
        >
          {bootstrap.message}
        </p>
        <Button asChild variant="outline" className="h-11 w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  const error = clientError ?? state.error;

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          maxLength={72}
          required
          disabled={isPending}
          aria-invalid={error ? true : undefined}
          className="h-11"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
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
        {isPending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
