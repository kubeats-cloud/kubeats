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
import type { PickerInstitute } from "@/lib/visits";

/**
 * An admin putting a visit on a rep's plan.
 *
 * It writes an ordinary daily_plans row, so the assigned visit behaves like one
 * the rep added themselves: it satisfies the meeting gate, it can be logged,
 * and it closes with the same report. The rep sees who assigned it. Nothing
 * about the self-planning model changes — this is one more way a row gets
 * there.
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
  purposes: string[];
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
        error: "Please check the highlighted fields.",
        fieldErrors: visitFieldErrors(parsed.error),
      });
      return;
    }
    setClientState(EMPTY_STATE);
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
              <Select value={member} onValueChange={setMember}>
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
              <Select value={instituteId} onValueChange={setInstituteId}>
                <SelectTrigger className="h-11 w-full" aria-label="Institute">
                  <SelectValue placeholder="Choose an institute" />
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
                    <SelectItem key={option} value={option}>
                      {option}
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
              <p
                role="alert"
                className="bg-danger-subtle text-danger-subtle-foreground rounded-md px-3 py-2 text-sm"
              >
                {error}
              </p>
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
