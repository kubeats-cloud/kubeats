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
import { FeedbackFields } from "@/components/visits/feedback-fields";
import {
  EMPTY_FEEDBACK,
  applyFeedbackPatch,
  type FeedbackState,
} from "@/lib/validation/feedback";
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
  expectedDateLabel,
  expectedDateRequired,
  fieldLabel,
  followUpRequired,
  hasLifecycle,
} from "@/lib/validation/visit";
import { FormNotice } from "@/components/form-notice";

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
  const [followUpDate, setFollowUpDate] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(EMPTY_FEEDBACK);

  const lifecycle = hasLifecycle(activity);
  const status = statusSetTo === NO_CHANGE ? null : statusSetTo;
  const needsDate = expectedDateRequired(activity, lifecycle ? lifecycleStatus : null);
  const needsFollowUp = followUpRequired(status);

  /*
   * handleFollowUpDate() stood here — it pre-filled the time to 11:00 the
   * moment a date was chosen. Both it and the Time field are gone: 0023 drops
   * the time from Rule 5, so there is no second half left to answer for the
   * rep. setFollowUpDate is wired straight to the one remaining input.
   */

  const error = serverState.error ?? clientState.error;
  const fieldErrors = serverState.error
    ? serverState.fieldErrors
    : clientState.fieldErrors;

  const fieldError = (key: string) =>
    fieldErrors[key] ? <p className="text-danger text-xs">{fieldErrors[key]}</p> : null;

  return (
    /*
     * SUBMITTED BY HAND, AND THAT IS THE BUG FIX. It used to be
     * `action={formAction}`, which is the idiomatic React 19 form and is what
     * made the rep's Activity silently revert on a failed submit.
     *
     * THE CHAIN. React resets a form once its `action` has run - that is the
     * documented behaviour, and the reason `requestFormReset` exists for the
     * manual case. Resetting dispatches a `reset` EVENT. And every Radix
     * Select registers one of these on its enclosing form
     * (@radix-ui/react-select, which `radix-ui` re-exports):
     *
     *     const initialValueRef = React.useRef(value);   // captured at MOUNT
     *     const reset = () => setValue(initialValueRef.current);
     *     associatedForm.addEventListener("reset", reset);
     *
     * Because our Selects are CONTROLLED, `setValue` calls `onValueChange` -
     * so `setActivity` is genuinely invoked with the value the Select had when
     * it mounted. The rep's choice is not merely hidden; the state is
     * overwritten. Then the form re-renders from the failed action showing the
     * plan's prefill, and a rep who corrects "Session" to "Campus Visit",
     * submits, fixes the flagged photo and submits again files the WRONG
     * ACTIVITY without ever seeing it change back.
     *
     * WHY IT LOOKED SELECTIVE, which is what made it worth chasing. Only the
     * Radix-backed controls reverted - Activity, Set/Done, Institute status and
     * the three feedback Pickers. `interested`, `next_meeting_set` and the
     * name/mobile boxes all survived, because those are plain buttons and
     * plain inputs with no reset listener. Two useState values in the SAME
     * component behaving differently is what ruled out a remount and pointed at
     * the form-reset event.
     *
     * THE FIX REMOVES THE TRIGGER RATHER THAN RACING IT. Dispatching the action
     * ourselves means React is not driving the submission, so it never resets
     * the form, so no `reset` event fires and Radix never clobbers anything.
     * The alternatives were worse: cancelling the event cannot work
     * (preventDefault stops the browser's field reset, not Radix's listener,
     * which has already run), out-listening it depends on React's delegated
     * handler firing after Radix's element-level one, and re-`key`ing every
     * Select to refresh its `initialValueRef` costs a remount and the trigger's
     * focus on every change.
     *
     * WHAT THIS GIVES UP, AND WHY IT COSTS NOTHING HERE. A form without an
     * `action` cannot be submitted before JavaScript arrives. This one never
     * could: Rule 12 makes the photograph mandatory, and the photograph is
     * produced client-side - stamped onto a canvas and uploaded by
     * CaptureFields, which is what fills in `photo_path`. A no-JS submit had
     * always failed on `photo_path` before it reached the database. So there
     * was no progressive enhancement to lose.
     *
     * SEVEN OTHER FORMS PAIR `action={formAction}` WITH A RADIX SELECT and have
     * the same latent bug - assign-visit, daily-plan, institute-form,
     * material-upload-form, locations-panel, photo-flush-panel and team-panel.
     * They are deliberately NOT changed here: for some of them (the daily-plan
     * add row) clearing after a successful submit is the wanted behaviour, and
     * each needs its own look. This one was fixed first because it is the one
     * that writes the visit record.
     */
    <form
      onSubmit={(event) => {
        event.preventDefault();
        formAction(new FormData(event.currentTarget));
      }}
      className="space-y-4"
    >
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
            <Label htmlFor="expected-date">{expectedDateLabel(activity)}</Label>
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
        description="One photo from the visit itself."
      >
        <CaptureFields userId={userId} />
      </FormSection>

      <FormSection
        title="Where does this leave the institute?"
        description="Your call, not ours. Nothing here is guessed from the activity."
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
        </div>
      </FormSection>

      {/*
        THE FOLLOW-UP LIVES HERE NOW, not in the feedback form, and it is driven
        by the status rather than by a yes/no.

        It used to sit at the foot of FeedbackFields behind "Is a next session
        or meeting set?". Two things were wrong with that. The yes/no was a
        second answer to a question the status had already answered, and the two
        could disagree: an OPEN status with "No" hid these fields while
        visitSchema still required them, so the error summary named a box that
        was not on the screen and there was no way forward but guessing. And on
        the recovery path the feedback form posts to close_visit(), which does
        not write follow_up_date or follow_up_time at all — so what the rep
        typed there was discarded in silence.

        Both are fixed by putting it where the rule already was. visitSchema
        requires a DATE when followUpRequired(status), mirroring
        enforce_follow_up_when_open() (FO016); log_visit() is what stores it.

        A DATE AND NOTHING ELSE. From 0018 to 0023 this asked for a time too,
        pre-filled to 11:00 so the rep only really answered once. The client's
        spec settled on the date alone, so migration 0023 drops the time from
        the trigger and the control goes with it. visits.follow_up_time keeps
        every value it recorded in between and is collected by nothing.

        Shown for every status, not only the open ones: a CLOSED status may
        still carry a follow-up — "they said no, ask again next intake" is a
        real note, and 0010 kept it permitted on purpose. Only the requirement
        changes.
      */}
      <FormSection
        title="What happens next?"
        description={
          needsFollowUp
            ? "That status leaves the institute open, so put the next visit in the diary now."
            : "Optional — only if you already know when you are going back."
        }
      >
        <div className="space-y-2 sm:max-w-xs">
          <Label htmlFor="follow-up-date">Follow-up date</Label>
          <Input
            id="follow-up-date"
            name="follow_up_date"
            type="date"
            className="h-11"
            value={followUpDate}
            onChange={(event) => setFollowUpDate(event.target.value)}
            aria-required={needsFollowUp || undefined}
          />
          {fieldError("follow_up_date")}
        </div>
      </FormSection>

      <FeedbackFields
        status={status}
        value={feedback}
        // Functional, so two changes in one tick both survive: the second
        // merges against the first's result rather than against the render it
        // started from. See applyFeedbackPatch.
        onChange={(patch) => setFeedback((prev) => applyFeedbackPatch(prev, patch))}
        fieldErrors={fieldErrors}
        openLoops={openLoops}
      />

      {error && (
        <FormNotice message={error} fieldErrors={fieldErrors} labelFor={fieldLabel} />
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
