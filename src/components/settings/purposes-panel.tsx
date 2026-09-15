"use client";

import { useActionState, useState } from "react";
import { PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { EmptyState } from "@/components/states";
import { RemoveButton } from "@/components/settings/remove-button";
import { addPurpose } from "@/lib/admin-actions";
import { EMPTY_ADMIN_STATE, type AdminState } from "@/lib/admin-form-state";
import { fieldErrorsFrom, purposeSchema } from "@/lib/validation/admin";
import { ACTIVITIES, activityLabelFor } from "@/lib/validation/visit";
import type { PurposeRow } from "@/lib/admin";
import { CHECK_FIELD, FormNotice } from "@/components/form-notice";

/**
 * The purposes a rep picks from when planning today's visits — and, as of
 * stage 2, what each one COUNTS AS.
 *
 * THE ACTIVITY IS THE POINT OF THIS SCREEN NOW. A purpose is what a rep plans
 * under; from stage 3 it is also what decides the visit's `activity`, and seven
 * of the eight weekly metrics are counted by that. So an admin adding a purpose
 * here is deciding which number on the Targets screen that work will land in,
 * which is why the picker is required and starts EMPTY rather than defaulting
 * to Meeting.
 *
 * The activity vocabulary itself is fixed at six and is deliberately NOT
 * admin-managed: a seventh would be a metric with no column on `public.targets`
 * and no row on the Targets screen — invisible in every total, which is worse
 * than not existing. Purposes are the layer that may grow; activities are not.
 *
 * Removing a purpose does not touch the daily_plans that already used it —
 * purpose is stored on the plan as text, so history keeps the wording it was
 * recorded under even after the option is retired.
 */
export function PurposesPanel({ purposes }: { purposes: PurposeRow[] }) {
  const [serverState, formAction, isPending] = useActionState(
    addPurpose,
    EMPTY_ADMIN_STATE,
  );
  const [clientState, setClientState] = useState<AdminState>(EMPTY_ADMIN_STATE);
  const [label, setLabel] = useState("");
  const [activity, setActivity] = useState("");

  const error = serverState.error ?? clientState.error;
  const shown = serverState.error ? serverState : clientState;
  const labelError = shown.fieldErrors.label;
  const activityError = shown.fieldErrors.activity;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const parsed = purposeSchema.safeParse({ label, activity });
    if (!parsed.success) {
      event.preventDefault();
      setClientState({
        error: CHECK_FIELD,
        fieldErrors: fieldErrorsFrom(parsed.error),
      });
      return;
    }
    setClientState(EMPTY_ADMIN_STATE);
    setLabel("");
    setActivity("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Meeting purposes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {purposes.length === 0 ? (
          <EmptyState
            title="No purposes yet"
            description="Reps choose from this list when they plan a visit, so add at least one."
          />
        ) : (
          <ul className="space-y-2">
            {purposes.map((purpose) => (
              <li
                key={purpose.id}
                className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {purpose.label}
                </span>
                {/* What this purpose counts as. "Not set" is only reachable on
                    a database where migration 0024 has not been applied — the
                    column is NOT NULL once it has, so this is a deploy-order
                    warning rather than a state an admin can create. */}
                <Badge variant={purpose.activity ? "secondary" : "danger"}>
                  {purpose.activity ? activityLabelFor(purpose.activity) : "Not set"}
                </Badge>
                <RemoveButton kind="purpose" id={purpose.id} name={purpose.label} />
              </li>
            ))}
          </ul>
        )}

        {/*
          LEFT ON `action={formAction}` DELIBERATELY, like daily-plan and
          assign-visit and unlike the five forms that were moved to a manual
          dispatch. React resets a form after its action runs, and a Radix
          Select reverts to its MOUNT value when it does — log-visit-form.tsx
          carries the full chain. What made that dangerous there was reverting
          to a value that is VALID and WRONG: it submits happily and says
          nothing.

          The Activity picker below mounts EMPTY, so a revert is a revert to
          nothing, and `purposeSchema` refuses an empty activity with a
          sentence. It fails loudly. Clearing both controls after a successful
          add is the wanted behaviour and is done in handleSubmit above.

          Empty is also right on its own merits: this choice decides which
          weekly metric the purpose feeds, and a picker pre-set to "Meeting"
          would let an admin add a session purpose that silently counts as a
          meeting for ever.
        */}
        <form action={formAction} onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="purpose-label">Add a purpose</Label>
            <Input
              id="purpose-label"
              name="label"
              className="h-11"
              maxLength={120}
              placeholder="e.g. Follow up on proposal"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              aria-invalid={labelError ? true : undefined}
            />
            {labelError && <p className="text-danger text-xs">{labelError}</p>}
          </div>

          <div className="space-y-2">
            <Label>What does it count as?</Label>
            <input type="hidden" name="activity" value={activity} />
            <Select value={activity} onValueChange={setActivity}>
              <SelectTrigger
                className="h-11 w-full"
                aria-label="What does it count as?"
                aria-invalid={activityError ? true : undefined}
              >
                <SelectValue placeholder="Choose an activity" />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITIES.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Decides which weekly metric a visit planned under this purpose
              counts toward.
            </p>
            {activityError && <p className="text-danger text-xs">{activityError}</p>}
          </div>

          <Button type="submit" className="h-11 w-full" disabled={isPending}>
            <PlusIcon className="size-4" aria-hidden />
            Add
          </Button>

          {error && <FormNotice message={error} />}
          {serverState.ok && serverState.message && (
            <p
              role="status"
              className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
            >
              {serverState.message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
