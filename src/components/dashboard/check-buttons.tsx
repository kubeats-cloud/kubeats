"use client";

import { useActionState, useState } from "react";
import { LogInIcon, MapPinOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkIn } from "@/lib/checkin-actions";
import { EMPTY_STATE } from "@/lib/visit-form-state";
import { bestFix } from "@/lib/geolocate";
import { formatCoordinates } from "@/lib/location-display";
import { NO_LOCATION_GUIDANCE } from "@/lib/validation/checkin";
import {
  ACCURACY_BADGE,
  accuracyBand,
  describeAccuracy,
  shouldRetryLocation,
  type LocationFix,
} from "@/lib/validation/location";

/**
 * Arriving at a planned visit.
 *
 * THE LOCATION NOW BLOCKS — and this is the one screen in the app where it
 * does. Through stage 2 a check-in saved with or without a position; stage 3
 * reverses that (docs/stage3-plan.md, #6) because a visit record whose location
 * is optional is a visit record that cannot be relied on.
 *
 * What it does NOT do is strand anybody. A rep who genuinely cannot get a fix —
 * a basement staff room, a dead GPS, a denied permission — types why, and goes
 * in flagged. That is the difference between a blocked flow and a broken one,
 * and it is why this is an override rather than a wall: the check-in still
 * happens, it just stops pretending it was located.
 *
 * There is no Check out button here any more, and no "close without check-out"
 * either. Submitting the feedback form checks the rep out, and a visit nobody
 * can finish is swept up overnight — see checkin-actions.ts.
 *
 * The location goes in hidden fields rather than being read inside the action,
 * because a server action has no device to ask.
 */

type Phase =
  | { step: "idle" }
  | { step: "locating" }
  | { step: "located"; fix: LocationFix }
  | { step: "failed" };

export function CheckInButton({
  planId,
  instituteName,
  blockedBy,
}: {
  planId: string;
  instituteName: string;
  /** #7 — the institute already holding this rep, when there is one. */
  blockedBy?: string | null;
}) {
  const [state, formAction, isPending] = useActionState(checkIn, EMPTY_STATE);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [reason, setReason] = useState("");
  const [overriding, setOverriding] = useState(false);

  // #7, said before the tap rather than after. The trigger and the unique index
  // both refuse it anyway; this is so the rep is not sent looking for a reason.
  if (blockedBy) {
    return (
      <p className="text-muted-foreground max-w-56 text-right text-xs">
        Finish your visit at <span className="font-medium">{blockedBy}</span>{" "}
        before checking in here.
      </p>
    );
  }

  async function locate() {
    setPhase({ step: "locating" });
    const result = await bestFix();
    setPhase(result.fix ? { step: "located", fix: result.fix } : { step: "failed" });
  }

  if (phase.step === "idle") {
    return (
      <Button type="button" className="h-11" onClick={locate}>
        <LogInIcon className="size-4" aria-hidden />
        Check in
      </Button>
    );
  }

  if (phase.step === "locating") {
    return (
      <Button type="button" className="h-11" disabled>
        <LogInIcon className="size-4" aria-hidden />
        Finding you…
      </Button>
    );
  }

  // ------------------------------------------------------------------
  // Located: confirm, with the fix shown so a bad one can be retried.
  // ------------------------------------------------------------------
  if (phase.step === "located") {
    const { fix } = phase;
    return (
      <form action={formAction} className="flex flex-col items-end gap-1">
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="latitude" value={String(fix.latitude)} />
        <input type="hidden" name="longitude" value={String(fix.longitude)} />
        <input
          type="hidden"
          name="accuracy"
          value={fix.accuracy != null ? String(fix.accuracy) : ""}
        />
        <input type="hidden" name="manual_reason" value="" />

        <Button
          type="submit"
          className="h-11"
          disabled={isPending}
          aria-label={`Confirm check in at ${instituteName}`}
        >
          <LogInIcon className="size-4" aria-hidden />
          {isPending ? "Checking in…" : "Confirm check in"}
        </Button>

        <div className="flex max-w-56 flex-col items-end gap-1">
          <span className="text-muted-foreground text-right text-xs tabular-nums">
            {formatCoordinates(fix.latitude, fix.longitude)}
          </span>
          <Badge variant={ACCURACY_BADGE[accuracyBand(fix.accuracy)]}>
            {describeAccuracy(fix.accuracy)}
          </Badge>
          {/* A poor fix warns and offers another go; it does NOT block. Blocking
              on accuracy would strand a rep in a staff room indefinitely, and
              with one-visit-at-a-time that would end their day. */}
          {shouldRetryLocation(fix.accuracy) && (
            <p className="text-muted-foreground text-right text-xs">
              {accuracyBand(fix.accuracy) === "network"
                ? "Looks like a network location rather than GPS."
                : "Only approximate."}{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={locate}
              >
                Try again
              </button>
            </p>
          )}
        </div>
        {state.error && (
          <p role="alert" className="text-danger-subtle-foreground text-xs">
            {state.error}
          </p>
        )}
      </form>
    );
  }

  // ------------------------------------------------------------------
  // Failed: retry, or say why and go in flagged.
  // ------------------------------------------------------------------
  return (
    <div className="flex max-w-64 flex-col items-end gap-2">
      <p
        role="status"
        className="bg-warning-subtle text-warning-subtle-foreground rounded-md px-3 py-2 text-right text-xs"
      >
        {NO_LOCATION_GUIDANCE}
      </p>

      <Button type="button" className="h-11" onClick={locate}>
        <LogInIcon className="size-4" aria-hidden />
        Try again
      </Button>

      {!overriding ? (
        <Button
          type="button"
          variant="ghost"
          className="h-9"
          onClick={() => setOverriding(true)}
        >
          <MapPinOffIcon className="size-4" aria-hidden />
          Check in without location
        </Button>
      ) : (
        <form action={formAction} className="w-full space-y-2">
          <input type="hidden" name="plan_id" value={planId} />
          <input type="hidden" name="latitude" value="" />
          <input type="hidden" name="longitude" value="" />
          <input type="hidden" name="accuracy" value="" />

          <div className="space-y-1.5">
            <Label htmlFor={`reason-${planId}`} className="text-xs">
              Why is there no location?
            </Label>
            <Input
              id={`reason-${planId}`}
              name="manual_reason"
              className="h-11"
              maxLength={300}
              required
              placeholder="No signal indoors"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            {/* Said plainly. A rep who knows this is recorded is far less
                likely to use it as the quick way past the location. */}
            <p className="text-muted-foreground text-xs">
              This is saved with the visit and your admin can see it.
            </p>
          </div>

          <Button
            type="submit"
            variant="outline"
            className="h-11 w-full"
            disabled={isPending || reason.trim() === ""}
          >
            {isPending ? "Checking in…" : "Check in without location"}
          </Button>
        </form>
      )}

      {state.error && (
        <p role="alert" className="text-danger-subtle-foreground text-xs">
          {state.error}
        </p>
      )}
    </div>
  );
}
