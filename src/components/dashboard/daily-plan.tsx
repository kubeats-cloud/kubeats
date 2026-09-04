"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2Icon, PlusIcon, XIcon } from "lucide-react";
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
import { addToDailyPlan, removeFromDailyPlan } from "@/lib/visit-actions";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import type { PickerInstitute, PlanEntry } from "@/lib/visits";
import {
  dailyPlanFormDataToInput,
  dailyPlanSchema,
  visitFieldErrors,
} from "@/lib/validation/visit";

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

  const error = state.error ?? clientState.error;
  const held = entries.filter((entry) => entry.meetings_actual !== null);
  const open = entries.filter((entry) => entry.meetings_actual === null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const parsed = dailyPlanSchema.safeParse(
      dailyPlanFormDataToInput(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      event.preventDefault();
      setClientState({
        error: "Pick an institute and a purpose.",
        fieldErrors: visitFieldErrors(parsed.error),
      });
      return;
    }
    setClientState(EMPTY_STATE);
    // The row is upserted, so re-planning the same institute just corrects the
    // purpose. Clearing the picker afterwards keeps the next entry quick.
    setInstituteId("");
    setPurpose("");
  }

  const canAdd = institutes.length > 0 && purposes.length > 0;

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

            <Select value={instituteId} onValueChange={setInstituteId}>
              <SelectTrigger className="h-11 w-full" aria-label="Institute">
                <SelectValue placeholder="Institute" />
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

            <Select value={purpose} onValueChange={setPurpose}>
              <SelectTrigger className="h-11 w-full" aria-label="Purpose">
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
              : "No meeting purposes have been set up yet — ask an admin to add some."}
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
                <div className="flex shrink-0 items-center gap-1">
                  <Button asChild className="h-11">
                    <Link href={`/log?plan=${entry.id}`}>Log</Link>
                  </Button>
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
                <Badge variant="success" className="shrink-0">
                  <CheckCircle2Icon className="size-3" aria-hidden />
                  Held
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
