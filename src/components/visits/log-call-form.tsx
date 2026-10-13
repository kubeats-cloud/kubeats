"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/form-section";
import { FormNotice } from "@/components/form-notice";
import {
  StatusOutcomeFields,
  type StatusOutcomeValue,
} from "@/components/visits/status-outcome-fields";
import { EMPTY_FEEDBACK } from "@/lib/validation/feedback";
import { logFollowUpCallOutcome } from "@/lib/visit-actions";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import { clearDraft, logCallDraftKey } from "@/lib/drafts";
import { useDraft } from "@/lib/use-draft";
import {
  eventDateLabel,
  eventDateRequired,
  fieldLabel,
  followUpRequired,
} from "@/lib/validation/visit";
import type { StatusCatalogue } from "@/lib/validation/institute";

/**
 * Log a follow-up call like a visit: the same status-driven fields, no photo,
 * no check-in, no GPS, no "This completes an earlier plan".
 *
 * SUBMITTED BY HAND for the same Radix-Select reason Log Visit is — see the
 * long note on that form. The status picker here is the same Select, and a
 * revert after a refused submit would file a call that moved no status.
 */

type LogCallDraft = StatusOutcomeValue;

const EMPTY_DRAFT: LogCallDraft = {
  statusSetTo: "",
  expectedDate: "",
  followUpDate: "",
  nextAction: { kind: "", due: "", note: "" },
  feedback: EMPTY_FEEDBACK,
};

export function LogCallForm({
  taskId,
  note,
  catalogue,
}: {
  taskId: string;
  note: string | null;
  catalogue: StatusCatalogue;
}) {
  const [serverState, formAction, isPending] = useActionState(
    logFollowUpCallOutcome,
    EMPTY_STATE,
  );
  const [clientState] = useState<FormState>(EMPTY_STATE);

  const draftKey = logCallDraftKey(taskId);
  const [draft, patchDraft] = useDraft(draftKey, EMPTY_DRAFT, {
    resaveOn: serverState,
  });
  const { statusSetTo, expectedDate, followUpDate, feedback } = draft;
  const nextAction = draft.nextAction ?? EMPTY_DRAFT.nextAction;

  const status = statusSetTo === "" ? null : statusSetTo;
  const needsDate = eventDateRequired(catalogue, status);
  const needsFollowUp =
    followUpRequired(catalogue, status) || nextAction.kind !== "";

  const error = serverState.error ?? clientState.error;
  const rawFieldErrors = serverState.error
    ? serverState.fieldErrors
    : clientState.fieldErrors;
  const fieldErrors = Object.fromEntries(
    Object.entries(rawFieldErrors).filter(([key]) => {
      if (key === "expected_date") return needsDate;
      if (key === "follow_up_date") return needsFollowUp;
      return true;
    }),
  );

  const labelForField = (key: string) =>
    key === "expected_date" ? eventDateLabel(catalogue, status) : fieldLabel(key);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        clearDraft(draftKey);
        formAction(formData);
      }}
      className="space-y-4"
    >
      <input type="hidden" name="task_id" value={taskId} />

      {note && (
        <FormSection>
          <p className="text-muted-foreground text-sm">{note}</p>
        </FormSection>
      )}

      <StatusOutcomeFields
        catalogue={catalogue}
        value={{ statusSetTo, expectedDate, followUpDate, nextAction, feedback }}
        onChange={patchDraft}
        fieldErrors={fieldErrors}
        openLoops={[]}
        showNextAction
      />

      {error && (
        <FormNotice
          message={error}
          fieldErrors={fieldErrors}
          labelFor={labelForField}
        />
      )}

      <Button type="submit" className="h-11 w-full" disabled={isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
