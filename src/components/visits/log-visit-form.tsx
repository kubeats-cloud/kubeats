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
import { clearDraft, logVisitDraftKey } from "@/lib/drafts";
import { useDraft } from "@/lib/use-draft";
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
  eventDateLabel,
  eventDateRequired,
  fieldLabel,
  followUpRequired,
  notesRequired,
  plannedActivityIsValid,
  plannedActivityLabel,
  postedEventDate,
} from "@/lib/validation/visit";
import { FormNotice } from "@/components/form-notice";
import { RequiredMark } from "@/components/required-mark";

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
 * What a half-finished Log Visit is, as far as the draft store is concerned.
 *
 * EVERY TYPED FIELD ON THE FORM, and nothing else. The institute, the purpose,
 * the activity and the plan id are not here because the rep cannot change them
 * — they come from the plan row and are re-read from the server on every mount,
 * which is also why a restored draft can never disagree with what the visit
 * actually is.
 *
 * THE PHOTOGRAPH IS DELIBERATELY ABSENT, and it is the one omission worth
 * stating. `CaptureFields` owns a live capture: the frame comes off the camera
 * stream, the coordinates are read at the moment of attaching, and what it
 * leaves behind in the form is a path to an already-uploaded object. Restoring
 * that path alone would put a hidden field back without the preview beside it,
 * so the form would claim a photo the rep cannot see and has no way to check.
 * A rep who navigates away mid-capture retakes the picture, which is a few
 * seconds; a visit filed against a photo nobody looked at is not recoverable.
 */
interface LogVisitDraft {
  statusSetTo: string;
  expectedDate: string;
  followUpDate: string;
  feedback: FeedbackState;
}

const EMPTY_DRAFT: LogVisitDraft = {
  statusSetTo: "",
  expectedDate: "",
  followUpDate: "",
  feedback: EMPTY_FEEDBACK,
};

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

  /*
   * EVERY TYPED FIELD IS ONE DRAFT OBJECT, restored on every mount.
   *
   * These were four separate `useState`s with a restore effect writing into all
   * four, and a save effect racing it. On a SOFT navigation the save won: the
   * form mounted empty, the save wrote that emptiness over the stored draft
   * before the restore landed, and the rep came back to a blank form and a
   * damaged draft. QA saw one field lost — the status — which is what a write
   * that races a partial restore looks like.
   *
   * One object cannot be partially restored, and `useDraft` reads it during the
   * first render rather than after it, so no effect ever observes an empty
   * form. Its header carries the whole account, including how the hydration
   * problem that made the first version effect-based is handled instead of
   * traded away.
   *
   * KEYED BY THE PLAN ENTRY, so one visit's draft can never appear on
   * another's form. `plan.id` is unique per visit and is already what
   * `/log?plan=` addresses, so the key and the screen agree by construction.
   *
   * `serverState` is passed as the re-save trigger: the draft is CLEARED when
   * the form is dispatched, so a submission that comes back REFUSED has to put
   * it back rather than leave the rep holding a filled-in form with nothing
   * behind it.
   */
  const draftKey = logVisitDraftKey(plan.id);
  const [draft, patchDraft] = useDraft(draftKey, EMPTY_DRAFT, { resaveOn: serverState });
  const { statusSetTo, expectedDate, followUpDate, feedback } = draft;

  const status = statusSetTo === "" ? null : statusSetTo;
  /*
   * EVERY CONDITIONAL FIELD HANGS OFF THE STATUS NOW.
   *
   * The date used to be keyed to the purpose's lifecycle, which meant the two
   * statuses that actually know when something happened — "Session done" and
   * "Campus visit done" — were never asked for a date at all. It reads
   * `asks_expected_date` off the chosen status instead, which 0026 put on
   * `institute_statuses` and which was already correct for all four.
   */
  const needsDate = eventDateRequired(catalogue, status);
  const needsFollowUp = followUpRequired(catalogue, status);
  const needsNotes = notesRequired(catalogue, status);
  const chosenStatus = statusRow(catalogue, status);

  /*
   * handleFollowUpDate() stood here — it pre-filled the time to 11:00 the
   * moment a date was chosen. Both it and the Time field are gone: 0023 drops
   * the time from Rule 5, so there is no second half left to answer for the
   * rep. setFollowUpDate is wired straight to the one remaining input.
   */

  const error = serverState.error ?? clientState.error;
  const rawFieldErrors = serverState.error
    ? serverState.fieldErrors
    : clientState.fieldErrors;

  /*
   * AN ERROR ABOUT A FIELD THAT IS NO LONGER ON SCREEN IS NOT AN ERROR.
   *
   * Both of these hang off the STATUS, and the status is the one thing a rep
   * changes after a failed submit. Picking "Session scheduled", submitting
   * without a date, then switching to "RSVP received" left the refusal standing
   * — "Pick the Session Date" — pointing at a control that had just been
   * unmounted by the same change. There is nothing to fix and nowhere to fix
   * it, which is the worst shape an error message can take.
   *
   * Cleared by asking the SAME questions the fields are rendered by, rather
   * than by remembering to clear state in each onValueChange: the errors are
   * then simply a function of the current status, and a third conditional field
   * added later cannot forget to be handled here.
   *
   * The server's copy is filtered too, not just the client's. The rep changes
   * the status without submitting again, so `serverState` still holds the
   * refusal from the previous attempt.
   */
  const fieldErrors = Object.fromEntries(
    Object.entries(rawFieldErrors).filter(([key]) => {
      if (key === "expected_date") return needsDate;
      if (key === "follow_up_date") return needsFollowUp;
      return true;
    }),
  );

  /*
   * ONE NAME FOR ONE BOX, in the summary as well as on the control.
   *
   * `fieldLabel` is keyed by field name and cannot know which status is
   * chosen, so it can only answer "Tentative date" — while the control above
   * it reads "Expected Session Date" and the message inside it says "Pick the
   * Session Date". Three names for one field. This asks `eventDateLabel()` for
   * the one field that has a status-dependent name and defers to `fieldLabel`
   * for the rest.
   */
  const labelForField = (key: string) =>
    key === "expected_date" ? eventDateLabel(catalogue, status) : fieldLabel(key);

  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <p className="text-danger text-xs">{fieldErrors[key]}</p>
    ) : null;

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

        /*
         * CLEARED HERE, because there is no later moment to do it in. A
         * successful submit ends in `redirect("/?filed=1")`, which unmounts
         * this component — so no effect and no success state ever runs on this
         * screen again, and a "clear when it worked" would never fire. The
         * draft would then outlive the visit it belonged to and be handed back
         * the next time anything opened `/log?plan=` for the same entry.
         *
         * Clearing early is safe because nothing on screen is cleared with it:
         * the React state is untouched, so a refused submit leaves every field
         * exactly as the rep left it, and the save effect above writes the
         * draft back as soon as the refusal lands.
         */
        clearDraft(draftKey);
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
      {/*
        THE HIDDEN FIELD ASKS THE SAME QUESTION AS THE VISIBLE ONE.

        It read `lifecycleStatus === "Set"` — the PURPOSE's question — while the
        box above it is shown by `needsDate`, the STATUS's. A rep completing a
        session (planned "Done", status "Session done") saw the date field,
        filled it in, and posted an empty string. `visitSchema` then refused the
        visit for a date that was on their screen, and no amount of retrying
        helped. postedEventDate() is what keeps the two in step; see its comment
        in validation/visit.ts for why the empty branch matters too.
      */}
      <input
        type="hidden"
        name="expected_date"
        value={postedEventDate(catalogue, status, expectedDate)}
      />
      <input type="hidden" name="status_set_to" value={statusSetTo} />

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
      <FormSection title="What happened?">
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
      </FormSection>

      <FormSection title="Photo">
        <CaptureFields userId={userId} />
      </FormSection>

      {/*
        STATUS FIRST, AND EVERYTHING ELSE BEHIND IT.
        The spec's order for all nine statuses is one straight line — Status,
        follow-up, the event date, the session detail, then Notes — so the
        fields live in that order in one section rather than in titled cards
        that each explain themselves. Nothing status-driven renders until a
        status is chosen: before the pick there is nothing true to show, and a
        form that fills in as it is answered is shorter to read than one that
        greys out.
      */}
      <FormSection>
        <div className="space-y-2">
          <Label>
            Status <RequiredMark />
          </Label>
          <Select
            value={statusSetTo}
            onValueChange={(value) => patchDraft({ statusSetTo: value })}
          >
            <SelectTrigger
              className="h-11 w-full"
              aria-label="Institute status"
              aria-invalid={fieldErrors.status_set_to ? true : undefined}
            >
              {/* A placeholder, because there is no longer a default to show.
                  "No change" used to sit here and be pre-selected, which meant
                  a rep could file a visit that moved nothing without ever
                  touching this control. */}
              <SelectValue placeholder="Select" />
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

        {/*
          THE FOLLOW-UP IS GATED ON THE STATUS, not merely labelled by it.

          It used to render for all nine and only CHANGE ITS DESCRIPTION when
          the status was closed, which is the client's first complaint: a rep
          closing a visit with "RSVP received" was still shown a box asking when
          they were going back. Now `followUpRequired()` — which is
          `isOpenStatus()` — decides whether it exists at all.

          WHAT THIS GIVES UP, DELIBERATELY. 0010 permits a follow-up on a CLOSED
          status, and "they said no, ask again next intake" was a real use of
          it. The client asked for the simpler rule and this takes it. Nothing
          in the database changes: `follow_up_date` stays nullable and every
          value already recorded is still there, so restoring the case is this
          condition and nothing else.
        */}
        {status && (
          <>
            {needsFollowUp && (
              <div className="space-y-2 sm:max-w-xs">
                <Label htmlFor="follow-up-date">
                  Follow-up Date <RequiredMark />
                </Label>
                <Input
                  id="follow-up-date"
                  name="follow_up_date"
                  type="date"
                  className="h-11"
                  value={followUpDate}
                  onChange={(event) =>
                    patchDraft({ followUpDate: event.target.value })
                  }
                  aria-required
                />
                {fieldError("follow_up_date")}
              </div>
            )}

            {needsDate && (
              <div className="space-y-2 sm:max-w-xs">
                <Label htmlFor="expected-date">
                  {eventDateLabel(catalogue, status)} <RequiredMark />
                </Label>
                <Input
                  id="expected-date"
                  type="date"
                  className="h-11"
                  value={expectedDate}
                  onChange={(event) =>
                    patchDraft({ expectedDate: event.target.value })
                  }
                  aria-required
                />
                {fieldError("expected_date")}
              </div>
            )}

            <FeedbackFields
              asks={{
                sessionDetail: chosenStatus?.asksSessionDetail ?? false,
                headCount: chosenStatus?.asksHeadCount ?? false,
              }}
              notesRequired={needsNotes}
              value={feedback}
              // Functional all the way down, so two changes in one tick both
              // survive: the second merges against the first's result rather
              // than against the render it started from. Reading `feedback`
              // from the closure here instead would put back the bug
              // applyFeedbackPatch was made functional to fix.
              onChange={(patch) =>
                patchDraft((current) => ({
                  feedback: applyFeedbackPatch(current.feedback, patch),
                }))
              }
              fieldErrors={fieldErrors}
              openLoops={openLoops}
            />
          </>
        )}
      </FormSection>

      {error && (
        <FormNotice
          message={error}
          fieldErrors={fieldErrors}
          labelFor={labelForField}
        />
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
