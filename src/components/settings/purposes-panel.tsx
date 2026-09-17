"use client";

import { useActionState, useState, useTransition } from "react";
import { PlusIcon, RotateCcwIcon } from "lucide-react";
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
import { addPurpose, setPurposeActive } from "@/lib/admin-actions";
import { EMPTY_ADMIN_STATE, type AdminState } from "@/lib/admin-form-state";
import {
  fieldErrorsFrom,
  PURPOSE_LIFECYCLES,
  purposeSchema,
} from "@/lib/validation/admin";
import {
  ACTIVITIES,
  activityLabelFor,
  hasLifecycle,
} from "@/lib/validation/visit";
import type { PurposeRow } from "@/lib/admin";
import { CHECK_FIELDS, FormNotice } from "@/components/form-notice";

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
 * AND FOR TWO OF THE SIX, WHICH END. "Fix a session" and "Complete a session"
 * are both the `session` activity; the lifecycle is the only thing that tells
 * Sessions Set from Sessions Done. It is asked below, and only for the two
 * activities `purposes_lifecycle_matches_activity` (0025) allows one on —
 * before it was asked at all, every session and campus-visit purpose an admin
 * tried to add was refused by that CHECK, which made four of the eight weekly
 * metrics impossible to feed with anything but the four seeded rows.
 *
 * REMOVAL IS RETIREMENT, and there is no second way — the same rule as the
 * status vocabulary beside it, for a sharper reason. This panel used to offer a
 * hard delete. Deleting the last purpose feeding a metric zeroes that metric
 * for ever and nothing says so: the week's numbers simply come in flat. It also
 * strands every plan that referenced it, because `daily_plans.purpose_id` is
 * where the activity is now derived from and the Activity selector that used to
 * be the fallback was deleted in stage 3. Retiring keeps the row readable and
 * merely stops offering it.
 */
export function PurposesPanel({ purposes }: { purposes: PurposeRow[] }) {
  const [serverState, formAction, isPending] = useActionState(
    addPurpose,
    EMPTY_ADMIN_STATE,
  );
  const [clientState, setClientState] = useState<AdminState>(EMPTY_ADMIN_STATE);
  const [label, setLabel] = useState("");
  const [activity, setActivity] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [retiring, startRetiring] = useTransition();

  /*
   * Which end of the metric — asked for exactly the activities that have one.
   *
   * The same question `purposeSchema` asks on the server and 0025's CHECK asks
   * in the database, so the control cannot appear where a value would be
   * refused, nor stay hidden where one is required.
   */
  const needsLifecycle = hasLifecycle(activity);

  const error = serverState.error ?? clientState.error;
  const shown = serverState.error ? serverState : clientState;
  const labelError = shown.fieldErrors.label;
  const activityError = shown.fieldErrors.activity;
  const lifecycleError = shown.fieldErrors.lifecycle;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Posted exactly as the hidden field posts it: empty unless this activity
    // may carry one. A lifecycle left over from a previous choice of activity
    // would be refused by the CHECK with nothing on screen to explain it.
    const parsed = purposeSchema.safeParse({
      label,
      activity,
      lifecycle: needsLifecycle ? lifecycle : "",
    });
    if (!parsed.success) {
      event.preventDefault();
      setClientState({
        error: CHECK_FIELDS,
        fieldErrors: fieldErrorsFrom(parsed.error),
      });
      return;
    }
    setClientState(EMPTY_ADMIN_STATE);
    setLabel("");
    setActivity("");
    setLifecycle("");
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
                className="border-border space-y-2 rounded-md border px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {purpose.label}
                  </span>
                  {/* What this purpose counts as. "Not set" is only reachable on
                      a database where migration 0024 has not been applied — the
                      column is NOT NULL once it has, so this is a deploy-order
                      warning rather than a state an admin can create. */}
                  <Badge variant={purpose.activity ? "secondary" : "danger"}>
                    {purpose.activity
                      ? activityLabelFor(purpose.activity)
                      : "Not set"}
                  </Badge>
                  {/* And which end of it. Only the two lifecycle activities
                      carry one, so most rows show nothing here. */}
                  {purpose.lifecycle && (
                    <Badge
                      variant={purpose.lifecycle === "Done" ? "success" : "warning"}
                    >
                      {purpose.lifecycle}
                    </Badge>
                  )}
                  {!purpose.isActive && <Badge variant="neutral">Retired</Badge>}
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  className="h-9"
                  disabled={retiring}
                  onClick={() =>
                    startRetiring(async () => {
                      await setPurposeActive(purpose.id, !purpose.isActive);
                    })
                  }
                >
                  {purpose.isActive ? (
                    "Retire"
                  ) : (
                    <>
                      <RotateCcwIcon className="size-4" aria-hidden />
                      Restore
                    </>
                  )}
                </Button>
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

          Both pickers below mount EMPTY, so a revert is a revert to nothing,
          and `purposeSchema` refuses an empty activity — and an empty lifecycle
          where one is required — with a sentence. It fails loudly. Clearing
          every control after a successful add is the wanted behaviour and is
          done in handleSubmit above.

          Empty is also right on its own merits: these two choices decide which
          weekly metric the purpose feeds and which END of it, and a picker
          pre-set to "Meeting" would let an admin add a session purpose that
          silently counts as a meeting for ever.
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
            <Select
              value={activity}
              onValueChange={(next) => {
                setActivity(next);
                // A lifecycle chosen under the previous activity must not
                // survive a change to one that may not carry it — 0025's CHECK
                // refuses that as firmly as it refuses a missing one.
                if (!hasLifecycle(next)) setLifecycle("");
              }}
            >
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

          {/* Posted unconditionally so the field is always present, and EMPTY
              unless this activity may carry one. The server normalises "" to
              null, which is what the four one-shot activities require. */}
          <input
            type="hidden"
            name="lifecycle"
            value={needsLifecycle ? lifecycle : ""}
          />

          {needsLifecycle && (
            <div className="space-y-2">
              <Label>Does it SET one, or COMPLETE one?</Label>
              <Select value={lifecycle} onValueChange={setLifecycle}>
                <SelectTrigger
                  className="h-11 w-full"
                  aria-label="Set or complete"
                  aria-invalid={lifecycleError ? true : undefined}
                >
                  <SelectValue placeholder="Choose Set or Done" />
                </SelectTrigger>
                <SelectContent>
                  {PURPOSE_LIFECYCLES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {LIFECYCLE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                “{activityLabelFor(activity)} Set” and “{activityLabelFor(activity)}{" "}
                Done” are two different weekly numbers, and this is what tells
                them apart.
              </p>
              {lifecycleError && (
                <p className="text-danger text-xs">{lifecycleError}</p>
              )}
            </div>
          )}

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

/**
 * What each end of a lifecycle means in the words a rep would use.
 *
 * "Set" and "Done" are the stored values and mean nothing to somebody who has
 * not read the schema, which is the same reasoning `plannedActivityLabel()`
 * applies on Log Visit.
 */
const LIFECYCLE_LABELS: Record<(typeof PURPOSE_LIFECYCLES)[number], string> = {
  Set: "Set — arranges one for a later day",
  Done: "Done — completes one held today",
};
