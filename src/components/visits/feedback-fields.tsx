"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/form-section";
import { RequiredMark } from "@/components/required-mark";
import {
  type FeedbackAsks,
  type FeedbackPatch,
  type FeedbackState,
} from "@/lib/validation/feedback";

export { EMPTY_FEEDBACK, type FeedbackState } from "@/lib/validation/feedback";
import type { OpenLoop } from "@/lib/visits";
import { formatDate } from "@/lib/dates";
import { activityLabelFor } from "@/lib/validation/visit";

/**
 * The short closing report's fields, shared by the two screens that render
 * them.
 *
 * They appear at the foot of Log Visit for a visit being logged now, and on
 * their own when a visit was logged but its feedback did not land. One copy, so
 * the two cannot drift into asking different questions.
 *
 * EVERYTHING HERE IS A FIELD `close_visit()` WRITES. That is not a coincidence,
 * it is the rule this component now keeps: the follow-up used to be rendered
 * here too, and on the recovery path `close_visit()` never wrote it, so the rep
 * typed a date into a box that threw it away. The follow-up moved to Log Visit,
 * beside the status that decides whether it is required. See validation/feedback.ts.
 *
 * What is asked is driven by the STATUS the rep has already chosen — not by a
 * checklist of what they did. The old form asked both and then had to reconcile
 * them; this asks once.
 */

/**
 * One dropdown, its hidden field and its error, in one place.
 *
 * `Choice` and `Picker` lived here too — five controls between them, for
 * "Is the institute interested?", the outcome, the management response, the
 * student response and "Is a next session set?". All five are withdrawn; their
 * columns stay dormant and their vocabularies stay in validation/feedback.ts,
 * so bringing one back is a control rather than a migration.
 */

export function FeedbackFields({
  asks,
  notesRequired,
  value,
  onChange,
  fieldErrors,
  openLoops,
}: {
  /**
   * Which extra question groups the chosen status turns on.
   *
   * Read off the status row by the caller (asks_session_detail /
   * asks_head_count, migration 0026) rather than worked out here from the
   * status name. This component no longer has an opinion about which statuses
   * have students in them, which is what lets an admin add one that does.
   */
  asks: FeedbackAsks;
  /**
   * Whether Notes must be filled in — decided by the status, not by this
   * component. `notesRequired()` excuses the instant closes ("RSVP received",
   * "Will not come"), where the status is the whole answer and a sentence would
   * only restate the dropdown.
   */
  notesRequired: boolean;
  value: FeedbackState;
  /**
   * Emits a PATCH, not a merged object, and that is the whole fix.
   *
   * This used to hand back `{ ...value, [key]: v }` — the whole state, merged
   * here against the `value` prop. Two changes in one tick therefore both
   * merged against the SAME stale prop and the second silently overwrote the
   * first, which is exactly what happened when two buttons were tapped in the
   * same tick during live verification.
   *
   * A patch cannot do that: the component no longer has the whole object to
   * merge, so the merge has to happen where the latest state is — inside a
   * functional update in the parent.
   */
  onChange: (patch: FeedbackPatch) => void;
  fieldErrors: Record<string, string>;
  /** Q2 — earlier "Set" loops at this institute the rep may be closing. */
  openLoops: OpenLoop[];
}) {
  const set = <K extends keyof FeedbackState>(key: K, v: FeedbackState[K]) =>
    onChange({ [key]: v } as FeedbackPatch);

  const err = (key: string) =>
    fieldErrors[key] ? (
      <p className="text-danger text-xs">{fieldErrors[key]}</p>
    ) : null;

  const wantsSession = asks.sessionDetail;
  const wantsCampusCount = asks.headCount && !asks.sessionDetail;

  return (
    <>
      {/* "Who did you meet?" STOOD HERE — a required name and an optional
          mobile. Withdrawn (change #17): the decision-maker and the principal
          are captured once at institute registration, where they are a property
          of the school rather than of the afternoon, so asking again on every
          visit collected the same two facts over and over and made the rep type
          a name they had already given us.

          `met_name` and `met_phone` go DORMANT, not dropped — the same
          treatment the outcome, the management response, the student response
          and the rest got. `close_visit()` takes them as defaulted parameters
          and feedback-actions.ts passes null explicitly, so every report filed
          before today keeps its answer and renders it; only new ones are
          silent. Bringing the question back is these fields restored, not a
          migration. */}

      {/*
        NO TITLE AND NO DESCRIPTION. These were a card headed "The session" with
        a line reading "Asked because you marked the session done." — both
        removed with the rest of the form's prose. Which status turned the
        fields on is not news to the rep who just chose it, and the labels name
        the fields perfectly well on their own.
      */}
      {(wantsSession || wantsCampusCount) && (
        <>
          {/* ONE COUNT.
              There were two here — present and participated — and the client's
              spec asks one question about students, not two. `students_reached`
              goes dormant rather than being dropped, so the reports that
              carried it still render and bringing it back is a control.
              Not required: a rep who did not count heads must still be able to
              file, which is how this number has always behaved. */}
          <div className="space-y-2">
            <Label htmlFor="students-attended">
              Number of Students <RequiredMark />
            </Label>
            <Input
              id="students-attended"
              name="students_attended"
              inputMode="numeric"
              className="h-11"
              value={value.studentsAttended}
              onChange={(e) => set("studentsAttended", e.target.value)}
              aria-required
            />
            {err("students_attended")}
          </div>

          {wantsSession && (
            <>
              <div className="space-y-2">
                <Label htmlFor="session-topic">
                  Topic Title <RequiredMark />
                </Label>
                <Input
                  id="session-topic"
                  name="session_topic"
                  className="h-11"
                  maxLength={300}
                  value={value.sessionTopic}
                  onChange={(e) => set("sessionTopic", e.target.value)}
                  aria-required
                />
                {err("session_topic")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="session-taken-by">
                  Taken By <RequiredMark />
                </Label>
                <Input
                  id="session-taken-by"
                  name="session_taken_by"
                  className="h-11"
                  maxLength={120}
                  value={value.sessionTakenBy}
                  onChange={(e) => set("sessionTakenBy", e.target.value)}
                  aria-required
                />
                {err("session_taken_by")}
              </div>
            </>
          )}
        </>
      )}

      {/* Q2 — the offer, never automatic. A rep who set a session here earlier
          is asked whether THIS visit is the one that completed it, and the
          answer names the exact row so nobody is credited with the wrong loop. */}
      {openLoops.length > 0 && (
        <FormSection title="Does this close an earlier plan?">
          <input
            type="hidden"
            name="closes_visit_id"
            value={value.closesVisitId}
          />
          <div className="space-y-2">
            {openLoops.map((loop) => {
              const chosen = value.closesVisitId === loop.id;
              return (
                <button
                  key={loop.id}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => set("closesVisitId", chosen ? "" : loop.id)}
                  className={
                    "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors " +
                    (chosen
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-accent")
                  }
                >
                  <span>
                    <span className="font-medium">
                      {activityLabelFor(loop.activity)}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      · expected {formatDate(loop.expected_date ?? loop.date)}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {chosen ? "Closing this" : "Tap to close"}
                  </span>
                </button>
              );
            })}
          </div>
          {err("closes_visit_id")}
        </FormSection>
      )}
      {/*
        NOTES IS LAST, ALWAYS.

        It used to be FIRST, which put the free-text box above the three fields
        a "Session done" actually needs — so a rep wrote the story, then found
        out there were numbers to fill in, then scrolled back to check what they
        had said. Last is also what the client's spec asks for, on all nine
        statuses.

        Required for seven of the nine and not for the two instant closes; the
        caller decides, because the rule belongs to the status.
      */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes {notesRequired && <RequiredMark />}</Label>
        {/* Controlled, so a draft can hold it — see FeedbackState. Everything
            else about it is unchanged: same name, same cap, same rule. */}
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={2000}
          aria-required={notesRequired || undefined}
          value={value.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
        {err("notes")}
      </div>
    </>
  );
}
