"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2Icon, MapPinOffIcon, PlusIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/states";
import { CheckInButton } from "@/components/dashboard/check-buttons";
import { addToDailyPlan, removeFromDailyPlan } from "@/lib/visit-actions";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import type { PickerInstitute, PlanEntry } from "@/lib/visits";
import {
  dailyPlanFormDataToInput,
  dailyPlanSchema,
  dailyPlanSummary,
  visitFieldErrors,
} from "@/lib/validation/visit";
import {
  institutePickerLabel,
  reopeningInstitute,
} from "@/lib/validation/institute";
import {
  formatDuration,
  visitMinutes,
  visitStatusOf,
} from "@/lib/validation/checkin";

/**
 * Today's plan, which the Dashboard owns (see CLAUDE.md).
 *
 * This is not a convenience list. The meeting gate checks a visit against these
 * rows, so an institute that never gets planned here can never have a meeting
 * logged against it at all.
 */
export function DailyPlan({
  institutes,
  purposes,
  entries,
}: {
  institutes: PickerInstitute[];
  purposes: string[];
  entries: PlanEntry[];
}) {
  const [state, formAction, isPending] = useActionState(
    addToDailyPlan,
    EMPTY_STATE,
  );
  const [clientState, setClientState] = useState<FormState>(EMPTY_STATE);
  const [instituteId, setInstituteId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [removing, startRemoving] = useTransition();

  // One attempt is being explained at a time, and the summary has to come from
  // the same attempt as the inline messages under the fields. Reading
  // `state.error ?? clientState.error` across two objects can pair a server
  // summary with stale client field errors, which is how a form starts
  // contradicting itself.
  const shown = state.error ? state : clientState;

  // A complaint about a field the rep has since answered is worse than no
  // complaint at all — it marks a filled-in field red and makes them press the
  // button again just to learn they had already fixed it. So a field-level
  // message lives exactly as long as the field is still empty, whether the
  // complaint came from the check below or from the server, and the summary is
  // recomputed from whatever is genuinely still missing. Errors that belong to
  // no field — an expired session, a database that would not take the row —
  // pass through untouched, because nothing the rep types clears those.
  const answered: Record<string, boolean> = {
    institute_id: instituteId !== "",
    purpose: purpose !== "",
  };
  const fieldErrors = Object.fromEntries(
    Object.entries(shown.fieldErrors).filter(([key]) => !answered[key]),
  );
  const stillMissing = Object.keys(fieldErrors).length;
  const error = Object.keys(shown.fieldErrors).length
    ? stillMissing
      ? dailyPlanSummary(fieldErrors)
      : null
    : shown.error;
  const held = entries.filter((entry) => entry.meetings_actual !== null);
  const open = entries.filter((entry) => entry.meetings_actual === null);

  // #7 — one active visit at a time. Whichever entry is checked in and not yet
  // checked out is holding this rep; every other Check in button says so
  // instead of offering a tap the database would refuse (FO013).
  const openElsewhere =
    entries.find(
      (entry) =>
        visitStatusOf({
          checkinAt: entry.checkinAt,
          checkoutAt: entry.checkoutAt,
          checkoutMissing: entry.checkoutMissing,
        }) === "In Progress",
    ) ?? null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const parsed = dailyPlanSchema.safeParse(
      dailyPlanFormDataToInput(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      // Stops the server action as well: React skips a form action when the
      // submit event has been prevented. Nothing is added, and now the rep is
      // told why rather than watching the button do nothing.
      event.preventDefault();
      const problems = visitFieldErrors(parsed.error);
      setClientState({ error: dailyPlanSummary(problems), fieldErrors: problems });
      return;
    }
    setClientState(EMPTY_STATE);
    // The row is upserted, so re-planning the same institute just corrects the
    // purpose. Clearing the picker afterwards keeps the next entry quick.
    setInstituteId("");
    setPurpose("");
  }

  const canAdd = institutes.length > 0 && purposes.length > 0;

  // Non-null only when the selected institute's loop is already finished —
  // the one case worth saying something about before the rep hits Add.
  const reopening = reopeningInstitute(institutes, instituteId);

  return (
    <Card>
      <CardHeader>
        {/* The held/planned counts live in the snapshot tiles above; repeating
            them here would only give them a chance to disagree. */}
        <CardTitle className="text-base">Today&rsquo;s plan</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {canAdd ? (
          <form action={formAction} onSubmit={handleSubmit} className="space-y-3">
            <input type="hidden" name="institute_id" value={instituteId} />
            <input type="hidden" name="purpose" value={purpose} />

            <div className="space-y-1.5">
              <Select value={instituteId} onValueChange={setInstituteId}>
                <SelectTrigger
                  className="h-11 w-full"
                  aria-label="Institute"
                  aria-invalid={fieldErrors.institute_id ? true : undefined}
                  aria-describedby={
                    fieldErrors.institute_id ? "plan-institute-error" : undefined
                  }
                >
                  <SelectValue placeholder="Institute" />
                </SelectTrigger>
                <SelectContent>
                  {institutes.map((institute) => (
                    <SelectItem key={institute.id} value={institute.id}>
                      {institutePickerLabel(institute)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="plan-institute-error" message={fieldErrors.institute_id} />
            </div>

            {/* Re-adding a closed institute is how a new cycle of engagement
                starts. It was always allowed; this says so out loud, and says
                what it does NOT do — planning never moves a status (rule 4). */}
            {reopening && (
              <p className="bg-warning-subtle text-warning-subtle-foreground rounded-md px-3 py-2 text-xs">
                <span className="font-medium">{reopening.name}</span> is closed
                &mdash; {reopening.status}. Adding it starts a fresh cycle. Its
                status stays as it is until your next visit changes it.
              </p>
            )}

            <div className="space-y-1.5">
              <Select value={purpose} onValueChange={setPurpose}>
                <SelectTrigger
                  className="h-11 w-full"
                  aria-label="Purpose"
                  aria-invalid={fieldErrors.purpose ? true : undefined}
                  aria-describedby={
                    fieldErrors.purpose ? "plan-purpose-error" : undefined
                  }
                >
                  <SelectValue placeholder="Purpose of the visit" />
                </SelectTrigger>
                <SelectContent>
                  {purposes.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="plan-purpose-error" message={fieldErrors.purpose} />
            </div>

            <Button type="submit" className="h-11 w-full" disabled={isPending}>
              <PlusIcon className="size-4" aria-hidden />
              {isPending ? "Adding…" : "Add to today's plan"}
            </Button>

            {error && (
              <p
                role="alert"
                className="bg-danger-subtle text-danger-subtle-foreground rounded-md px-3 py-2 text-sm"
              >
                {error}
              </p>
            )}
          </form>
        ) : (
          <p className="bg-warning-subtle text-warning-subtle-foreground rounded-md px-3 py-2 text-sm">
            {institutes.length === 0
              ? "Register an institute before planning a visit."
              : "No meeting purposes have been set up yet. Ask an admin to add some."}
          </p>
        )}

        {entries.length === 0 ? (
          <EmptyState
            title="Nothing planned yet today"
            description="Add the institutes you intend to visit. A meeting can only be logged for one that is on this list."
          />
        ) : (
          <ul className="space-y-2">
            {open.map((entry) => (
              <li
                key={entry.id}
                className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {entry.instituteName}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {entry.purpose}
                  </p>
                  {entry.assignedBy && (
                    <Badge variant="neutral" className="mt-1">
                      Assigned by {entry.assignedByName ?? "an admin"}
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {/* The presence guarantee, in the order it happens: check in,
                      then log, then check out. Log is not offered before
                      check-in because the database would refuse it anyway
                      (FO009) — better to not present a button that cannot work
                      than to explain the refusal afterwards. */}
                  {visitStatusOf({
                    checkinAt: entry.checkinAt,
                    checkoutAt: entry.checkoutAt,
                    checkoutMissing: entry.checkoutMissing,
                  }) === "Scheduled" ? (
                    <CheckInButton
                      planId={entry.id}
                      instituteName={entry.instituteName}
                      blockedBy={
                        openElsewhere && openElsewhere.id !== entry.id
                          ? openElsewhere.instituteName
                          : null
                      }
                    />
                  ) : (
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1">
                        <Badge variant="warning">In progress</Badge>
                        {/* The whole recovery path, and the reason there is no
                            "abandon" button: a rep who was interrupted comes
                            back to the same visit and finishes it. */}
                        <Button asChild className="h-11">
                          <Link href={`/log?plan=${entry.id}`}>Continue</Link>
                        </Button>
                      </div>
                      {entry.checkinLocationManual && (
                        <Badge variant="warning">
                          <MapPinOffIcon className="size-3" aria-hidden />
                          No location
                        </Badge>
                      )}
                    </div>
                  )}
                  {/* An assignment is not the rep's to dismiss — it came from
                      an admin, and quietly deleting it would lose the ask. */}
                  {!entry.assignedBy && (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove ${entry.instituteName} from today's plan`}
                      className="size-11"
                      disabled={removing}
                      onClick={() =>
                        startRemoving(async () => {
                          await removeFromDailyPlan(entry.id);
                        })
                      }
                    >
                      <XIcon className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            ))}

            {held.map((entry) => (
              <li
                key={entry.id}
                className="border-border bg-muted/40 flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {entry.instituteName}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {entry.purpose}
                    {entry.assignedBy
                      ? ` · assigned by ${entry.assignedByName ?? "an admin"}`
                      : ""}
                  </p>
                </div>
                {/* Logged, so the closing report is done. What remains is
                    leaving — or, on a visit left open from an earlier day,
                    admitting the check-out is not coming. */}
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant="success">
                    <CheckCircle2Icon className="size-3" aria-hidden />
                    Held
                  </Badge>
                  {/* No check-out button. Filing the feedback checked them out
                      in the same transaction, so by the time an entry reads
                      "Held" the departure is already recorded. */}
                  {entry.checkoutAt && (
                    <span className="text-muted-foreground text-xs">
                      {formatDuration(
                        visitMinutes({
                          checkinAt: entry.checkinAt,
                          checkoutAt: entry.checkoutAt,
                          checkoutMissing: entry.checkoutMissing,
                        }),
                      )}{" "}
                      on site
                    </span>
                  )}
                  {entry.checkoutMissing && (
                    <span className="text-muted-foreground text-xs">
                      Closed, time not recorded
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-danger text-xs">
      {message}
    </p>
  );
}
