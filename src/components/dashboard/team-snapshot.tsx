import Link from "next/link";
import { ChevronRightIcon, UsersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/states";
import {
  TONE_BAR,
  TONE_BADGE,
  completionPercent,
  toneFor,
} from "@/lib/validation/weekly";
import type { TeamMemberWeek } from "@/lib/weekly";

/**
 * The admin's view of the week: one row per member, tap through for the detail.
 *
 * The percentage is the unweighted mean of the metrics they committed to, so a
 * rep who promised a little and did it reads as complete — which is the honest
 * answer to "did they do what they said", and not the same question as "who did
 * the most work".
 */
export function TeamSnapshot({
  members,
  weekStart,
  openLoops,
}: {
  members: TeamMemberWeek[];
  weekStart: string;
  openLoops: Map<string, number>;
}) {
  if (members.length === 0) {
    return (
      <EmptyState
        icon={UsersIcon}
        title="No team members yet"
        description="Accounts are created in Settings. Once reps are added, their week appears here."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {members.map((member) => {
        const { record, achieved } = member.view;
        const percent = completionPercent(achieved, record.targets);
        // With nothing committed there is no bar to draw and no tone to pick.
        const tone = percent === null ? "none" : toneFor(percent, 100);
        const loops = openLoops.get(member.member) ?? 0;

        return (
          <li key={member.member}>
            <Card className="gap-0 p-0">
              <Link
                href={`/weekly?week=${weekStart}&member=${member.member}`}
                className="hover:bg-accent flex min-h-16 items-center gap-3 rounded-lg px-4 py-3 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{member.name}</p>
                    {member.role === "admin" && (
                      <Badge variant="neutral" className="shrink-0">
                        Admin
                      </Badge>
                    )}
                  </div>

                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    {record.id === null
                      ? "No commitment yet"
                      : record.locked
                        ? "Commitment submitted"
                        : "Commitment in progress"}
                    {" · "}
                    {loops} open loop{loops === 1 ? "" : "s"}
                  </p>

                  <Progress
                    value={percent ?? 0}
                    indicatorClassName={TONE_BAR[tone]}
                    className="mt-2"
                    aria-label={`${member.name}: ${percent ?? 0}% of commitment`}
                  />
                </div>

                <div className="shrink-0 text-right">
                  {percent === null ? (
                    <span className="text-muted-foreground text-lg">—</span>
                  ) : (
                    <Badge variant={TONE_BADGE[tone]} className="tabular-nums">
                      {percent}%
                    </Badge>
                  )}
                </div>

                <ChevronRightIcon
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden
                />
              </Link>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
