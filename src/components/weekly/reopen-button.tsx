"use client";

import { useActionState, useState } from "react";
import { UnlockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reopenPeriod } from "@/lib/target-actions";
import { PERIOD_NOUN, type Period } from "@/lib/periods";
import { EMPTY_STATE } from "@/lib/visit-form-state";

/**
 * Rule 6 — an admin reopening a locked target period.
 *
 * Asks first: reopening is not destructive, but it un-finalises something the
 * rep was told was final, so it should not happen on a stray tap. The trigger
 * records who did it and when, from the session rather than from this form.
 */
export function ReopenButton({
  member,
  period,
  periodStart,
  memberName,
}: {
  member: string;
  period: Period;
  periodStart: string;
  memberName: string;
}) {
  const [state, formAction, isPending] = useActionState(reopenPeriod, EMPTY_STATE);
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="member" value={member} />
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="period_start" value={periodStart} />

      {confirming ? (
        <div className="bg-warning-subtle text-warning-subtle-foreground space-y-3 rounded-md px-3 py-3 text-sm">
          <p>
            Reopen this {PERIOD_NOUN[period]} so {memberName} can revise and resubmit it? Your
            name and the time are recorded against it.
          </p>
          <div className="flex gap-2">
            <Button type="submit" className="h-11 flex-1" disabled={isPending}>
              {isPending ? "Reopening…" : "Yes, reopen"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setConfirming(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          onClick={() => setConfirming(true)}
        >
          <UnlockIcon className="size-4" aria-hidden />
          Reopen this {PERIOD_NOUN[period]}
        </Button>
      )}

      {state.error && (
        <p
          role="alert"
          className="bg-danger-subtle text-danger-subtle-foreground rounded-md px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}
