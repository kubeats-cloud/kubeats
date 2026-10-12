"use client";

import { useTransition } from "react";
import Link from "next/link";
import { CalendarPlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { closeFollowUpTask } from "@/lib/visit-actions";
import { formatDate, todayISO } from "@/lib/dates";
import { meetingPromptsFor } from "@/lib/validation/visit";
import type { FollowUpTask, PlanEntry } from "@/lib/visits";

/**
 * "Meetings to arrange" — moved out of `FollowUpCalls` into the Meeting
 * section, as its own sibling to the plan's entries list rather than a
 * subsection of the calls card. Unchanged otherwise: still a PROMPT, not a
 * plan row — `close_visit()` (0039) writes it to `follow_up_tasks` the same
 * way it writes a call, and the one explicit tap that turns it into a real
 * visit is the same "Plan it" link to Pending it always was.
 *
 * `meetingPromptsFor()` is what keeps this from doubling an institute that is
 * already in today's entries above — see that function's own note.
 */
export function MeetingPrompts({
  tasks,
  entries,
}: {
  tasks: FollowUpTask[];
  entries: PlanEntry[];
}) {
  const [closing, startClosing] = useTransition();
  const today = todayISO();

  const meetings = meetingPromptsFor(tasks, entries);
  if (meetings.length === 0) return null;

  return (
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
                {task.dueDate < today ? "overdue" : "due"} {formatDate(task.dueDate)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              <Badge variant="neutral">To arrange</Badge>
              {/*
                ONE EXPLICIT TAP onto a plan. It goes to the institute, where
                Pending's existing "start a follow-up" control writes the
                daily_plans row with a purpose — so the meeting gate still has
                exactly one writer in front of it, and the rep still chooses
                what the visit counts as.
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
                    await closeFollowUpTask(task.id, "done", "meeting");
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
  );
}
