"use client";

import { useState, useTransition } from "react";
import { CalendarPlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StartFollowUp } from "@/components/visits/follow-up-list";
import { closeFollowUpTask } from "@/lib/visit-actions";
import { formatDate, todayISO } from "@/lib/dates";
import { meetingPromptsFor } from "@/lib/validation/visit";
import type { FollowUp, FollowUpTask, PlanEntry, PurposeOption } from "@/lib/visits";

/**
 * "Meetings to arrange" — moved out of `FollowUpCalls` into the Meeting
 * section, as its own sibling to the plan's entries list rather than a
 * subsection of the calls card. Unchanged otherwise: still a PROMPT, not a
 * plan row — `close_visit()` (0039) writes it to `follow_up_tasks` the same
 * way it writes a call.
 *
 * `meetingPromptsFor()` is what keeps this from doubling an institute that is
 * already in today's entries above — see that function's own note.
 *
 * "PLAN IT" OPENS `StartFollowUp` IN PLACE (Phase A fix). It used to be a
 * `<Link>` to `/pending?due=today`, which went nowhere useful once Pending
 * stopped being the only place a meeting task was shown. `StartFollowUp` is
 * the exact same panel "Visit again" opens — reused, not rebuilt — fed a
 * minimal stand-in `FollowUp` built from the task's own `instituteId` /
 * `instituteName`, the only two fields that component reads. It does not
 * need the institute to be in `getOpenFollowUps()`'s open-status list:
 * neither `StartFollowUp` nor the `startFollowUp()` action it submits to
 * ever asks the institute's current status — only ownership, one-open-visit,
 * and the purpose — so a meeting raised while the status was CLOSED still
 * gets a working panel here.
 */
export function MeetingPrompts({
  tasks,
  entries,
  purposes,
}: {
  tasks: FollowUpTask[];
  entries: PlanEntry[];
  purposes: PurposeOption[];
}) {
  const [closing, startClosing] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const today = todayISO();

  const meetings = meetingPromptsFor(tasks, entries);
  if (meetings.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Meetings to arrange
      </p>
      <ul className="space-y-2">
        {meetings.map((task) => {
          // The two fields StartFollowUp actually reads; everything else on
          // FollowUp is unused by it and is never asked for by this path.
          const stub: FollowUp = {
            instituteId: task.instituteId,
            instituteName: task.instituteName,
            city: null,
            status: "",
            // A stub only StartFollowUp reads, and it reads neither of these.
            // Visit is the honest default: this path starts a VISIT.
            statusSource: "visit",
            visitId: null,
            callId: null,
            member: null,
            memberName: null,
            setOn: null,
            followUpDate: null,
            expectedDate: null,
            notes: null,
            mine: true,
            owner: null,
            ownerName: null,
          };

          return (
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

              {open === task.id ? (
                <div className="w-full sm:max-w-xs">
                  <StartFollowUp item={stub} purposes={purposes} onCancel={() => setOpen(null)} />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                  <Badge variant="neutral">To arrange</Badge>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => setOpen(task.id)}
                  >
                    <CalendarPlusIcon className="size-4" aria-hidden />
                    Plan it
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
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
