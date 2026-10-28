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
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/form-section";
import { FormNotice } from "@/components/form-notice";
import { adminUpdateCallReport } from "@/lib/call-report-actions";
import { EMPTY_ADMIN_STATE } from "@/lib/admin-form-state";

/** done / no_answer / rescheduled / cancelled — follow_up_tasks_outcome_valid. */
const OUTCOMES = [
  { value: "done", label: "Done" },
  { value: "no_answer", label: "No answer" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "cancelled", label: "Cancelled" },
] as const;

interface StatusOption {
  status: string;
  /** False once an admin has retired it. Still offered — an older report may
   * already carry one, and this picker has to be able to leave it alone. */
  isActive: boolean;
}

/**
 * Admin-only correction to an already-filed Call Report (0063).
 *
 * NOT rendered for a rep or a team lead — `requireStaff()`'s `isAdmin` flag
 * decides that on the page, same as `ReassignOwner` on an institute's page.
 * Editable fields only: status, follow-up date, expected date, outcome,
 * notes. Everything else the detail view above this card shows (session
 * topic, head count, who took it, custom fields) is read-only — see
 * `admin_update_call_report()`'s header for why.
 */
export function CallReportEdit({
  taskId,
  statuses,
  initial,
}: {
  taskId: string;
  /** The whole vocabulary, in display order, retired statuses included. */
  statuses: StatusOption[];
  initial: {
    status: string | null;
    followUpDate: string | null;
    expectedDate: string | null;
    outcome: string | null;
    notes: string | null;
  };
}) {
  const [state, formAction, isPending] = useActionState(
    adminUpdateCallReport,
    EMPTY_ADMIN_STATE,
  );
  const [status, setStatus] = useState(initial.status ?? "");
  const [followUpDate, setFollowUpDate] = useState(initial.followUpDate ?? "");
  const [expectedDate, setExpectedDate] = useState(initial.expectedDate ?? "");
  const [outcome, setOutcome] = useState(initial.outcome ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");

  return (
    <FormSection
      title="Edit this Call Report"
      description="Admin only. If this call is the institute's most recent status change, the institute's status moves with it — same as logging a new call."
    >
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="task_id" value={taskId} />
        <input type="hidden" name="status_set_to" value={status} />
        <input type="hidden" name="outcome" value={outcome} />

        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-11 w-full" aria-label="Status">
              <SelectValue placeholder="Choose a status" />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((entry) => (
                <SelectItem key={entry.status} value={entry.status}>
                  {entry.isActive ? entry.status : `${entry.status} (retired)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Stacked at every width, including 400px — a two-column grid here
            would squeeze two date inputs into less than half that. */}
        <div className="space-y-2">
          <Label htmlFor="call-edit-expected">Expected Date</Label>
          <Input
            id="call-edit-expected"
            type="date"
            name="expected_date"
            className="h-11"
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="call-edit-followup">Follow-up Date</Label>
          <Input
            id="call-edit-followup"
            type="date"
            name="follow_up_date"
            className="h-11"
            value={followUpDate}
            onChange={(e) => setFollowUpDate(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Outcome</Label>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger className="h-11 w-full" aria-label="Outcome">
              <SelectValue placeholder="Choose an outcome" />
            </SelectTrigger>
            <SelectContent>
              {OUTCOMES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="call-edit-notes">Notes</Label>
          <Textarea
            id="call-edit-notes"
            name="notes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <Button type="submit" className="h-11 w-full" disabled={isPending}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>

        {state.error && <FormNotice message={state.error} />}
        {state.ok && (
          <p
            role="status"
            className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
          >
            {state.message ?? "Saved."}
          </p>
        )}
      </form>
    </FormSection>
  );
}
