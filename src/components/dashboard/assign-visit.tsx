"use client";

import { useActionState, useState } from "react";
import { SendIcon } from "lucide-react";
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
import { assignVisit } from "@/lib/visit-actions";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import { assignVisitSchema } from "@/lib/validation/closing-report";
import { visitFieldErrors } from "@/lib/validation/visit";
import type { PickerInstitute, PurposeOption } from "@/lib/visits";
import { CHECK_FIELDS, FormNotice } from "@/components/form-notice";

/**
 * An admin putting a visit on a rep's plan.
 *
 * It writes an ordinary daily_plans row, so the assigned visit behaves like one
 * the rep added themselves: it satisfies the meeting gate, it can be logged,
 * and it closes with the same report. The rep sees who assigned it. Nothing
 * about the self-planning model changes — this is one more way a row gets
 * there.
 *
 * THE INSTITUTE PICKER FOLLOWS THE REP, not the registry. An institute belongs
 * to one rep, and FO023 refuses a plan row pairing a rep with an institute that
 * is not theirs — so offering the whole registry here would be offering
 * assignments the database is going to refuse. Choosing the rep first and
 * narrowing to what they own turns that refusal into a list that is simply
 * shorter. The refusal still stands behind it; this only stops an admin walking
 * into it.
 */
export function AssignVisit({
  reps,
  institutes,
  purposes,
  today,
  alwaysOpen = false,
}: {
  reps: { id: string; name: string }[];
  institutes: PickerInstitute[];
  purposes: PurposeOption[];
  today: string;
  /** Skip the collapsed state — used where the form is the whole screen. */
  alwaysOpen?: boolean;
}) {
  const [serverState, formAction, isPending] = useActionState(
    assignVisit,
    EMPTY_STATE,
  );
  const [clientState, setClientState] = useState<FormState>(EMPTY_STATE);
  // On the dashboard this sits behind a button; on the Assign screen the form
  // is the point of the page, so it opens with it.
  const [open, setOpen] = useState(alwaysOpen);
  const [member, setMember] = useState("");
  const [instituteId, setInstituteId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [date, setDate] = useState(today);

  const error = serverState.error ?? clientState.error;
  const fieldErrors = serverState.error
    ? serverState.fieldErrors
    : clientState.fieldErrors;
  const problem = (key: string) =>
    fieldErrors[key] ? <p className="text-danger text-xs">{fieldErrors[key]}</p> : null;

  // Narrowed to the chosen rep. Before one is chosen there is no correct list,
  // so the picker says so rather than offering a registry-wide guess.
  const repInstitutes = member
    ? institutes.filter((institute) => institute.registered_by === member)
    : [];

  // Changing the rep invalidates the institute underneath it — the previous
  // choice belongs to the previous rep by construction.
  function chooseMember(next: string) {
    setMember(next);
    setInstituteId("");
  }

  const ready = reps.length > 0 && institutes.length > 0 && purposes.length > 0;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const parsed = assignVisitSchema.safeParse({
      member,
      institute_id: instituteId,
      purpose,
      date,
    });
    if (!parsed.success) {
      event.preventDefault();
      setClientState({
        error: CHECK_FIELDS,
        fieldErrors: visitFieldErrors(parsed.error),
      });
      return;
    }
    setClientState(EMPTY_STATE);
    // LEFT ON `action={formAction}` DELIBERATELY. Same reasoning as the daily
    // plan: `member` is the one Select not cleared here, and it mounts EMPTY,
    // so the revert Radix performs on React's post-action reset leaves it
    // empty and assignVisitSchema answers "Choose a rep." The admin loses a
    // selection and is told so; nothing is assigned to the wrong person.
    //
    // The institute and purpose are cleared on purpose anyway - an admin
    // assigning several visits in a row wants the next one blank - and `date`
    // is a plain input React re-syncs from state rather than a Radix control.
    setInstituteId("");
    setPurpose("");
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="mb-4 h-11 w-full"
        onClick={() => setOpen(true)}
      >
        <SendIcon className="size-4" aria-hidden />
        Assign a visit to a rep
      </Button>
    );
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">Assign a visit</CardTitle>
      </CardHeader>
      <CardContent>
        {!ready ? (
          <p className="bg-warning-subtle text-warning-subtle-foreground rounded-md px-3 py-2 text-sm">
            {institutes.length === 0
              ? "Register an institute first."
              : purposes.length === 0
                ? "Add a meeting purpose in Settings first."
                : "There is nobody to assign to yet."}
          </p>
        ) : (
          <form action={formAction} onSubmit={handleSubmit} className="space-y-3">
            <input type="hidden" name="member" value={member} />
            <input type="hidden" name="institute_id" value={instituteId} />
            <input type="hidden" name="purpose" value={purpose} />
            <input type="hidden" name="date" value={date} />

            <div className="space-y-2">
              <Label>Who</Label>
              <Select value={member} onValueChange={chooseMember}>
                <SelectTrigger className="h-11 w-full" aria-label="Rep">
                  <SelectValue placeholder="Choose a rep" />
                </SelectTrigger>
                <SelectContent>
                  {reps.map((rep) => (
                    <SelectItem key={rep.id} value={rep.id}>
                      {rep.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {problem("member")}
            </div>

            <div className="space-y-2">
              <Label>Institute</Label>
              <Select
                value={instituteId}
                onValueChange={setInstituteId}
                disabled={member === "" || repInstitutes.length === 0}
              >
                <SelectTrigger className="h-11 w-full" aria-label="Institute">
                  <SelectValue
                    placeholder={
                      member === ""
                        ? "Choose a rep first"
                        : "Choose one of their institutes"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {repInstitutes.map((institute) => (
                    <SelectItem key={institute.id} value={institute.id}>
                      {institute.name}
                      {institute.city ? ` · ${institute.city}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {member !== "" && repInstitutes.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  Nothing is registered to this rep yet. Reassign an institute to
                  them first, then assign the visit.
                </p>
              )}
              {problem("institute_id")}
            </div>

            <div className="space-y-2">
              <Label>Purpose</Label>
              <Select value={purpose} onValueChange={setPurpose}>
                <SelectTrigger className="h-11 w-full" aria-label="Purpose">
                  <SelectValue placeholder="Why are they going?" />
                </SelectTrigger>
                <SelectContent>
                  {purposes.map((option) => (
                    <SelectItem key={option.id} value={option.label}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {problem("purpose")}
            </div>

            <div className="space-y-2">
              <Label htmlFor="assign-date">When</Label>
              <Input
                id="assign-date"
                type="date"
                className="h-11"
                min={today}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
              {problem("date")}
            </div>

            {error && (
              <FormNotice message={error} />
            )}
            {serverState.ok && (
              <p
                role="status"
                className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
              >
                Assigned. It is on their plan for that day.
              </p>
            )}

            <div className="flex gap-2">
              <Button type="submit" className="h-11 flex-1" disabled={isPending}>
                {isPending ? "Assigning…" : "Assign"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Close
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
