"use client";

import { useTransition } from "react";
import Link from "next/link";
import { CalendarPlusIcon, PhoneIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { closeFollowUpTask } from "@/lib/visit-actions";
import { formatDate, todayISO } from "@/lib/dates";
import type { FollowUpTask } from "@/lib/visits";
import { cn } from "@/lib/utils";

/**
 * The Follow-up calls section of today's plan (A1), and the meetings-to-arrange
 * list beside it.
 *
 * READS `follow_up_tasks`, NEVER `daily_plans` — which is the whole of Phase
 * A's design and the reason this is a separate component rather than more rows
 * inside the plan list. A call has no arrival, no photograph and no check-out;
 * putting one in the plan list would mean the Check in button had to learn what
 * to do with a row it cannot process, and the Overview's "of planned" tile
 * would start counting phone calls as visits. 0038's header is the long
 * version.
 *
 * THE SAME SOURCE PENDING READS. A follow-up created at the end of a visit
 * appears here and in Pending's today filter with no write-sync between them,
 * because both ask `follow_up_tasks` the same question. That is what makes
 * "auto-updated in today's plan" true without a second writer.
 *
 * A MEETING TASK IS A PROMPT, NOT A PLAN ROW. It gets a quieter block and one
 * explicit tap that puts it on a day's plan through the path that already
 * exists. The tap is deliberate: the meeting gate reads `daily_plans`, and
 * there is still exactly one writer in front of it.
 */
export function FollowUpCalls({ tasks }: { tasks: FollowUpTask[] }) {
  const [closing, startClosing] = useTransition();
  const today = todayISO();

  const calls = tasks.filter((task) => task.kind === "call");
  const meetings = tasks.filter((task) => task.kind === "meeting");

  if (calls.length === 0 && meetings.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No calls owed today. Anything you set as a next action when logging a
        visit turns up here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {calls.length > 0 && (
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
                  {/* The call itself. A rep is holding a phone; the number is
                      the institute's own, so the list is actionable rather
                      than merely a reminder to go and look one up. */}
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

                  {/*
                    Both answers CLOSE the task. A call that went unanswered is
                    a call that was made; leaving it open would make this list
                    grow with attempts rather than with work owed, and the rep
                    raises another follow-up if they want one.
                  */}
                  <Button
                    type="button"
                    className="h-11"
                    disabled={closing}
                    onClick={() =>
                      startClosing(async () => {
                        await closeFollowUpTask(task.id, "done");
                      })
                    }
                  >
                    Done
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11"
                    disabled={closing}
                    onClick={() =>
                      startClosing(async () => {
                        await closeFollowUpTask(task.id, "no_answer");
                      })
                    }
                  >
                    No answer
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {meetings.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Meetings to arrange
          </p>
          <ul className="space-y-2">
            {meetings.map((task) => (
              <li
                key={task.id}
                className="border-border bg-muted/30 flex flex-col items-stretch gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{task.instituteName}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {task.note ? `${task.note} · ` : ""}
                    {task.dueDate < today ? "overdue" : "due"}{" "}
                    {formatDate(task.dueDate)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                  <Badge variant="neutral">To arrange</Badge>
                  {/*
                    ONE EXPLICIT TAP onto a plan. It goes to the institute,
                    where Pending's existing "start a follow-up" control writes
                    the daily_plans row with a purpose — so the meeting gate
                    still has exactly one writer in front of it, and the rep
                    still chooses what the visit counts as.
                  */}
                  <Button asChild variant="outline" className="h-11">
                    <Link href={`/pending?due=today`}>
                      <CalendarPlusIcon className="size-4" aria-hidden />
                      Plan it
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11"
                    disabled={closing}
                    onClick={() =>
                      startClosing(async () => {
                        await closeFollowUpTask(task.id, "done");
                      })
                    }
                  >
                    Done
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
