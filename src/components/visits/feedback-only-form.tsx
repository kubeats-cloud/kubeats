"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  EMPTY_FEEDBACK,
  FeedbackFields,
  type FeedbackState,
} from "@/components/visits/feedback-fields";
import { submitFeedback } from "@/lib/feedback-actions";
import { EMPTY_STATE } from "@/lib/visit-form-state";
import { fieldLabel } from "@/lib/validation/visit";
import type { OpenLoop } from "@/lib/visits";

/**
 * The feedback form on its own — the recovery path, not a normal step.
 *
 * A rep reaches this only when their visit was logged but its report was not:
 * the two are one submit and two RPCs, and the second can fail on its own.
 * Rather than let them log the same arrival twice, `/log` finds the unreported
 * visit and shows this.
 *
 * It submits to the same `close_visit()` the normal path uses, so the report,
 * the close of any earlier "Set" and the check-out all still happen together in
 * one transaction. The status is read from the visit that was already saved,
 * because that is what decides which extra questions are asked and it is not
 * the rep's to change now.
 */
export function FeedbackOnlyForm({
  visitId,
  planId,
  status,
  openLoops,
}: {
  visitId: string;
  planId: string;
  /** The status recorded when the visit was logged. */
  status: string | null;
  openLoops: OpenLoop[];
}) {
  const [state, formAction, isPending] = useActionState(submitFeedback, EMPTY_STATE);
  const [feedback, setFeedback] = useState<FeedbackState>(EMPTY_FEEDBACK);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="visit_id" value={visitId} />
      <input type="hidden" name="daily_plan_id" value={planId} />

      <p className="bg-warning-subtle text-warning-subtle-foreground rounded-md px-3 py-2 text-sm">
        Your visit was saved but the report did not go through. Finish it here
        and you will be checked out.
      </p>

      <FeedbackFields
        status={status}
        value={feedback}
        onChange={setFeedback}
        fieldErrors={state.fieldErrors}
        openLoops={openLoops}
      />

      {state.error && (
        <div
          role="alert"
          className="bg-danger-subtle text-danger-subtle-foreground space-y-1 rounded-md px-3 py-2 text-sm"
        >
          <p>{state.error}</p>
          {Object.keys(state.fieldErrors).length > 0 && (
            <ul className="list-inside list-disc">
              {Object.entries(state.fieldErrors).map(([field, message]) => (
                <li key={field}>
                  <span className="font-medium">{fieldLabel(field)}</span>: {message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button type="submit" className="h-11 w-full" disabled={isPending}>
        {isPending ? "Saving…" : "Save and check out"}
      </Button>
    </form>
  );
}
