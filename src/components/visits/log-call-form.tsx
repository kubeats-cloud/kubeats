"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormNotice } from "@/components/form-notice";
import { logFollowUpCallOutcome } from "@/lib/visit-actions";
import { EMPTY_STATE } from "@/lib/visit-form-state";

/**
 * The log-call page's form. No photo, no check-in, no institute picker — the
 * institute is already decided by the task the rep tapped "Log call" on.
 *
 * REPLACES THE OLD DONE / NO-ANSWER BUTTONS. `outcome` is exactly their two
 * values; there is no third option on screen because nothing before this
 * page ever offered one.
 */
export function LogCallForm({
  taskId,
  note,
}: {
  taskId: string;
  note: string | null;
}) {
  const [state, formAction, isPending] = useActionState(
    logFollowUpCallOutcome,
    EMPTY_STATE,
  );
  const [outcome, setOutcome] = useState("");
  const [noteText, setNoteText] = useState(note ?? "");

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="task_id" value={taskId} />
      {/* Posted as a hidden input rather than as the Select itself: a Radix
          Select carries no value into FormData on its own. */}
      <input type="hidden" name="outcome" value={outcome} />

      <div className="space-y-1.5">
        <Label>How did it go?</Label>
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="h-11 w-full" aria-label="Outcome">
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="no_answer">No answer</SelectItem>
          </SelectContent>
        </Select>
        {state.fieldErrors.outcome && (
          <p className="text-danger text-xs">{state.fieldErrors.outcome}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="log-call-note">Notes (optional)</Label>
        <Input
          id="log-call-note"
          name="note"
          className="h-11"
          maxLength={300}
          placeholder="What was discussed…"
          value={noteText}
          onChange={(event) => setNoteText(event.target.value)}
        />
      </div>

      <Button type="submit" className="h-11 w-full" disabled={isPending || !outcome}>
        {isPending ? "Saving…" : "Save"}
      </Button>

      {state.error && <FormNotice message={state.error} />}
    </form>
  );
}
