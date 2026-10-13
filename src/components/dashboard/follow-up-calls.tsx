import Link from "next/link";
import { PhoneIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, todayISO } from "@/lib/dates";
import type { FollowUpTask } from "@/lib/visits";
import { cn } from "@/lib/utils";

/**
 * The Follow-up calls section (A1): calls only, since the Phase A rebuild.
 *
 * MEETINGS LIVE IN `MeetingPrompts` NOW, in the Meeting section instead of
 * nested here — the client's own two-section shape names them as siblings,
 * not as one section's subsection of the other.
 *
 * READS `follow_up_tasks`, NEVER `daily_plans` — which is the whole of Phase
 * A's design and the reason this is a separate component rather than more
 * rows inside the plan list. A call has no arrival, no photograph and no
 * check-out; putting one in the plan list would mean the Check in button had
 * to learn what to do with a row it cannot process, and the Overview's "of
 * planned" tile would start counting phone calls as visits. 0038's header is
 * the long version.
 *
 * THE SAME SOURCE PENDING READS. A follow-up created at the end of a visit
 * appears here and in Pending's today filter with no write-sync between them,
 * because both ask `follow_up_tasks` the same question. That is what makes
 * "auto-updated in today's plan" true without a second writer.
 *
 * "LOG CALL" IS THE ONLY WAY TO CLOSE ONE, as of the rebuild. The old Done /
 * No-answer buttons wrote `outcome` and `done_at` straight from this row with
 * nothing else recorded; `logFollowUpCallOutcome()` (the log-call page's
 * submit) writes the identical two fields, plus a note the rep actually
 * typed. There is no second, quicker close beside it — the client asked for
 * one path, not a third button.
 */
export function FollowUpCalls({ tasks }: { tasks: FollowUpTask[] }) {
  const today = todayISO();
  const calls = tasks.filter((task) => task.kind === "call");

  if (calls.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No calls owed today. Anything you set as a next action when logging a
        visit turns up here.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {calls.map((task) => {
        // Compared as plain YYYY-MM-DD strings, which sort correctly and
        // cannot be dragged across a day boundary by the runtime's own
        // timezone. dates.ts is the only thing that formats one.
        const overdue = task.dueDate < today;
        return (
          <li
            key={task.id}
            className={cn(
              "border-border flex flex-col items-stretch gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
              overdue && "border-l-danger rounded-l-sm border-l-2",
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{task.instituteName}</p>
              <p className="text-muted-foreground truncate text-xs">
                {task.note ? `${task.note} · ` : ""}
                {overdue ? `due ${formatDate(task.dueDate)}` : "due today"}
              </p>
            </div>

            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
              {/* Dialling the institute is not closing the task — a rep may
                  call several times before it is done, and this stays
                  available whichever way "Log call" ends up answered. */}
              {task.phone ? (
                <Button asChild variant="outline" className="h-11">
                  <a href={`tel:${task.phone}`}>
                    <PhoneIcon className="size-4" aria-hidden />
                    Call
                  </a>
                </Button>
              ) : (
                <Button asChild variant="outline" className="h-11">
                  <Link href={`/institutes/${task.instituteId}`}>No number</Link>
                </Button>
              )}

              <Button asChild className="h-11">
                <Link href={`/log-call/${task.id}`}>Log call</Link>
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
