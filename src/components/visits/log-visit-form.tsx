"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/form-section";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CaptureFields } from "@/components/visits/capture-fields";
import {
  EMPTY_FEEDBACK,
  FeedbackFields,
  type FeedbackState,
} from "@/components/visits/feedback-fields";
import { logAndFileVisit } from "@/lib/feedback-actions";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import type { OpenLoop, PlanEntry } from "@/lib/visits";
import {
  CATEGORY_LABELS,
  STATUS_CATEGORIES,
  statusesInCategory,
} from "@/lib/validation/institute";
import {
  ACTIVITIES,
  activityForPurpose,
  expectedDateRequired,
  fieldLabel,
  followUpRequired,
  hasLifecycle,
} from "@/lib/validation/visit";

const NO_CHANGE = "__no_change__";

/**
 * Log a visit — now the second step of a forced chain, not a screen a rep
 * chooses.
 *
 * They arrive here from a check-in, which is why the institute and the purpose
 * are shown rather than asked: both were decided when the visit was planned,
 * and asking again would invite a second, disagreeing answer. The activity and
 * its Set/Done state are pre-filled from the purpose through
 * `activityForPurpose()`, and stay editable — the map covers four of the five
 * purposes and "Other" was always going to need a choice.
 *
 * The feedback form is at the foot of this same screen rather than a step
 * later. One submit logs the visit, files the report, closes any earlier "Set"
 * it completed, and checks the rep out. There is no check-out button anywhere
 * any more.
 */
export function LogVisitForm({
  userId,
  plan,
  openLoops,
}: {
  userId: string;
  /** The checked-in plan entry this visit belongs to. */
  plan: PlanEntry;
  openLoops: OpenLoop[];
}) {
  const [serverState, formAction, isPending] = useActionState(
    logAndFileVisit,
    EMPTY_STATE,
  );
  const [clientState] = useState<FormState>(EMPTY_STATE);

  const prefill = activityForPurpose(plan.purpose);
  const [activity, setActivity] = useState<string>(prefill?.activity ?? "meeting");
  const [lifecycleStatus, setLifecycleStatus] = useState<string>(
    prefill?.lifecycle ?? "Done",
  );
  const [expectedDate, setExpectedDate] = useState("");
  const [statusSetTo, setStatusSetTo] = useState(NO_CHANGE);
  const [feedback, setFeedback] = useState<FeedbackState>(EMPTY_FEEDBACK);

  const lifecycle = hasLifecycle(activity);
  const status = statusSetTo === NO_CHANGE ? null : statusSetTo;
  const needsDate = expectedDateRequired(activity, lifecycle ? lifecycleStatus : null);

  const error = serverState.error ?? clientState.error;
  const fieldErrors = serverState.error
    ? serverState.fieldErrors
    : clientState.fieldErrors;

  const fieldError = (key: string) =>
    fieldErrors[key] ? <p className="text-danger text-xs">{fieldErrors[key]}</p> : null;

  return (
    <form action={formAction} className="space-y-4">
      {/* Everything the plan already decided, carried rather than re-asked. */}
      <input type="hidden" name="institute_id" value={plan.institute_id} />
      <input type="hidden" name="daily_plan_id" value={plan.id} />
      <input type="hidden" name="activity" value={activity} />
      <input
        type="hidden"
        name="lifecycle_status"
        value={lifecycle ? lifecycleStatus : ""}
      />
      <input
        type="hidden"
        name="expected_date"
        value={lifecycle && lifecycleStatus === "Set" ? expectedDate : ""}
      />
      <input
        type="hidden"
        name="status_set_to"
        value={statusSetTo === NO_CHANGE ? "" : statusSetTo}
      />

      <FormSection
        title="What happened?"
        description="Pre-filled from what you planned. Change it if the visit turned out differently."
      >
        <div className="border-border bg-muted/40 rounded-md border px-3 py-2">
          <p className="text-sm font-medium">{plan.instituteName}</p>
          <p className="text-muted-foreground text-xs">{plan.purpose}</p>
        </div>

        <div className="space-y-2">
          <Label>Activity</Label>
          <Select value={activity} onValueChange={setActivity}>
            <SelectTrigger className="h-11 w-full" aria-label="Activity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIVITIES.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldError("activity")}
          {fieldError("daily_plan_id")}
        </div>

        {lifecycle && (
          <div className="space-y-2">
            <Label>Is it set for later, or done?</Label>
            <Select value={lifecycleStatus} onValueChange={setLifecycleStatus}>
              <SelectTrigger className="h-11 w-full" aria-label="Set or Done">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Set">Set for a later date</SelectItem>
                <SelectItem value="Done">Done today</SelectItem>
              </SelectContent>
            </Select>
            {fieldError("lifecycle_status")}
          </div>
        )}

        {needsDate && (
          <div className="space-y-2">
            <Label htmlFor="expected-date">When is it expected?</Label>
            <Input
              id="expected-date"
              type="date"
              className="h-11"
              value={expectedDate}
              onChange={(event) => setExpectedDate(event.target.value)}
              aria-required
            />
            {fieldError("expected_date")}
          </div>
        )}
      </FormSection>

      <FormSection
        title="Photo"
        description="A photograph, taken now rather than remembered later."
      >
        <CaptureFields userId={userId} />
      </FormSection>

      <FormSection
        title="Where does this leave the institute?"
        description="Rule 4 — chosen by hand, never guessed from the activity."
      >
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={statusSetTo} onValueChange={setStatusSetTo}>
            <SelectTrigger className="h-11 w-full" aria-label="Institute status">
              <SelectValue />
            </SelectTrigger>
            {/* Grouped so it is obvious which choices leave the institute in
                play — and an open one is what makes the follow-up mandatory
                below. */}
            <SelectContent>
              <SelectItem value={NO_CHANGE}>No change</SelectItem>
              {STATUS_CATEGORIES.map((category) => (
                <SelectGroup key={category}>
                  <SelectLabel>{CATEGORY_LABELS[category]}</SelectLabel>
                  {statusesInCategory(category).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {fieldError("status_set_to")}
          {followUpRequired(status) && (
            <p className="text-muted-foreground text-xs">
              That leaves the institute open, so the next date and time are
              needed below.
            </p>
          )}
        </div>
      </FormSection>

      <FeedbackFields
        status={status}
        value={feedback}
        onChange={setFeedback}
        fieldErrors={fieldErrors}
        openLoops={openLoops}
      />

      {error && (
        <div
          role="alert"
          className="bg-danger-subtle text-danger-subtle-foreground space-y-1 rounded-md px-3 py-2 text-sm"
        >
          <p>{error}</p>
          {Object.keys(fieldErrors).length > 0 && (
            <ul className="list-inside list-disc">
              {Object.entries(fieldErrors).map(([field, message]) => (
                <li key={field}>
                  <span className="font-medium">{fieldLabel(field)}</span>: {message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* One tap ends the visit: the report is filed and the check-out is
          stamped in the same transaction. Said on the button, because a rep
          who does not know that will go looking for a check-out afterwards. */}
      <Button type="submit" className="h-11 w-full" disabled={isPending}>
        {isPending ? "Saving…" : "Save and check out"}
      </Button>
    </form>
  );
}
