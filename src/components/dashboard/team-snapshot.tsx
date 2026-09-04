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
 * The admin's view of the week.
 *
 * Two presentations of one list, because the two audiences are not the same
 * person at the same desk. On a phone it is a stack of tappable cards. From
 * `md` it is a table — columns that line up, numbers right-aligned on a
 * tabular figure so they can be compared down the column, and a row height
 * tight enough to see a whole team at once. Stretching the card list across a
 * monitor would have been the easy thing and would have read as unfinished.
 *
 * The percentage is the unweighted mean of the metrics they committed to, so a
 * rep who promised a little and did it reads as complete — which is the honest
 * answer to "did they do what they said", and not the same question as "who did
 * the most work".
 */

interface Row {
  id: string;
  name: string;
  role: string;
  percent: number | null;
  tone: ReturnType<typeof toneFor> | "none";
  status: string;
  loops: number;
  href: string;
}

function rowsFrom(
  members: TeamMemberWeek[],
  weekStart: string,
  openLoops: Map<string, number>,
): Row[] {
  return members.map((member) => {
    const { record, achieved } = member.view;
    const percent = completionPercent(achieved, record.targets);
    return {
      id: member.member,
      name: member.name,
      role: member.role,
      percent,
      // With nothing committed there is no bar to draw and no tone to pick.
      tone: percent === null ? "none" : toneFor(percent, 100),
      status:
        record.id === null
          ? "No commitment yet"
          : record.locked
            ? "Submitted"
            : "In progress",
      loops: openLoops.get(member.member) ?? 0,
      href: `/weekly?week=${weekStart}&member=${member.member}`,
    };
  });
}

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

  const rows = rowsFrom(members, weekStart, openLoops);

  return (
    <>
      {/* Phone: a stack of cards ---------------------------------------- */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Card className="gap-0 p-0 shadow-xs">
              <Link
                href={row.href}
                className="hover:bg-accent flex min-h-16 items-center gap-3 rounded-lg px-4 py-3 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{row.name}</p>
                    {row.role === "admin" && (
                      <Badge variant="neutral" className="shrink-0">
                        Admin
                      </Badge>
                    )}
                  </div>

                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    {row.status}
                    {" · "}
                    {row.loops} open loop{row.loops === 1 ? "" : "s"}
                  </p>

                  <Progress
                    value={row.percent ?? 0}
                    indicatorClassName={TONE_BAR[row.tone]}
                    className="mt-2"
                    aria-label={`${row.name}: ${row.percent ?? 0}% of commitment`}
                  />
                </div>

                <div className="shrink-0 text-right">
                  {row.percent === null ? (
                    <span className="text-muted-foreground text-lg">—</span>
                  ) : (
                    <Badge variant={TONE_BADGE[row.tone]} className="tabular-nums">
                      {row.percent}%
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
        ))}
      </ul>

      {/* Desktop: a table ----------------------------------------------- */}
      <Card className="hidden gap-0 overflow-hidden p-0 shadow-xs md:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Each team member&rsquo;s progress against their commitment this week
            </caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left">
                <th scope="col" className="px-5 py-2.5 text-xs font-medium">
                  Member
                </th>
                <th scope="col" className="px-5 py-2.5 text-xs font-medium">
                  Commitment
                </th>
                <th scope="col" className="px-5 py-2.5 text-right text-xs font-medium">
                  Open loops
                </th>
                <th scope="col" className="w-[34%] px-5 py-2.5 text-xs font-medium">
                  Progress
                </th>
                <th scope="col" className="px-5 py-2.5 text-right text-xs font-medium">
                  Complete
                </th>
                <th scope="col" className="w-10 px-2 py-2.5">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-border hover:bg-accent/60 border-b transition-colors last:border-0"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={row.href}
                      className="focus-visible:ring-ring flex items-center gap-2 rounded-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <span className="truncate">{row.name}</span>
                      {row.role === "admin" && (
                        <Badge variant="neutral" className="shrink-0">
                          Admin
                        </Badge>
                      )}
                    </Link>
                  </td>
                  <td className="text-muted-foreground px-5 py-3">{row.status}</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {row.loops === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      row.loops
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <Progress
                      value={row.percent ?? 0}
                      indicatorClassName={TONE_BAR[row.tone]}
                      aria-label={`${row.name}: ${row.percent ?? 0}% of commitment`}
                    />
                  </td>
                  <td className="px-5 py-3 text-right">
                    {row.percent === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Badge variant={TONE_BADGE[row.tone]} className="tabular-nums">
                        {row.percent}%
                      </Badge>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <Link
                      href={row.href}
                      tabIndex={-1}
                      aria-hidden
                      className="text-muted-foreground hover:text-foreground block"
                    >
                      <ChevronRightIcon className="size-4" aria-hidden />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
