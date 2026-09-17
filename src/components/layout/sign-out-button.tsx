"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { LogOutIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { signOutIfFinished } from "@/lib/auth-actions";
import { SIGN_OUT_READY } from "@/lib/sign-out-state";

/**
 * Sign out, and what happens when a visit is still open.
 *
 * THE REFUSAL IS THE SERVER'S, NOT THIS COMPONENT'S. Nothing here knows whether
 * the rep is mid-visit — it submits, and `signOutIfFinished` either redirects to
 * /login or comes back with the institute holding them. That ordering is
 * deliberate: a check made here could be skipped by posting the form, and this
 * button is also the one place a rep might reasonably want to get past. The
 * action is the boundary; this is the sentence.
 *
 * WHY A DIALOG RATHER THAN A LINE OF TEXT. The top bar has no room for a
 * sentence, and a refusal that appears somewhere a rep is not looking is a
 * button that silently does nothing — the failure the Settings panels were just
 * fixed for. A dialog also gives the two things the refusal has to carry: the
 * way back to the visit, and a way to change their mind.
 *
 * IT OPENS FROM THE SERVER'S ANSWER. The dialog is shown exactly while the last
 * submission came back blocked, so it cannot appear before the server has
 * spoken and cannot survive a successful sign-out — that redirects, which
 * unmounts all of this. `dismissed` is the second half of the condition and
 * exists only because `useActionState` has no reset; see below.
 */
export function SignOutButton() {
  const [state, formAction, isPending] = useActionState(
    signOutIfFinished,
    SIGN_OUT_READY,
  );
  /*
   * `useActionState` has no reset, so Cancel cannot clear `state.blockedBy` —
   * without this the dialog would reopen the instant it closed. Cleared again
   * on the next tap, so a rep who cancels, finishes the visit and comes back
   * gets a fresh answer from the server rather than the remembered refusal.
   */
  const [dismissed, setDismissed] = useState(false);

  const blocked = state.blockedBy;
  const showBlock = blocked !== null && !dismissed;

  return (
    <>
      <form action={formAction}>
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-9"
          aria-label="Sign out"
          title="Sign out"
          disabled={isPending}
          onClick={() => setDismissed(false)}
        >
          <LogOutIcon className="size-[18px]" aria-hidden />
        </Button>
      </form>

      <Dialog open={showBlock} onOpenChange={(next) => setDismissed(!next)}>
        {/*
          Escape and the overlay close it, like Cancel: this is a refusal, not a
          trap. The rep is meant to be able to get back to what they were doing
          and finish the visit — which is the whole outcome being asked for.
          Only the little × is dropped, because Cancel says the same thing in a
          word and two dismissals in one corner is clutter.
        */}
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <TriangleAlertIcon className="text-warning size-5 shrink-0" aria-hidden />
              Finish your visit first
            </DialogTitle>
            <DialogDescription className="text-left">
              {/*
                THE INSTITUTE IS NAMED. "You have an open visit" is not
                actionable when a rep has six schools on today's plan; the name
                is what turns the refusal into an instruction.
              */}
              You are still checked in at{" "}
              <span className="text-foreground font-medium">
                {blocked?.instituteName}
              </span>
              . Fill in the report and press{" "}
              <span className="text-foreground font-medium">
                Save and check out
              </span>{" "}
              to finish, then sign out.
            </DialogDescription>
          </DialogHeader>

          <p className="text-muted-foreground text-xs">
            Signing out will not close the visit — it would leave it with no
            recorded finishing time. If you genuinely cannot finish it, ask an
            admin to clear it for you.
          </p>

          <DialogFooter className="gap-2 sm:gap-2">
            {blocked && (
              <Button asChild className="h-11 w-full sm:w-auto">
                <Link href={`/log?plan=${blocked.planId}`}>Go to visit</Link>
              </Button>
            )}
            {/*
              Dismisses the refusal without asking the server again. Submitting
              the form a second time would simply be refused a second time, so
              this is a local "I have read it", cleared the moment the rep taps
              sign-out again.
            */}
            <Button
              variant="outline"
              className="h-11 w-full sm:w-auto"
              onClick={() => setDismissed(true)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
