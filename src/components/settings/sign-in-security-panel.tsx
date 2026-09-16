"use client";

import { useActionState, useState, useTransition } from "react";
import { ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearMemberFactors,
  confirmEnrolment,
  removeOwnFactor,
  startEnrolment,
  EMPTY_MFA_STATE,
  type MfaState,
} from "@/lib/mfa-actions";
import type { AdminFactorState } from "@/lib/mfa-admin";

/**
 * Sign-in security: enrol yourself, and reset another admin who is locked out.
 *
 * ADMIN-ONLY WITHOUT A NEW RULE. This renders on Settings, which is already in
 * `ADMIN_ONLY_PATHS`, so "admins only" falls out of routing that already exists
 * rather than becoming a second thing to keep in step. A rep never sees it and
 * never enrols, which is exactly why the gate never fires for them.
 */
export function SignInSecurityPanel({
  enrolled,
  viewerId,
  admins,
}: {
  enrolled: boolean;
  viewerId: string;
  admins: AdminFactorState[];
}) {
  const [setup, setSetup] = useState<MfaState["enrolment"] | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();

  const [confirmState, confirmAction, confirming] = useActionState(
    confirmEnrolment,
    EMPTY_MFA_STATE,
  );
  const [resetState, resetAction, resetting] = useActionState(
    clearMemberFactors,
    EMPTY_MFA_STATE,
  );
  const [removing, removeTransition] = useTransition();

  const done = confirmState.ok;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sign-in security</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ---------------- Your own factor ---------------- */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {enrolled || done ? (
              <>
                <ShieldCheckIcon className="text-success size-4" aria-hidden />
                <span className="text-sm font-medium">
                  An authenticator code is required when you sign in.
                </span>
                <Badge variant="success">On</Badge>
              </>
            ) : (
              <>
                <ShieldOffIcon className="text-muted-foreground size-4" aria-hidden />
                <span className="text-sm font-medium">
                  Your account uses a password only.
                </span>
                <Badge variant="neutral">Off</Badge>
              </>
            )}
          </div>

          {!enrolled && !done && !setup && (
            <>
              <p className="text-muted-foreground text-xs">
                Add a 6-digit code from an authenticator app. It applies to your
                account only, and nothing changes for anyone else.
              </p>
              {/*
                THE RECOMMENDATION THAT MAKES A LOST PHONE A NON-EVENT.
                Supabase allows more than one TOTP factor, and the likeliest
                incident by far is one broken or replaced handset. Two apps on
                two devices turns that from a recovery into a shrug.
              */}
              <p className="text-muted-foreground text-xs">
                Set up two authenticators if you can, on two different devices.
                If one is lost you still have the other, and the other admin can
                reset you either way.
              </p>
              {startError && <p className="text-danger text-xs">{startError}</p>}
              <Button
                type="button"
                className="h-11"
                disabled={starting}
                onClick={() =>
                  startTransition(async () => {
                    const result = await startEnrolment();
                    if (result.error) {
                      setStartError(result.error);
                      return;
                    }
                    setStartError(null);
                    setSetup(result.enrolment ?? null);
                  })
                }
              >
                {starting ? "Starting…" : "Set up an authenticator"}
              </Button>
            </>
          )}

          {setup && !done && (
            <div className="border-border space-y-3 rounded-md border p-3">
              <p className="text-xs">
                Scan this with your authenticator app, then type the code it
                shows.
              </p>
              {/* The SDK returns a data: URI. CSP already allows img-src data:
                  for the stamped photo preview, so this needs no new rule. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={setup.qr}
                alt="QR code for your authenticator app"
                className="border-border h-44 w-44 rounded border bg-white p-2"
              />
              <p className="text-muted-foreground text-xs">
                Cannot scan? Enter this key by hand:{" "}
                <code className="break-all">{setup.secret}</code>
              </p>

              <form action={confirmAction} className="space-y-2">
                <input type="hidden" name="factor_id" value={setup.factorId} />
                <Label htmlFor="enrol-code">6-digit code</Label>
                <Input
                  id="enrol-code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  required
                  className="h-11"
                  placeholder="000000"
                />
                {confirmState.error && (
                  <p className="text-danger text-xs">{confirmState.error}</p>
                )}
                <p className="text-muted-foreground text-xs">
                  From the next sign-in onwards you will be asked for a code.
                </p>
                <Button type="submit" className="h-11" disabled={confirming}>
                  {confirming ? "Checking…" : "Turn it on"}
                </Button>
              </form>
            </div>
          )}

          {(enrolled || done) && (
            <Button
              type="button"
              variant="ghost"
              className="h-9"
              disabled={removing}
              onClick={() =>
                removeTransition(async () => {
                  await removeOwnFactor();
                  setSetup(null);
                })
              }
            >
              {removing ? "Turning off…" : "Turn off"}
            </Button>
          )}
        </div>

        {/* ---------------- Recovery ---------------- */}
        <div className="border-border space-y-3 border-t pt-4">
          <p className="text-sm font-medium">If an admin loses their phone</p>
          <p className="text-muted-foreground text-xs">
            Reset their code here. They then sign in with their password alone
            and can set up a new authenticator. There are no backup codes to
            keep, by design.
          </p>

          <ul className="space-y-2">
            {admins.map((admin) => (
              <li
                key={admin.id}
                className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {admin.name}
                  {admin.id === viewerId && (
                    <span className="text-muted-foreground"> (you)</span>
                  )}
                </span>
                <Badge variant={admin.enrolled ? "success" : "neutral"}>
                  {admin.enrolled ? "Code on" : "Password only"}
                </Badge>
                {admin.enrolled && admin.id !== viewerId && (
                  <form action={resetAction}>
                    <input type="hidden" name="member_id" value={admin.id} />
                    <Button
                      type="submit"
                      variant="outline"
                      className="h-9"
                      disabled={resetting}
                    >
                      {resetting ? "Resetting…" : "Reset their code"}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>

          {resetState.error && (
            <p className="text-danger text-xs">{resetState.error}</p>
          )}
          {resetState.ok && (
            <p className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-xs">
              Done. They can sign in with their password now, and should set up
              a new authenticator straight away.
            </p>
          )}

          {/*
            BREAK-GLASS, written on the screen rather than only in a document.
            If every admin loses their device at once, nobody here can help —
            the way back is the Supabase project itself, which is a separate
            credential from this app. That separation is what makes a total
            lockout impossible, so the note belongs where somebody looking for
            a way in will actually find it.
          */}
          <p className="text-muted-foreground text-xs">
            If every admin is locked out at once, the codes can be cleared from
            the Supabase project under Authentication, then Users. See
            docs/BACKUP-RESTORE.md.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
