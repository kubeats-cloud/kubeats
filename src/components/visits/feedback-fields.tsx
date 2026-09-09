"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSection } from "@/components/form-section";
import {
  MANAGEMENT_RESPONSES,
  STUDENT_RESPONSES,
  VISIT_OUTCOMES,
  needsCampusCount,
  needsSessionDetail,
} from "@/lib/validation/feedback";
import type { OpenLoop } from "@/lib/visits";
import { formatDate } from "@/lib/dates";
import { activityLabelFor } from "@/lib/validation/visit";

/**
 * The short feedback form's fields, shared by the two screens that render them.
 *
 * They appear at the foot of Log Visit for a visit being logged now, and on
 * their own when a visit was logged but its feedback did not land. One copy, so
 * the two cannot drift into asking different questions.
 *
 * Everything is driven by the STATUS the rep has already chosen — not by a
 * checklist of what they did. The old form asked both and then had to reconcile
 * them; this asks once.
 */

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

function Choice({
  name,
  legend,
  value,
  onChange,
  error,
}: {
  name: string;
  legend: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <input type="hidden" name={name} value={value} />
      <div className="flex gap-2">
        {YES_NO.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={
              "h-11 flex-1 rounded-md border text-sm font-medium transition-colors " +
              (value === option.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-accent")
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      {error && <p className="text-danger text-xs">{error}</p>}
    </fieldset>
  );
}

/**
 * One dropdown, its hidden field and its error, in one place.
 *
 * Three near-identical selects is exactly where a copy-paste slip puts the
 * wrong `name` on the right control and the value lands in another column.
 */
function Picker({
  label,
  name,
  placeholder,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  name: string;
  placeholder: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-11 w-full" aria-label={label}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input type="hidden" name={name} value={value} />
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}

export interface FeedbackState {
  interested: string;
  visitOutcome: string;
  managementResponse: string;
  studentResponse: string;
  nextMeetingSet: string;
  followUpDate: string;
  followUpTime: string;
  metName: string;
  metPhone: string;
  studentsAttended: string;
  sessionTopic: string;
  sessionTakenBy: string;
  closesVisitId: string;
}

export const EMPTY_FEEDBACK: FeedbackState = {
  interested: "",
  visitOutcome: "",
  managementResponse: "",
  studentResponse: "",
  nextMeetingSet: "",
  followUpDate: "",
  followUpTime: "",
  metName: "",
  metPhone: "",
  studentsAttended: "",
  sessionTopic: "",
  sessionTakenBy: "",
  closesVisitId: "",
};

export function FeedbackFields({
  status,
  value,
  onChange,
  fieldErrors,
  openLoops,
}: {
  /** The institute status the rep chose. It decides what else is asked. */
  status: string | null;
  value: FeedbackState;
  onChange: (next: FeedbackState) => void;
  fieldErrors: Record<string, string>;
  /** Q2 — earlier "Set" loops at this institute the rep may be closing. */
  openLoops: OpenLoop[];
}) {
  const set = <K extends keyof FeedbackState>(key: K, v: FeedbackState[K]) =>
    onChange({ ...value, [key]: v });

  const err = (key: string) =>
    fieldErrors[key] ? <p className="text-danger text-xs">{fieldErrors[key]}</p> : null;

  const wantsSession = needsSessionDetail(status);
  const wantsCampusCount = needsCampusCount(status);
  const wantsFollowUp = value.nextMeetingSet === "yes";

  return (
    <>
      <FormSection
        title="How did it go?"
        description="A few words and two questions. This is the whole report."
      >
        <div className="space-y-2">
          <Label htmlFor="notes">What did they say?</Label>
          <Textarea id="notes" name="notes" rows={3} maxLength={2000} />
          {err("notes")}
        </div>

        <Choice
          name="interested"
          legend="Is the institute interested?"
          value={value.interested}
          onChange={(v) => set("interested", v)}
          error={fieldErrors.interested}
        />

        {/* Three dropdowns, each one a fixed vocabulary the database also
            holds as a CHECK. The management interest LEVEL that briefly sat
            here is gone: a level beside a response is two answers to one
            question, and the response is the one that says something. */}
        <Picker
          label="How did the visit end?"
          name="visit_outcome"
          placeholder="Choose an outcome"
          options={VISIT_OUTCOMES}
          value={value.visitOutcome}
          onChange={(v) => set("visitOutcome", v)}
          error={fieldErrors.visit_outcome}
        />

        <Picker
          label="How did management respond?"
          name="management_response"
          placeholder="Choose a response"
          options={MANAGEMENT_RESPONSES}
          value={value.managementResponse}
          onChange={(v) => set("managementResponse", v)}
          error={fieldErrors.management_response}
        />

        <Picker
          label="How did the students respond?"
          name="student_response"
          placeholder="Choose a response"
          options={STUDENT_RESPONSES}
          value={value.studentResponse}
          onChange={(v) => set("studentResponse", v)}
          error={fieldErrors.student_response}
        />
      </FormSection>

      <FormSection
        title="Who did you meet?"
        description="One person, and a number to reach them on."
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
            />
            {err("met_name")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="met-phone">Mobile</Label>
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
          <div className="space-y-2">
            <Label htmlFor="students-attended">
              {wantsSession ? "How many students attended?" : "How many students visited?"}
            </Label>
            <Input
              id="students-attended"
              name="students_attended"
              inputMode="numeric"
              className="h-11"
              value={value.studentsAttended}
              onChange={(e) => set("studentsAttended", e.target.value)}
            />
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

      <FormSection
        title="What happens next?"
        description="If you have fixed a next meeting, put it in the diary now."
      >
        <Choice
          name="next_meeting_set"
          legend="Is a next session or meeting set?"
          value={value.nextMeetingSet}
          onChange={(v) => set("nextMeetingSet", v)}
          error={fieldErrors.next_meeting_set}
        />

        {/* Shown only when there IS one. Asking for a date beside a "No" is how
            a form teaches people to type something to get past it. */}
        {wantsFollowUp && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="follow-up-date">Date</Label>
              <Input
                id="follow-up-date"
                name="follow_up_date"
                type="date"
                className="h-11"
                value={value.followUpDate}
                onChange={(e) => set("followUpDate", e.target.value)}
                aria-required
              />
              {err("follow_up_date")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="follow-up-time">Time</Label>
              <Input
                id="follow-up-time"
                name="follow_up_time"
                type="time"
                className="h-11"
                value={value.followUpTime}
                onChange={(e) => set("followUpTime", e.target.value)}
                aria-required
              />
              {err("follow_up_time")}
            </div>
          </div>
        )}
        {!wantsFollowUp && (
          <input type="hidden" name="follow_up_date" value="" />
        )}
        {!wantsFollowUp && (
          <input type="hidden" name="follow_up_time" value="" />
        )}
      </FormSection>

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
