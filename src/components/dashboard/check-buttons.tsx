"use client";

import { useActionState, useState } from "react";
import { LogInIcon, LogOutIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkIn, checkOut, closeWithoutCheckout } from "@/lib/checkin-actions";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";

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

/** Long enough for a real fix outdoors, short enough not to strand anyone. */
const FIX_TIMEOUT_MS = 7000;

interface Fix {
  latitude: number;
  longitude: number;
}

async function tryFix(): Promise<Fix | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      // Any failure at all resolves to null rather than rejecting: this must
      // never be the reason a rep cannot record that they arrived.
      () => resolve(null),
      { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}

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
  const [fix, setFix] = useState<Fix | null>(null);
  const [asked, setAsked] = useState(false);

  // Two taps by design, and the first one is the honest part: it says what it
  // is doing while the device thinks, instead of appearing to hang.
  async function locate() {
    setLocating(true);
    setFix(await tryFix());
    setAsked(true);
    setLocating(false);
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
      <Button type="submit" variant={variant} className="h-11" disabled={isPending}>
        {icon}
        {isPending ? busyLabel : `Confirm ${label.toLowerCase()}`}
      </Button>
      {!fix && (
        <p className="text-muted-foreground max-w-52 text-right text-xs">
          No location available. The time is still recorded.
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-danger-subtle-foreground text-xs">
          {state.error}
        </p>
      )}
      <span className="sr-only">{instituteName}</span>
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
