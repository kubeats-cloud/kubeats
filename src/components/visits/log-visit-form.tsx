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
import { checkoutFix } from "@/lib/geolocate";
import { appendCheckoutFix } from "@/lib/validation/checkin";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import type { OpenLoop, PlanEntry } from "@/lib/visits";
import {
  CATEGORY_LABELS,
  STATUS_CATEGORIES,
  statusRow,
  statusesInCategory,
  type StatusCatalogue,
} from "@/lib/validation/institute";
import {
  type ActivityKey,
  expectedDateLabel,
  expectedDateRequired,
  fieldLabel,
  followUpRequired,
  plannedActivityIsValid,
  plannedActivityLabel,
} from "@/lib/validation/visit";
import { FormNotice } from "@/components/form-notice";

/*
 * NO_CHANGE stood here — the sentinel behind a "No change" option at the top of
 * the status picker, and the reason status_set_to was nullable all the way
 * through the form.
 *
 * Stage 4b removes it. A rep must say where the visit leaves the institute,
 * because stage 5 rebuilds Pending around institutes whose CURRENT status is
 * open and a visit that set none contributes nothing to that — not a follow-up
 * owed, not a closed loop, just absent for ever with nothing to say it went
 * missing. enforce_status_required() (FO024, migration 0027) is the backstop;
 * this is what stops a rep reaching it.
 *
 * The empty string is the unselected state now, which is also what makes the
 * Radix reset harmless here: a revert lands on nothing and the schema refuses
 * it with a sentence rather than filing a visit that changed no status.
 */

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
  catalogue,
}: {
  userId: string;
  /** The checked-in plan entry this visit belongs to. */
  plan: PlanEntry;
  openLoops: OpenLoop[];
  /**
   * The status vocabulary, read from the database by the page.
   *
   * Handed down rather than imported so the browser judges a submission by the
   * same list the server will — including a status an admin added this morning,
   * which a constant in the bundle could not know about.
   */
  catalogue: StatusCatalogue;
}) {
  const [serverState, formAction, isPending] = useActionState(
    logAndFileVisit,
    EMPTY_STATE,
  );
  const [clientState] = useState<FormState>(EMPTY_STATE);

  /*
   * THE ACTIVITY IS NOT STATE ANY MORE. It used to be two `useState`s behind
   * two Selects — the rep picked the activity and its Set/Done — pre-filled
   * from a hard-coded map of four purpose labels.
   *
   * Stage 3 derives both from the plan's purpose instead, through
   * `purposes.activity` (0024) and `purposes.lifecycle` (0025). There is
   * nothing to choose, so there is nothing to hold: `plan.activity` and
   * `plan.lifecycle` came off the joined row and simply travel to the hidden
   * fields below.
   *
   * `/log` refuses to render this form at all when the pair is unusable, so by
   * the time we are here `planned` is valid. The fallback exists because a
   * component should not depend on a caller's check for its own correctness.
   */
  const planned = plannedActivityIsValid(plan)
    ? { activity: plan.activity as ActivityKey, lifecycle: plan.lifecycle }
    : null;
  const activity = planned?.activity ?? "";
  const lifecycleStatus = planned?.lifecycle ?? "";

  /**
   * True while the device is being asked where the rep is leaving from.
   *
   * Its own flag rather than a reuse of `isPending`, because it covers the
   * moment BEFORE the action is dispatched and the button has to say something
   * different: "Saving…" while a rep waits for a GPS lock would be a lie about
   * what is taking the time.
   */
  const [locating, setLocating] = useState(false);
  const [expectedDate, setExpectedDate] = useState("");
  const [statusSetTo, setStatusSetTo] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(EMPTY_FEEDBACK);

  const status = statusSetTo === "" ? null : statusSetTo;
  // Rule 3's date, unchanged in every respect except where its inputs come
  // from: a "Set" session or campus visit is a promise about a future day, so
  // it must name one. The purpose is what says Set now.
  const needsDate = expectedDateRequired(activity, lifecycleStatus || null);
  const needsFollowUp = followUpRequired(catalogue, status);
  const chosenStatus = statusRow(catalogue, status);

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
     * so the state setter behind the Select is genuinely invoked with the value
     * it had at mount. The rep's choice is not merely hidden; the state is
     * overwritten. They then correct it, fix the flagged photo, submit again,
     * and file the WRONG value without ever seeing it change back.
     *
     * THE CONTROL IT WAS FOUND ON IS GONE. It was the Activity Select, which
     * stage 3 deleted - the activity is derived from the plan's purpose now and
     * is not state at all, so it cannot revert. THE FIX STILL MATTERS: the
     * Institute status Select is still here, still Radix, and still the one
     * value on this form a rep chooses freely. Reverting it to "No change"
     * after a failed submit would file a visit that moved no status, silently.
     *
     * WHY IT LOOKED SELECTIVE, which is what made it worth chasing. Only the
     * Radix-backed controls reverted - Activity, Set/Done, Institute status and
     * the three feedback Pickers, of which only the status now remains. The
     * name/mobile boxes all survived, because those are plain inputs with no
     * reset listener. Two useState values in the SAME component behaving
     * differently is what ruled out a remount and pointed at the form-reset
     * event.
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
        /*
         * THE CHECK-OUT TAKES ITS OWN POSITION, HERE AND NOWHERE ELSE.
         *
         * This tap is the departure — one submit files the report, closes any
         * earlier "Set" and stamps checkout_at — so this is the only moment in
         * the app when the device can be asked where the rep is as they leave.
         * Asked at mount it would answer with the arrival all over again; asked
         * on the server it could not be asked at all.
         *
         * It cannot block the save and is not allowed to look like it might:
         * checkoutFix() resolves with null rather than throwing, the fields go
         * up empty, and close_visit() writes nulls exactly as it did before any
         * of this existed. See appendCheckoutFix for what a null means to the
         * admin reading it afterwards.
         */
        const formData = new FormData(event.currentTarget);
        setLocating(true);
        void checkoutFix()
          .then((fix) => appendCheckoutFix(formData, fix))
          .finally(() => {
            setLocating(false);
            formAction(formData);
          });
      }}
      className="space-y-4"
    >
      {/* Everything the plan already decided, carried rather than re-asked. */}
      <input type="hidden" name="institute_id" value={plan.institute_id} />
      <input type="hidden" name="daily_plan_id" value={plan.id} />
      <input type="hidden" name="activity" value={activity} />
      <input type="hidden" name="lifecycle_status" value={lifecycleStatus} />
      <input
        type="hidden"
        name="expected_date"
        value={lifecycleStatus === "Set" ? expectedDate : ""}
      />
      <input
        type="hidden"
        name="status_set_to"
        value={statusSetTo}
      />

      {/*
        NOTHING IS ASKED HERE ANY MORE — it is shown.

        This section held two Selects: the Activity, and its Set/Done. Both are
        gone. The purpose a rep planned under decides both, through
        purposes.activity (0024) and purposes.lifecycle (0025), so asking again
        would invite a second and disagreeing answer to a question already
        answered on the Dashboard.

        What replaces them is a read-out, because a rep about to log a visit
        should still be able to SEE what it will count as before they save. The
        one thing still asked for is Rule 3's date, and only when the purpose
        says this is a promise about a future day.
      */}
      <FormSection
        title="What happened?"
        description="Decided by what you planned on the Dashboard."
      >
        <div className="border-border bg-muted/40 rounded-md border px-3 py-2">
          <p className="text-sm font-medium">{plan.instituteName}</p>
          <p className="text-muted-foreground text-xs">
            {plan.purpose}
            {plan.purposeNote ? ` · ${plan.purposeNote}` : ""}
          </p>
          {planned && (
            <p className="mt-1.5 text-xs font-medium">
              Logged as {plannedActivityLabel(planned)}
            </p>
          )}
        </div>

        {/* Still rendered, because the schema can still object to either — a
            tampered form, or a plan whose purpose lost its mapping. A rep
            should see the sentence rather than a silent refusal. */}
        {fieldError("activity")}
        {fieldError("lifecycle_status")}
        {fieldError("daily_plan_id")}

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
            <SelectTrigger
              className="h-11 w-full"
              aria-label="Institute status"
              aria-invalid={fieldErrors.status_set_to ? true : undefined}
            >
              {/* A placeholder, because there is no longer a default to show.
                  "No change" used to sit here and be pre-selected, which meant
                  a rep could file a visit that moved nothing without ever
                  touching this control. */}
              <SelectValue placeholder="Choose where this leaves them" />
            </SelectTrigger>
            {/* Grouped so it is obvious which choices leave the institute in
                play — and an open one is what makes the follow-up mandatory
                below. */}
            <SelectContent>
              {STATUS_CATEGORIES.map((category) => (
                <SelectGroup key={category}>
                  <SelectLabel>{CATEGORY_LABELS[category]}</SelectLabel>
                  {statusesInCategory(catalogue, category).map((option) => (
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
            : "Optional. Only if you already know when you are going back."
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
        asks={{
          sessionDetail: chosenStatus?.asksSessionDetail ?? false,
          headCount: chosenStatus?.asksHeadCount ?? false,
        }}
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
          who does not know that will go looking for a check-out afterwards.

          Three labels, not two. The position is taken before the submit is
          dispatched, so there is a few-second stretch where the form has not
          been sent yet — calling that "Saving…" would have the button describe
          something that is not happening. */}
      <Button
        type="submit"
        className="h-11 w-full"
        disabled={isPending || locating}
      >
        {locating
          ? "Checking you out…"
          : isPending
            ? "Saving…"
            : "Save and check out"}
      </Button>
    </form>
  );
}
