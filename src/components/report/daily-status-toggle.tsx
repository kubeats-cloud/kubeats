"use client";

import { useState, useTransition } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setMyDailyStatus } from "@/lib/rep-daily-status-actions";
import {
  DAILY_STATUSES,
  DAILY_STATUS_LABELS,
  type DailyStatus,
} from "@/lib/validation/rep-daily-status";

/**
 * One rep's status for today, as three buttons.
 *
 * A CLIENT COMPONENT because the tap has to show its result without a reload:
 * a server-action-then-refresh would leave the old selection lit for a beat,
 * and on the phone this is used on that beat is the whole question ("did it
 * take?"). The state is optimistic — the button lights immediately, and is
 * put back with the server's reason if the write is refused.
 *
 * NO REP ID, NO DATE. The action derives both from the session and
 * public.app_today(); this control cannot name anyone else or another day
 * even if it is handed a forged payload.
 *
 * `initial` is what the server read for today. Null is "not recorded" — an
 * ordinary state, shown as such rather than as an error or as a guessed
 * status.
 */
export function DailyStatusToggle({
  initial,
}: {
  initial: DailyStatus | null;
}) {
  const [status, setStatus] = useState<DailyStatus | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: DailyStatus) {
    if (pending || next === status) return;

    const previous = status;
    setStatus(next);
    setError(null);

    startTransition(async () => {
      const result = await setMyDailyStatus(next);
      if (result.error) {
        setError(result.error);
        setStatus(previous);
      }
    });
  }

  return (
    <section
      aria-labelledby="daily-status-heading"
      className="bg-card border-border mt-4 rounded-lg border p-3"
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="daily-status-heading" className="text-sm font-semibold">
          Today&apos;s status
        </h2>
        <p aria-live="polite" className="text-muted-foreground text-xs">
          {pending
            ? "Saving…"
            : status
              ? `Recorded: ${DAILY_STATUS_LABELS[status]}`
              : "Not recorded yet"}
        </p>
      </div>

      <div
        role="group"
        aria-label="Set today's status"
        className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-3"
      >
        {DAILY_STATUSES.map((option) => {
          const selected = option === status;
          return (
            <Button
              key={option}
              type="button"
              variant={selected ? "default" : "outline"}
              aria-pressed={selected}
              disabled={pending}
              onClick={() => choose(option)}
              className="h-11"
            >
              {selected && <CheckIcon aria-hidden />}
              {DAILY_STATUS_LABELS[option]}
            </Button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      )}

      <p className="text-muted-foreground mt-2 text-xs">
        One status per day, for today only. Choosing again replaces today&apos;s
        value — only the latest one is kept, not a history of changes.
      </p>
    </section>
  );
}
