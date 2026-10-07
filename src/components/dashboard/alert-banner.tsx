"use client";

import { useTransition } from "react";
import Link from "next/link";
import { BellIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markAlertSeen } from "@/lib/alert-actions";
// From `alert-kinds`, NOT `alerts` — that module imports the Supabase server
// client, and a Client Component may not reach across that line. See its header.
import { describeAlert, type AlertEvent } from "@/lib/alert-kinds";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * What the database noticed, shown where the rep already looks (Phase E1).
 *
 * THIS IS A STATE, NOT A NOTIFICATION. Nothing is pushed and nothing is sent.
 * `materialise_daily_alerts()` runs on pg_cron at a fixed Indian clock time and
 * writes a row; this renders the rows that are still unseen. So the EVALUATION
 * is exact — 19:00 IST is 19:00 IST whether or not anybody has the app open —
 * and the SEEING happens on the next page load. 0040's header is the long
 * version, including why the schedule lives in Postgres rather than in
 * `wrangler.jsonc`.
 *
 * DISMISSING IS NOT DOING. The control says "Dismiss", never "Done": it writes
 * `seen_at` and nothing else — the only column a rep holds a grant on — and the
 * follow-ups themselves stay on the plan until they are closed. A rep who could
 * clear their missed record by tapping a banner would have a record worth
 * nothing, which is also why there is no delete grant on the table at all.
 *
 * OPTIMISTIC, because the alternative is worse on a phone. `useTransition`
 * leaves the row on screen until the server confirms, so a failed dismiss
 * leaves the banner where it was rather than hiding something that is still
 * owed. A dismiss that silently fails is the one outcome to avoid here.
 */
export function AlertBanner({ alerts }: { alerts: AlertEvent[] }) {
  const [dismissing, startDismissing] = useTransition();

  if (alerts.length === 0) return null;

  return (
    <section aria-label="Alerts" className="mb-6 space-y-2">
      {alerts.map((alert) => {
        const { title, detail, tone } = describeAlert(alert);
        return (
          <div
            key={alert.id}
            className={cn(
              "flex flex-col items-stretch gap-2 rounded-md border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
              // The semantic palette from CLAUDE.md, as a tinted surface with
              // accessible dark text — the `subtle` pair, not the solid one,
              // which is for fills and progress bars.
              tone === "danger"
                ? "border-danger/30 bg-danger-subtle text-danger-subtle-foreground"
                : "border-warning/30 bg-warning-subtle text-warning-subtle-foreground",
            )}
          >
            <div className="flex min-w-0 items-start gap-2.5">
              <BellIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs opacity-90">
                  {detail}
                  {/* The day it is ABOUT, which is not always today: a rep who
                      has not opened the app since Friday sees Friday's missed
                      alert and needs to know it is Friday's. */}
                  <span className="opacity-75"> · {formatDate(alert.forDate)}</span>
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
              {alert.kind === "weekly_plan_not_set" && (
                <Button asChild variant="outline" className="h-11">
                  <Link href="/targets">Set targets</Link>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                aria-label={`Dismiss: ${title}`}
                disabled={dismissing}
                onClick={() =>
                  startDismissing(async () => {
                    await markAlertSeen(alert.id);
                  })
                }
              >
                <XIcon className="size-4" aria-hidden />
                Dismiss
              </Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
