"use client";

import { useActionState, useState } from "react";
import { MapPinOffIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clearStuckCheckIn } from "@/lib/checkin-actions";
import { EMPTY_STATE } from "@/lib/visit-form-state";
import { formatTime, formatDate } from "@/lib/dates";
import type { OpenCheckIn } from "@/lib/admin-workspace";

/**
 * Who is inside a visit right now — and the one lever an admin has over it.
 *
 * This sits on the Overview rather than on Team because it is a question about
 * RIGHT NOW, and Overview is the screen that already answers those: what has
 * been logged today, who is out, what is still open. Team is a week at a time,
 * one row per rep, and a stuck visit is neither weekly nor per-rep — it is one
 * visit that needs a decision today.
 *
 * WHEN TO CLEAR ONE, AND WHEN NOT TO. A rep mid-visit shows here and that is
 * normal; they will finish and check themselves out. What is not normal is a
 * visit from a previous day, or one that has been open for hours — a dead
 * phone, a closed browser, a rep who drove away. Because a rep may hold only
 * one open visit, that orphan stops them working anywhere at all, and the
 * nightly sweep will not run until 01:30.
 *
 * So the button is deliberately quiet on today's visits and loud on stale ones:
 * clearing a visit somebody is still standing in would throw away the duration
 * they were about to record.
 */
function ClearButton({
  planId,
  name,
  instituteName,
}: {
  planId: string;
  name: string;
  instituteName: string;
}) {
  const [state, formAction, isPending] = useActionState(
    clearStuckCheckIn,
    EMPTY_STATE,
  );
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-9 shrink-0"
        onClick={() => setConfirming(true)}
      >
        Clear
      </Button>

      {/*
        WHAT THIS DIALOG SAYS IS ALL IT SAYS.

        It used to carry a sentence explaining the consequence — that the time
        on site would read "not recorded", and that this was the honest answer.
        The client asked for it to go, and the behaviour it described is
        unchanged: clearStuckCheckIn still sets checkout_missing alone, still
        invents no checkout_at, and the record still says it was closed by an
        admin rather than by the rep. The explanation is gone, not the honesty.

        A real dialog rather than the inline confirm that stood here, because
        the heading the spec asks for needs something to be the heading of, and
        a focus-trapped Radix dialog is what every other confirmation in this
        app already uses.
      */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Clear Check-In?</DialogTitle>
            <DialogDescription>
              {name} is currently checked in at {instituteName}.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-2">
            <input type="hidden" name="plan_id" value={planId} />
            <div className="flex justify-end gap-2">
              <Button type="submit" className="h-11" disabled={isPending}>
                {isPending ? "Clearing…" : "Yes, Clear It"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
            {/* Not an explanation — a failure. The one thing that still has to
                be able to appear here, or a refused clear looks like a dead
                button. */}
            {state.error && (
              <p role="alert" className="text-danger-subtle-foreground text-xs">
                {state.error}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function OpenCheckIns({ visits }: { visits: OpenCheckIn[] }) {
  if (visits.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-muted-foreground text-sm">
          Nobody is mid-visit right now.
        </p>
      </Card>
    );
  }

  return (
    <Card className="divide-border gap-0 divide-y p-0 shadow-xs">
      {visits.map((visit) => (
        <div key={visit.planId} className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{visit.memberName}</p>
            <p className="text-muted-foreground truncate text-xs">
              {visit.instituteName}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {visit.stale
                ? `Since ${formatDate(visit.checkinAt)}`
                : `Since ${formatTime(visit.checkinAt)}`}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {visit.stale && (
                <Badge variant="danger">
                  <TriangleAlertIcon className="size-3" aria-hidden />
                  Stuck
                </Badge>
              )}
              {visit.locationManual && (
                <Badge variant="warning">
                  <MapPinOffIcon className="size-3" aria-hidden />
                  No location
                </Badge>
              )}
            </div>
          </div>

          {/* Offered on every open visit, because "my phone died an hour ago"
              is a today problem — but only the stale ones are badged, so the
              list says which actually needs a decision. */}
          <ClearButton
            planId={visit.planId}
            name={visit.memberName}
            instituteName={visit.instituteName}
          />
        </div>
      ))}
    </Card>
  );
}
