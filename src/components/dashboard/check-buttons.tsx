"use client";

import { useActionState, useState } from "react";
import { LogInIcon, LogOutIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { checkIn, checkOut, closeWithoutCheckout } from "@/lib/checkin-actions";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import { bestFix, nameArea } from "@/lib/geolocate";
import { formatArea, formatCoordinates } from "@/lib/location-display";
import {
  ACCURACY_BADGE,
  accuracyBand,
  describeAccuracy,
  shouldRetryLocation,
  type LocationFix,
} from "@/lib/validation/location";

/**
 * Recording arrival and departure at a planned visit.
 *
 * THE LOCATION NEVER BLOCKS. The button asks the device for a fix, waits a few
 * seconds, and submits with or without one — a denied permission, a basement
 * staff room or a flat GPS still records the arrival. The timestamp is what the
 * presence guarantee rests on and it is stamped on the server; the coordinates
 * corroborate it when the phone can manage. This is the same judgement Rule 12
 * already makes for the visit photo, where the photo blocks and the geo-tag
 * deliberately does not.
 *
 * The coordinates go in hidden fields rather than being read inside the action,
 * because a server action has no device to ask.
 */

/**
 * The location comes from bestFix, which watches for a few seconds and keeps
 * the most accurate reading rather than taking the first one offered. A single
 * getCurrentPosition returns whatever arrives first, and on a phone that is
 * usually the Wi-Fi or cell fix rather than the satellite one — which is how a
 * visit in Ahmedabad was once recorded in Gandhinagar.
 *
 * It never rejects. A missing location must never be the reason a rep cannot
 * record that they arrived.
 */

function CheckButton({
  planId,
  instituteName,
  action,
  label,
  busyLabel,
  icon,
  variant = "default",
}: {
  planId: string;
  instituteName: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  busyLabel: string;
  icon: React.ReactNode;
  variant?: "default" | "outline";
}) {
  const [state, formAction, isPending] = useActionState(action, EMPTY_STATE);
  const [locating, setLocating] = useState(false);
  const [fix, setFix] = useState<LocationFix | null>(null);
  const [noGps, setNoGps] = useState(false);
  const [asked, setAsked] = useState(false);
  const [area, setArea] = useState<string | null>(null);
  const [areaPending, setAreaPending] = useState(false);

  // Two taps by design, and the first one is the honest part: it says what it
  // is doing while the device thinks, instead of appearing to hang.
  async function locate() {
    setLocating(true);
    setArea(null);
    const result = await bestFix();
    setFix(result.fix);
    setNoGps(result.unsupported);
    setAsked(true);
    setLocating(false);

    // Deliberately AFTER the button becomes usable, and never awaited by it.
    // The area name is a courtesy; a rep must be able to confirm arrival the
    // moment they have a position, not once a free geocoder has answered.
    if (result.fix) {
      setAreaPending(true);
      const label = await nameArea(result.fix.latitude, result.fix.longitude);
      setArea(label);
      setAreaPending(false);
    }
  }

  if (!asked) {
    return (
      <Button
        type="button"
        variant={variant}
        className="h-11"
        disabled={locating}
        onClick={locate}
      >
        {icon}
        {locating ? "Finding you…" : label}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="plan_id" value={planId} />
      <input
        type="hidden"
        name="latitude"
        value={fix ? String(fix.latitude) : ""}
      />
      <input
        type="hidden"
        name="longitude"
        value={fix ? String(fix.longitude) : ""}
      />
      <input
        type="hidden"
        name="accuracy"
        value={fix?.accuracy != null ? String(fix.accuracy) : ""}
      />
      {/* The institute names the BUTTON's target — several plan rows can each
          offer "Confirm check in", so a screen reader needs to tell them apart.
          It is the button's accessible name rather than loose text after the
          location, where it used to sit and could be read as the place the GPS
          had resolved to. */}
      <Button
        type="submit"
        variant={variant}
        className="h-11"
        disabled={isPending}
        aria-label={`Confirm ${label.toLowerCase()} at ${instituteName}`}
      >
        {icon}
        {isPending ? busyLabel : `Confirm ${label.toLowerCase()}`}
      </Button>

      {fix ? (
        <div className="flex max-w-56 flex-col items-end gap-1">
          {/* Where the phone is: exact coordinates, approximate area. The
              institute this visit is for is named on the plan row above and
              deliberately not repeated here — it is not evidence of position. */}
          <span className="text-muted-foreground text-right text-xs tabular-nums">
            {formatCoordinates(fix.latitude, fix.longitude)}
          </span>
          <span className="text-muted-foreground text-right text-xs">
            {areaPending ? "Naming the area…" : formatArea(area)}
          </span>
          <Badge variant={ACCURACY_BADGE[accuracyBand(fix.accuracy)]}>
            {describeAccuracy(fix.accuracy)}
          </Badge>
          {/* Warn and offer another go — never block. The timestamp is what the
              presence guarantee rests on, and it is stamped on the server. */}
          {shouldRetryLocation(fix.accuracy) && (
            <p className="text-muted-foreground text-right text-xs">
              {accuracyBand(fix.accuracy) === "network"
                ? "Looks like a network location, not GPS. Step outside and try again if you can."
                : "Only approximate."}{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={locate}
                disabled={locating}
              >
                {locating ? "Trying…" : "Try again"}
              </button>
            </p>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground max-w-56 text-right text-xs">
          {noGps
            ? "Location is approximate or unavailable — this device may not have GPS. The time is still recorded."
            : "No location available. The time is still recorded."}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-danger-subtle-foreground text-xs">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function CheckInButton({
  planId,
  instituteName,
}: {
  planId: string;
  instituteName: string;
}) {
  return (
    <CheckButton
      planId={planId}
      instituteName={instituteName}
      action={checkIn}
      label="Check in"
      busyLabel="Checking in…"
      icon={<LogInIcon className="size-4" aria-hidden />}
    />
  );
}

export function CheckOutButton({
  planId,
  instituteName,
}: {
  planId: string;
  instituteName: string;
}) {
  return (
    <CheckButton
      planId={planId}
      instituteName={instituteName}
      action={checkOut}
      label="Check out"
      busyLabel="Checking out…"
      icon={<LogOutIcon className="size-4" aria-hidden />}
      variant="outline"
    />
  );
}

/**
 * The escape valve, shown only on a visit left open from an earlier day.
 *
 * Deliberately not offered on today's visit: a rep who is still at the school
 * should check out properly, and this would be the easier tap. It appears once
 * the day has passed and the check-out is not coming.
 */
export function CloseWithoutCheckoutButton({
  planId,
  instituteName,
}: {
  planId: string;
  instituteName: string;
}) {
  const [state, formAction, isPending] = useActionState(
    closeWithoutCheckout,
    EMPTY_STATE,
  );
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-9"
        onClick={() => setConfirming(true)}
      >
        <TriangleAlertIcon className="size-4" aria-hidden />
        Close without check-out
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="plan_id" value={planId} />
      <p className="text-muted-foreground text-xs">
        Mark {instituteName} complete? The time on site will read “not
        recorded”, which is the honest answer — it cannot be worked out now.
      </p>
      <div className="flex gap-2">
        <Button type="submit" className="h-9" disabled={isPending}>
          {isPending ? "Closing…" : "Yes, close it"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-danger-subtle-foreground text-xs">
          {state.error}
        </p>
      )}
    </form>
  );
}
