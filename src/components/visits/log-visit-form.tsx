"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { CaptureFields } from "@/components/visits/capture-fields";
import { createVisit } from "@/lib/visit-actions";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import type { PickerInstitute, PlanEntry } from "@/lib/visits";
import { INSTITUTE_STATUSES } from "@/lib/validation/institute";
import {
  ACTIVITIES,
  followUpHidden,
  followUpRequired,
  hasLifecycle,
  visitFieldErrors,
  visitFormDataToInput,
  visitSchema,
} from "@/lib/validation/visit";
import { cn } from "@/lib/utils";

const NO_CHANGE = "__no_change__";

export function LogVisitForm({
  userId,
  institutes,
  openPlan,
  initialPlanId,
}: {
  userId: string;
  institutes: PickerInstitute[];
  /** Today's plan entries not yet marked held — the only meetings allowed. */
  openPlan: PlanEntry[];
  initialPlanId?: string;
}) {
  const [serverState, formAction, isPending] = useActionState(
    createVisit,
    EMPTY_STATE,
  );
  const [clientState, setClientState] = useState<FormState>(EMPTY_STATE);

  const [activity, setActivity] = useState("meeting");
  const [planId, setPlanId] = useState(initialPlanId ?? "");
  const [instituteId, setInstituteId] = useState("");
  const [lifecycleStatus, setLifecycleStatus] = useState("Done");
  const [expectedDate, setExpectedDate] = useState("");
  const [statusSetTo, setStatusSetTo] = useState(NO_CHANGE);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");

  const lifecycle = hasLifecycle(activity);
  const isMeeting = activity === "meeting";
  const selectedPlan = openPlan.find((entry) => entry.id === planId);

  // A meeting's institute is whichever plan row was picked — never free-form.
  const effectiveInstituteId = isMeeting
    ? (selectedPlan?.institute_id ?? "")
    : instituteId;

  const status = statusSetTo === NO_CHANGE ? null : statusSetTo;
  const hideFollowUp = followUpHidden(status);
  const needFollowUp = followUpRequired(status);

  const error = serverState.error ?? clientState.error;
  const fieldErrors = serverState.error
    ? serverState.fieldErrors
    : clientState.fieldErrors;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const parsed = visitSchema.safeParse(
      visitFormDataToInput(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      event.preventDefault();
      setClientState({
        error: "Please check the highlighted fields.",
        fieldErrors: visitFieldErrors(parsed.error),
      });
      return;
    }
    setClientState(EMPTY_STATE);
  }

  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <p className="text-danger text-xs">{fieldErrors[key]}</p>
    ) : null;

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="activity" value={activity} />
      <input type="hidden" name="institute_id" value={effectiveInstituteId} />
      <input
        type="hidden"
        name="daily_plan_id"
        value={isMeeting ? planId : ""}
      />
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
      <input type="hidden" name="status_set_to" value={status ?? ""} />
      <input
        type="hidden"
        name="follow_up_date"
        value={hideFollowUp ? "" : followUpDate}
      />
      <input
        type="hidden"
        name="follow_up_time"
        value={hideFollowUp ? "" : followUpTime}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What happened?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Activity</Label>
            <Select
              value={activity}
              onValueChange={(value) => {
                setActivity(value);
                // Each activity has its own shape; carrying selections across
                // them is how you end up submitting a stale institute.
                setPlanId("");
                setInstituteId("");
                setLifecycleStatus("Done");
                setExpectedDate("");
              }}
            >
              <SelectTrigger className="h-11 w-full">
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
          </div>

          {/* Rule 2 — the gate. Meetings come only from today's plan. */}
          {isMeeting ? (
            <div className="space-y-2">
              <Label>Open for today</Label>
              {openPlan.length === 0 ? (
                <div className="border-border rounded-md border border-dashed px-4 py-6 text-center">
                  <p className="text-sm font-medium">Nothing open today</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    A meeting can only be logged for an institute on today&rsquo;s
                    plan.
                  </p>
                  <Button asChild variant="outline" className="mt-3 h-11">
                    <Link href="/">Add one on the Dashboard</Link>
                  </Button>
                </div>
              ) : (
                <ul className="space-y-2">
                  {openPlan.map((entry) => {
                    const selected = entry.id === planId;
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => setPlanId(entry.id)}
                          aria-pressed={selected}
                          className={cn(
                            "min-h-11 w-full rounded-md border px-3 py-2 text-left transition-colors",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card hover:bg-accent",
                          )}
                        >
                          <span className="block text-sm font-medium">
                            {entry.instituteName}
                          </span>
                          <span
                            className={cn(
                              "block text-xs",
                              selected
                                ? "text-primary-foreground/80"
                                : "text-muted-foreground",
                            )}
                          >
                            {entry.purpose}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {fieldError("daily_plan_id")}
              {fieldError("institute_id")}
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Institute</Label>
              <Select value={instituteId} onValueChange={setInstituteId}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Select an institute" />
                </SelectTrigger>
                <SelectContent>
                  {institutes.map((institute) => (
                    <SelectItem key={institute.id} value={institute.id}>
                      {institute.name}
                      {institute.city ? ` · ${institute.city}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {institutes.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  No institutes registered yet — add one first.
                </p>
              )}
              {fieldError("institute_id")}
            </div>
          )}

          {/* Rule 3 — Set -> Done, independent of the plan. */}
          {lifecycle && (
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={lifecycleStatus} onValueChange={setLifecycleStatus}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Set">Set — scheduled, closes later</SelectItem>
                  <SelectItem value="Done">Done — it already happened</SelectItem>
                </SelectContent>
              </Select>
              {fieldError("lifecycle_status")}
            </div>
          )}

          {lifecycle && lifecycleStatus === "Set" && (
            <div className="space-y-2">
              <Label htmlFor="expected-date">Expected date</Label>
              <Input
                id="expected-date"
                type="date"
                className="h-11"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.target.value)}
              />
              {fieldError("expected_date")}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proof</CardTitle>
        </CardHeader>
        <CardContent>
          <CaptureFields userId={userId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes and status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={3} maxLength={2000} />
            {fieldError("notes")}
          </div>

          {/* Rule 4 — always chosen by hand, never derived from the activity. */}
          <div className="space-y-2">
            <Label>Update institute status</Label>
            <Select value={statusSetTo} onValueChange={setStatusSetTo}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CHANGE}>No change</SelectItem>
                {INSTITUTE_STATUSES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldError("status_set_to")}
          </div>

          {/* Rule 5 — hidden for the two "scheduled" statuses, required for
              approval, optional otherwise. Mirrors the CHECK constraints, so
              the rep is never surprised by one. */}
          {hideFollowUp ? (
            <p className="text-muted-foreground text-xs">
              No separate follow-up needed — the expected date above already
              covers this.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="follow-up-date">
                  Follow-up date {needFollowUp ? "(required)" : "(optional)"}
                </Label>
                <Input
                  id="follow-up-date"
                  type="date"
                  className="h-11"
                  value={followUpDate}
                  onChange={(event) => setFollowUpDate(event.target.value)}
                  aria-invalid={fieldErrors.follow_up_date ? true : undefined}
                />
                {fieldError("follow_up_date")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="follow-up-time">Follow-up time (optional)</Label>
                <Input
                  id="follow-up-time"
                  type="time"
                  className="h-11"
                  value={followUpTime}
                  onChange={(event) => setFollowUpTime(event.target.value)}
                />
                {fieldError("follow_up_time")}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
                  <span className="font-medium">{field.replace(/_/g, " ")}</span>
                  : {message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button type="submit" className="h-11 w-full" disabled={isPending}>
        {isPending ? "Saving…" : "Save visit"}
      </Button>
    </form>
  );
}
