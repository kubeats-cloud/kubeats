"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/form-section";
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
    fieldErrors[key] ? <p className="text-danger text-xs">{fieldErrors[key]}</p> : null;

  const wantsSession = asks.sessionDetail;
  const wantsCampusCount = asks.headCount && !asks.sessionDetail;

  return (
    <>
      {/* NO SECTION TITLE. One field, and its own label asks the question — a
          heading above it saying "How did it go?" over a box labelled "How did
          it go?" is one label too many. The description stays, because "this is
          the whole report" is the thing a rep wants to know. */}
      <FormSection description="A few words. This is the whole report.">
        <div className="space-y-2">
          <Label htmlFor="notes">How did it go?</Label>
          <Textarea id="notes" name="notes" rows={4} maxLength={2000} />
          {err("notes")}
        </div>
      </FormSection>

      <FormSection
        title="Who did you meet?"
        description="One person. A number too, if you got one."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="met-name">Name</Label>
            <Input
              id="met-name"
              name="met_name"
              className="h-11"
              maxLength={120}
              value={value.metName}
              onChange={(e) => set("metName", e.target.value)}
              aria-required
            />
            {err("met_name")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="met-phone">Mobile (optional)</Label>
            <Input
              id="met-phone"
              name="met_phone"
              type="tel"
              inputMode="numeric"
              className="h-11"
              maxLength={15}
              value={value.metPhone}
              onChange={(e) => set("metPhone", e.target.value)}
            />
            {err("met_phone")}
          </div>
        </div>
      </FormSection>

      {(wantsSession || wantsCampusCount) && (
        <FormSection
          title={wantsSession ? "The session" : "The campus visit"}
          description={
            wantsSession
              ? "Asked because you marked the session done."
              : "Asked because you marked the campus visit done."
          }
        >
          {/* ONE COUNT.
              There were two here — present and participated — and the client's
              spec asks one question about students, not two. `students_reached`
              goes dormant rather than being dropped, so the reports that
              carried it still render and bringing it back is a control.
              Not required: a rep who did not count heads must still be able to
              file, which is how this number has always behaved. */}
          <div className="space-y-2">
            <Label htmlFor="students-attended">Number of students</Label>
            <Input
              id="students-attended"
              name="students_attended"
              inputMode="numeric"
              className="h-11"
              value={value.studentsAttended}
              onChange={(e) => set("studentsAttended", e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {wantsSession
                ? "Everyone who was in the room."
                : "Everyone who came to see the campus."}
            </p>
            {err("students_attended")}
          </div>

          {wantsSession && (
            <>
              <div className="space-y-2">
                <Label htmlFor="session-topic">What was the topic?</Label>
                <Input
                  id="session-topic"
                  name="session_topic"
                  className="h-11"
                  maxLength={300}
                  value={value.sessionTopic}
                  onChange={(e) => set("sessionTopic", e.target.value)}
                />
                {err("session_topic")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="session-taken-by">Who took it?</Label>
                <Input
                  id="session-taken-by"
                  name="session_taken_by"
                  className="h-11"
                  maxLength={120}
                  value={value.sessionTakenBy}
                  onChange={(e) => set("sessionTakenBy", e.target.value)}
                />
                {err("session_taken_by")}
              </div>
            </>
          )}
        </FormSection>
      )}

      {/* Q2 — the offer, never automatic. A rep who set a session here earlier
          is asked whether THIS visit is the one that completed it, and the
          answer names the exact row so nobody is credited with the wrong loop. */}
      {openLoops.length > 0 && (
        <FormSection
          title="Does this close an earlier plan?"
          description="You set these here and they are still open."
        >
          <input type="hidden" name="closes_visit_id" value={value.closesVisitId} />
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
    </>
  );
}
