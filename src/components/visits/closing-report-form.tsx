"use client";

import { useActionState, useState } from "react";
import { formatDate } from "@/lib/dates";
import {
  CheckCircle2Icon,
  PencilIcon,
  PlusIcon,
  TriangleAlertIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/form-section";
import { Checkbox } from "@/components/ui/checkbox";
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
import { VisitPhotoThumb } from "@/components/visits/visit-photo";
import { submitClosingReport } from "@/lib/closing-actions";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import { activityLabelFor } from "@/lib/validation/visit";
import {
  ACTIVITIES_CONDUCTED,
  CONTACT_TYPES,
  MANAGEMENT_RESPONSES,
  PARTICIPATION_LEVELS,
  SESSION_CLASSES,
  SESSION_STREAMS,
  STUDENT_RESPONSES,
  VISIT_OUTCOMES,
  closingReportFormDataToInput,
  closingReportSchema,
  hasAdmissions,
  hasApplications,
  hasManagement,
  hasSession,
} from "@/lib/validation/closing-report";
import { fieldLabel, visitFieldErrors } from "@/lib/validation/visit";
import type { VisitReport } from "@/lib/closing-report";
import { cn } from "@/lib/utils";

/**
 * The closing report.
 *
 * Two ideas hold it together. First, the header is read-only: where, who, when
 * and the coordinates were all settled when the visit was logged, and asking
 * again would only produce a second answer that disagrees. Second, the form
 * asks what happened and then insists only on what follows from that — tick
 * "Career guidance session" and it wants the topic and the attendance; do not,
 * and it never mentions them. A required field nobody can answer honestly is
 * how you teach a team to type "n/a".
 *
 * Everything lives in React state and is mirrored into hidden inputs, so the
 * review step can hide the controls without losing the answers.
 */

interface Person {
  name: string;
  contact_type: string;
  designation: string;
  contact_number: string;
  is_decision_maker: boolean;
}

const BLANK_PERSON: Person = {
  name: "",
  contact_type: "Principal",
  designation: "",
  contact_number: "",
  is_decision_maker: false,
};

export function ClosingReportForm({ visit }: { visit: VisitReport }) {
  const [serverState, formAction, isPending] = useActionState(
    submitClosingReport,
    EMPTY_STATE,
  );
  const [clientState, setClientState] = useState<FormState>(EMPTY_STATE);
  const [reviewing, setReviewing] = useState(false);

  const [people, setPeople] = useState<Person[]>(
    visit.people.length > 0
      ? visit.people.map((p) => ({
          name: p.name,
          contact_type: p.contact_type,
          designation: p.designation ?? "",
          contact_number: p.contact_number ?? "",
          is_decision_maker: p.is_decision_maker,
        }))
      : [{ ...BLANK_PERSON }],
  );
  const [activities, setActivities] = useState<string[]>(
    visit.activities_conducted ?? [],
  );
  const [field, setField] = useState<Record<string, string>>({
    session_topic: visit.session_topic ?? "",
    session_class: visit.session_class ?? "",
    students_attended: visit.students_attended?.toString() ?? "",
    session_duration_mins: visit.session_duration_mins?.toString() ?? "",
    other_faculty_present: visit.other_faculty_present ?? "",
    other_faculty_count: visit.other_faculty_count?.toString() ?? "",
    session_participation: visit.session_participation ?? "",
    student_questions: visit.student_questions ?? "",
    student_response: visit.student_response ?? "",
    student_interest: visit.student_interest?.toString() ?? "",
    management_feedback: visit.management_feedback ?? "",
    discussion_summary: visit.discussion_summary ?? "",
    visit_outcome: visit.visit_outcome ?? "",
    applications_collected: visit.applications_collected?.toString() ?? "",
    admissions_generated: visit.admissions_generated?.toString() ?? "",
    follow_up_action: visit.follow_up_action ?? "",
    follow_up_date: visit.follow_up_date ?? "",
    employee_remarks: visit.employee_remarks ?? "",
  });
  const [streams, setStreams] = useState<string[]>(visit.session_streams ?? []);
  const [managementResponse, setManagementResponse] = useState<string[]>(
    visit.management_response ?? [],
  );
  const [followUp, setFollowUp] = useState(Boolean(visit.follow_up_action));

  const set = (key: string) => (value: string) =>
    setField((prev) => ({ ...prev, [key]: value }));
  const digits = (key: string, max: number) => (value: string) =>
    set(key)(value.replace(/\D/g, "").slice(0, max));

  const showSession = hasSession(activities);
  const showManagement = hasManagement(activities);
  const showApplications = hasApplications(activities);
  const showAdmissions = hasAdmissions(activities);

  const error = serverState.error ?? clientState.error;
  const fieldErrors = serverState.error
    ? serverState.fieldErrors
    : clientState.fieldErrors;
  const problem = (key: string) =>
    fieldErrors[key] ? <p className="text-danger text-xs">{fieldErrors[key]}</p> : null;

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  /** Validate before showing the review, so nobody reviews an invalid report. */
  function handleReview(form: HTMLFormElement) {
    const parsed = closingReportSchema.safeParse(
      closingReportFormDataToInput(new FormData(form)),
    );
    if (!parsed.success) {
      setClientState({
        error: "Please check the highlighted fields.",
        fieldErrors: visitFieldErrors(parsed.error),
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setClientState(EMPTY_STATE);
    setReviewing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* Everything the action reads, whichever step is on screen. --------- */}
      <input type="hidden" name="visit_id" value={visit.id} />
      <input type="hidden" name="people" value={JSON.stringify(people)} />
      {activities.map((value) => (
        <input key={value} type="hidden" name="activities_conducted" value={value} />
      ))}
      {(showSession ? streams : []).map((value) => (
        <input key={value} type="hidden" name="session_streams" value={value} />
      ))}
      {(showManagement ? managementResponse : []).map((value) => (
        <input key={value} type="hidden" name="management_response" value={value} />
      ))}
      <input type="hidden" name="follow_up_needed" value={followUp ? "yes" : "no"} />
      {Object.entries(field).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}

      {error && (
        <div
          role="alert"
          className="bg-danger-subtle text-danger-subtle-foreground space-y-1 rounded-md px-3 py-2 text-sm"
        >
          <p>{error}</p>
          {Object.keys(fieldErrors).length > 0 && (
            <ul className="list-inside list-disc">
              {Object.entries(fieldErrors).map(([key, message]) => (
                <li key={key}>
                  <span className="font-medium">{fieldLabel(key)}</span>: {message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {reviewing ? (
        <Review
          visit={visit}
          people={people}
          activities={activities}
          field={field}
          streams={streams}
          managementResponse={managementResponse}
          followUp={followUp}
          isPending={isPending}
          onBack={() => setReviewing(false)}
        />
      ) : (
        <>
          {/* 1. People met ---------------------------------------------- */}
          <FormSection
            title="Who did you meet?"
            description="At least one name. This is who the relationship is with."
          >
              {people.map((person, index) => (
                <div
                  key={index}
                  className="border-border space-y-3 rounded-md border p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-muted-foreground text-xs font-medium">
                      Person {index + 1}
                    </p>
                    {people.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="size-9"
                        aria-label={`Remove person ${index + 1}`}
                        onClick={() =>
                          setPeople(people.filter((_, i) => i !== index))
                        }
                      >
                        <XIcon className="size-4" aria-hidden />
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`person-name-${index}`}>Name</Label>
                    <Input
                      id={`person-name-${index}`}
                      className="h-11"
                      maxLength={120}
                      value={person.name}
                      onChange={(e) =>
                        setPeople(
                          people.map((p, i) =>
                            i === index ? { ...p, name: e.target.value } : p,
                          ),
                        )
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>What they do</Label>
                    <Select
                      value={person.contact_type}
                      onValueChange={(value) =>
                        setPeople(
                          people.map((p, i) =>
                            i === index ? { ...p, contact_type: value } : p,
                          ),
                        )
                      }
                    >
                      <SelectTrigger className="h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTACT_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`person-designation-${index}`}>
                        Designation (optional)
                      </Label>
                      <Input
                        id={`person-designation-${index}`}
                        className="h-11"
                        maxLength={120}
                        value={person.designation}
                        onChange={(e) =>
                          setPeople(
                            people.map((p, i) =>
                              i === index ? { ...p, designation: e.target.value } : p,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`person-number-${index}`}>
                        Mobile (optional)
                      </Label>
                      <Input
                        id={`person-number-${index}`}
                        className="h-11"
                        inputMode="numeric"
                        value={person.contact_number}
                        onChange={(e) =>
                          setPeople(
                            people.map((p, i) =>
                              i === index
                                ? {
                                    ...p,
                                    contact_number: e.target.value
                                      .replace(/\D/g, "")
                                      .slice(0, 10),
                                  }
                                : p,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>

                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <Checkbox
                      checked={person.is_decision_maker}
                      onCheckedChange={(checked) =>
                        setPeople(
                          people.map((p, i) =>
                            i === index
                              ? { ...p, is_decision_maker: checked === true }
                              : p,
                          ),
                        )
                      }
                    />
                    They can make the decision
                  </label>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                className="h-11 w-full"
                onClick={() => setPeople([...people, { ...BLANK_PERSON }])}
              >
                <UserPlusIcon className="size-4" aria-hidden />
                Add another person
              </Button>
              {problem("people")}
          </FormSection>

          {/* 2. What was actually done ---------------------------------- */}
          <FormSection
            title="What did you do?"
            description="Tick everything that happened. This is what the visit turned out to be, which is not always what it was planned as."
          >
              {ACTIVITIES_CONDUCTED.map((option) => (
                <label
                  key={option}
                  className="flex min-h-11 items-center gap-3 text-sm"
                >
                  <Checkbox
                    checked={activities.includes(option)}
                    onCheckedChange={() => setActivities(toggle(activities, option))}
                  />
                  {option}
                </label>
              ))}
              {problem("activities_conducted")}
          </FormSection>

          {/* 3. Session detail ------------------------------------------ */}
          {showSession && (
            <FormSection
              title="The session"
              description="Only asked because you ticked a session above."
            >
                <div className="space-y-2">
                  <Label htmlFor="topic">Topic covered</Label>
                  <Input
                    id="topic"
                    className="h-11"
                    maxLength={300}
                    value={field.session_topic}
                    onChange={(e) => set("session_topic")(e.target.value)}
                  />
                  {problem("session_topic")}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Class</Label>
                    <Select
                      value={field.session_class}
                      onValueChange={set("session_class")}
                    >
                      <SelectTrigger className="h-11 w-full">
                        <SelectValue placeholder="Which class?" />
                      </SelectTrigger>
                      <SelectContent>
                        {SESSION_CLASSES.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option === "Mixed" ? "Mixed classes" : `Class ${option}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {problem("session_class")}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="attended">Students attended</Label>
                    <Input
                      id="attended"
                      className="h-11"
                      inputMode="numeric"
                      value={field.students_attended}
                      onChange={(e) => digits("students_attended", 5)(e.target.value)}
                    />
                    {problem("students_attended")}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Streams present (optional)</Label>
                  <div className="flex flex-wrap gap-4">
                    {SESSION_STREAMS.map((stream) => (
                      <label
                        key={stream}
                        className="flex min-h-11 items-center gap-2 text-sm capitalize"
                      >
                        <Checkbox
                          checked={streams.includes(stream)}
                          onCheckedChange={() => setStreams(toggle(streams, stream))}
                        />
                        {stream}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="duration">Duration in minutes (optional)</Label>
                    <Input
                      id="duration"
                      className="h-11"
                      inputMode="numeric"
                      value={field.session_duration_mins}
                      onChange={(e) => digits("session_duration_mins", 3)(e.target.value)}
                    />
                    {problem("session_duration_mins")}
                  </div>
                  <div className="space-y-2">
                    <Label>Participation</Label>
                    <Select
                      value={field.session_participation}
                      onValueChange={set("session_participation")}
                    >
                      <SelectTrigger className="h-11 w-full">
                        <SelectValue placeholder="How engaged?" />
                      </SelectTrigger>
                      <SelectContent>
                        {PARTICIPATION_LEVELS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {problem("session_participation")}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="faculty">Faculty present (optional)</Label>
                    <Input
                      id="faculty"
                      className="h-11"
                      maxLength={300}
                      value={field.other_faculty_present}
                      onChange={(e) => set("other_faculty_present")(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="faculty-count">How many (optional)</Label>
                    <Input
                      id="faculty-count"
                      className="h-11"
                      inputMode="numeric"
                      value={field.other_faculty_count}
                      onChange={(e) => digits("other_faculty_count", 3)(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="questions">
                    Questions students asked (optional)
                  </Label>
                  <Textarea
                    id="questions"
                    rows={3}
                    maxLength={2000}
                    value={field.student_questions}
                    onChange={(e) => set("student_questions")(e.target.value)}
                  />
                </div>
            </FormSection>
          )}

          {/* 4. Students ------------------------------------------------ */}
          <FormSection
            title="How did students respond?"
            description="Optional, and only worth answering if students were there."
          >
              <div className="space-y-2">
                <Label>Overall response (optional)</Label>
                <Select
                  value={field.student_response}
                  onValueChange={set("student_response")}
                >
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue placeholder="Choose one" />
                  </SelectTrigger>
                  <SelectContent>
                    {STUDENT_RESPONSES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Interest level (optional)</Label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((score) => (
                    <Button
                      key={score}
                      type="button"
                      variant={
                        field.student_interest === String(score) ? "default" : "outline"
                      }
                      className="h-11 flex-1"
                      onClick={() =>
                        set("student_interest")(
                          field.student_interest === String(score) ? "" : String(score),
                        )
                      }
                    >
                      {score}
                    </Button>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">1 is cold, 5 is keen.</p>
                {problem("student_interest")}
              </div>
          </FormSection>

          {/* 5. Management ---------------------------------------------- */}
          {showManagement && (
            <FormSection
              title="Management"
              description="Only asked because you ticked a management meeting above."
            >
                <div className="space-y-2">
                  <Label>Their response</Label>
                  {MANAGEMENT_RESPONSES.map((option) => (
                    <label
                      key={option}
                      className="flex min-h-11 items-center gap-3 text-sm"
                    >
                      <Checkbox
                        checked={managementResponse.includes(option)}
                        onCheckedChange={() =>
                          setManagementResponse(toggle(managementResponse, option))
                        }
                      />
                      {option}
                    </label>
                  ))}
                  {problem("management_response")}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mgmt-feedback">What did they say?</Label>
                  <Textarea
                    id="mgmt-feedback"
                    rows={3}
                    maxLength={2000}
                    value={field.management_feedback}
                    onChange={(e) => set("management_feedback")(e.target.value)}
                  />
                  {problem("management_feedback")}
                </div>
            </FormSection>
          )}

          {/* 6. Outcome ------------------------------------------------- */}
          <FormSection
            title="Outcome"
            description="What was discussed, how it ended, and whether anything is owed."
          >
              <div className="space-y-2">
                <Label htmlFor="summary">What was discussed?</Label>
                <Textarea
                  id="summary"
                  rows={4}
                  maxLength={4000}
                  value={field.discussion_summary}
                  onChange={(e) => set("discussion_summary")(e.target.value)}
                  aria-invalid={fieldErrors.discussion_summary ? true : undefined}
                />
                {problem("discussion_summary")}
              </div>

              <div className="space-y-2">
                <Label>How did it end?</Label>
                <Select value={field.visit_outcome} onValueChange={set("visit_outcome")}>
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue placeholder="Choose an outcome" />
                  </SelectTrigger>
                  <SelectContent>
                    {VISIT_OUTCOMES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {problem("visit_outcome")}
              </div>

              {showApplications && (
                <div className="space-y-2">
                  <Label htmlFor="applications">Application forms collected</Label>
                  <Input
                    id="applications"
                    className="h-11"
                    inputMode="numeric"
                    value={field.applications_collected}
                    onChange={(e) => digits("applications_collected", 4)(e.target.value)}
                  />
                  {problem("applications_collected")}
                </div>
              )}

              {showAdmissions && (
                <div className="space-y-2">
                  <Label htmlFor="admissions">Admissions generated</Label>
                  <Input
                    id="admissions"
                    className="h-11"
                    inputMode="numeric"
                    value={field.admissions_generated}
                    onChange={(e) => digits("admissions_generated", 4)(e.target.value)}
                  />
                  {problem("admissions_generated")}
                </div>
              )}
          </FormSection>

          {/* 7. Follow-up ----------------------------------------------- */}
          <FormSection
            title="Anything to follow up?"
            description="Say yes only if something is actually owed — it becomes a date you will be held to."
          >
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={followUp ? "default" : "outline"}
                  className="h-11 flex-1"
                  onClick={() => setFollowUp(true)}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  variant={followUp ? "outline" : "default"}
                  className="h-11 flex-1"
                  onClick={() => setFollowUp(false)}
                >
                  No
                </Button>
              </div>

              {followUp && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="action">What needs doing?</Label>
                    <Input
                      id="action"
                      className="h-11"
                      maxLength={500}
                      value={field.follow_up_action}
                      onChange={(e) => set("follow_up_action")(e.target.value)}
                    />
                    {problem("follow_up_action")}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="follow-date">By when?</Label>
                    <Input
                      id="follow-date"
                      type="date"
                      className="h-11"
                      value={field.follow_up_date}
                      onChange={(e) => set("follow_up_date")(e.target.value)}
                    />
                    {problem("follow_up_date")}
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="remarks">Your own remarks (optional)</Label>
                <Textarea
                  id="remarks"
                  rows={3}
                  maxLength={2000}
                  value={field.employee_remarks}
                  onChange={(e) => set("employee_remarks")(e.target.value)}
                />
              </div>
          </FormSection>

          <Button
            type="button"
            className="h-11 w-full"
            onClick={(event) => handleReview(event.currentTarget.form!)}
          >
            Review the report
          </Button>
        </>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* The review step                                                     */
/* ------------------------------------------------------------------ */

function Review({
  visit,
  people,
  activities,
  field,
  streams,
  managementResponse,
  followUp,
  isPending,
  onBack,
}: {
  visit: VisitReport;
  people: Person[];
  activities: string[];
  field: Record<string, string>;
  streams: string[];
  managementResponse: string[];
  followUp: boolean;
  isPending: boolean;
  onBack: () => void;
}) {
  const line = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="flex items-start justify-between gap-4 px-4 py-2.5">
        <dt className="text-muted-foreground shrink-0 text-sm">{label}</dt>
        <dd className="text-right text-sm font-medium break-words">{value}</dd>
      </div>
    ) : null;

  return (
    <>
      <FormSection
        title="Check this over"
        description="This is what will be filed against the visit."
      >
        <div className="border-border overflow-hidden rounded-lg border">
          <dl className="divide-border divide-y">
            {line("Visit", `${activityLabelFor(visit.activity)} · ${formatDate(visit.date)}`)}
            {line("Institute", visit.institute?.name)}
            {line(
              "Activities",
              <span className="flex flex-wrap justify-end gap-1.5">
                {activities.map((a) => (
                  <Badge key={a} variant="secondary">
                    {a}
                  </Badge>
                ))}
              </span>,
            )}
            {line(
              "People met",
              `${people.length} · ${people.map((p) => p.name).filter(Boolean).join(", ")}`,
            )}
            {line(
              "Decision makers",
              people.filter((p) => p.is_decision_maker).map((p) => p.name).join(", ") || null,
            )}
            {hasSession(activities) &&
              line(
                "Session",
                [
                  field.session_topic,
                  field.session_class && `class ${field.session_class}`,
                  streams.length ? streams.join(", ") : null,
                  field.students_attended && `${field.students_attended} students`,
                  field.session_participation && `${field.session_participation} participation`,
                ]
                  .filter(Boolean)
                  .join(" · "),
              )}
            {line("Student response", field.student_response)}
            {line("Interest", field.student_interest ? `${field.student_interest} / 5` : null)}
            {hasManagement(activities) &&
              line("Management", managementResponse.join(", "))}
            {line("Outcome", field.visit_outcome)}
            {line("Applications", field.applications_collected)}
            {line("Admissions", field.admissions_generated)}
            {line(
              "Follow-up",
              followUp
                ? `${field.follow_up_action} — by ${field.follow_up_date}`
                : "None",
            )}
            {line(
              "Evidence",
              visit.photo ? (
                <span className="flex justify-end">
                  <VisitPhotoThumb
                    photo={visit.photo}
                    caption={`${activityLabelFor(visit.activity)} on ${formatDate(visit.date)}`}
                  />
                </span>
              ) : (
                "No photo"
              ),
            )}
          </dl>
        </div>

        <div className="bg-secondary/50 rounded-lg p-4">
          <p className="text-muted-foreground text-[11px] font-medium tracking-wide">
            Summary
          </p>
          <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap">
            {field.discussion_summary}
          </p>
        </div>
      </FormSection>

      <p className="bg-warning-subtle text-warning-subtle-foreground flex items-start gap-2 rounded-md px-3 py-2 text-sm">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Submitting files this report and
          {visit.lifecycle_status === "Set" ? " marks the visit done." : " closes it off."}
        </span>
      </p>

      <div className={cn("flex gap-2")}>
        <Button type="submit" className="h-11 flex-1" disabled={isPending}>
          <CheckCircle2Icon className="size-4" aria-hidden />
          {isPending ? "Filing…" : "Submit and complete"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={onBack}
          disabled={isPending}
        >
          <PencilIcon className="size-4" aria-hidden />
          Edit
        </Button>
      </div>
    </>
  );
}

/** Exported for the empty state on the Pending screen. */
export function AddReportHint() {
  return (
    <p className="text-muted-foreground text-xs">
      <PlusIcon className="mr-1 inline size-3" aria-hidden />
      Closing reports are filed from here.
    </p>
  );
}
