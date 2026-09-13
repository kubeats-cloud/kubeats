"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FeedbackFields } from "@/components/visits/feedback-fields";
import {
  EMPTY_FEEDBACK,
  applyFeedbackPatch,
  type FeedbackState,
} from "@/lib/validation/feedback";
import { submitFeedback } from "@/lib/feedback-actions";
import { EMPTY_STATE } from "@/lib/visit-form-state";
import { fieldLabel } from "@/lib/validation/visit";
import type { OpenLoop } from "@/lib/visits";
import { FormNotice } from "@/components/form-notice";

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
  alreadyClosed = false,
}: {
  visitId: string;
  /** Null when the check-in is already closed and there is no check-out left. */
  planId: string | null;
  /** The status recorded when the visit was logged. */
  status: string | null;
  openLoops: OpenLoop[];
  /** Swept overnight, or cleared by an admin, before the report was filed. */
  alreadyClosed?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(submitFeedback, EMPTY_STATE);
  const [feedback, setFeedback] = useState<FeedbackState>(EMPTY_FEEDBACK);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="visit_id" value={visitId} />
      <input type="hidden" name="daily_plan_id" value={planId ?? ""} />

      <p className="bg-warning-subtle text-warning-subtle-foreground rounded-md px-3 py-2 text-sm">
        {alreadyClosed
          ? "This visit was saved but never reported, and the check-in has since been closed. Finish the report here. The time on site stays “not recorded”, which is the honest answer."
          : "Your visit was saved but the report did not go through. Finish it here and you will be checked out."}
      </p>

      <FeedbackFields
        status={status}
        value={feedback}
        // Functional, so two changes in one tick both survive: the second
        // merges against the first's result rather than against the render it
        // started from. See applyFeedbackPatch.
        onChange={(patch) => setFeedback((prev) => applyFeedbackPatch(prev, patch))}
        fieldErrors={state.fieldErrors}
        openLoops={openLoops}
      />

      {state.error && (
        <FormNotice
          message={state.error}
          fieldErrors={state.fieldErrors}
          labelFor={fieldLabel}
        />
      )}

      <Button type="submit" className="h-11 w-full" disabled={isPending}>
        {isPending
          ? "Saving…"
          : alreadyClosed
            ? "Save the report"
            : "Save and check out"}
      </Button>
    </form>
  );
}
