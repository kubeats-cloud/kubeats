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
import type { TeamMemberWeek } from "@/lib/week-summary";

/**
 * The admin's view of the week: who is on track, and who is behind.
 *
 * Stage 2 turned this into a volume table — three activity counts and a total —
 * because with commitments gone there was no denominator left and every row
 * would have read 0%. The commitment is back, so the question is back with it:
 * "did they do what they said", which is the one an admin actually opens this
 * screen to ask.
 *
 * The per-metric counts are not lost, and that is why this stays one column
 * narrower than it could be: a row opens the member's own Targets screen, which
 * shows all eight metrics as target-vs-achieved. Putting three of them here as
 * well would be the same numbers in two places, and a ten-column table on a
 * laptop is not readable.
 *
 * The percentage is the unweighted mean of the metrics they committed to, so a
 * rep who promised a little and did it reads as complete — which is the honest
 * answer to "did they do what they said", and not the same question as "who did
 * the most work".
 *
 * Two presentations of one list, because the two audiences are not the same
 * person at the same desk. On a phone it is a stack of tappable cards. From
 * `md` it is a table — columns that line up, numbers right-aligned on a
 * tabular figure so they can be compared down the column, and a row height
 * tight enough to see a whole team at once. Stretching the card list across a
 * monitor would have been the easy thing and would have read as unfinished.
 */

interface Row {
  id: string;
  name: string;
  role: string;
  percent: number | null;
  tone: ReturnType<typeof toneFor> | "none";
  status: string;
  href: string;
  reportHref: string;
}

function rowsFrom(
  members: TeamMemberWeek[],
  weekStart: string,
): Row[] {
  return members.map((member) => {
    const percent = completionPercent(member.achieved, member.record.targets);
    return {
      id: member.member,
      name: member.name,
      role: member.role,
      percent,
      // With nothing committed there is no bar to draw and no tone to pick.
      tone: percent === null ? "none" : toneFor(percent, 100),
      status:
        member.record.id === null
          ? "No commitment yet"
          : member.record.locked
            ? "Submitted"
            : "In progress",
      href: `/targets?week=${weekStart}&member=${member.member}`,
      // /team and /report answer different questions — all reps for one week
      // against one rep over months — so they stay separate screens. What they
      // needed was a door between them, which is this.
      reportHref: `/report?period=monthly&member=${member.member}`,
    };
  });
}

export function TeamSnapshot({
  members,
  weekStart,
}: {
  members: TeamMemberWeek[];
  weekStart: string;
}) {
  const rows = rowsFrom(members, weekStart);

  if (rows.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={UsersIcon}
          title="No team members yet"
          description="Accounts created in Settings appear here."
        />
      </Card>
    );
  }

  return (
    <>
      {/* Phone: a stack of tappable cards. */}
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <Card key={row.id} className="p-0">
            <Link
              href={row.href}
              className="focus-visible:ring-ring flex items-center gap-3 px-4 py-3 focus-visible:ring-2 focus-visible:outline-none"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{row.name}</p>
                  {row.role === "admin" && (
                    <Badge variant="neutral" className="shrink-0">
                      Admin
                    </Badge>
                  )}
                </div>

                <p className="text-muted-foreground mt-0.5 truncate text-xs">
                  {row.status}
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
        ))}
      </div>

      {/* Desktop: a table, because a whole team at once is the point. */}
      <Card className="hidden p-0 md:block">
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
                <th scope="col" className="w-[30%] px-5 py-2.5 text-xs font-medium">
                  Progress
                </th>
                <th scope="col" className="px-5 py-2.5 text-right text-xs font-medium">
                  Complete
                </th>
                <th scope="col" className="px-3 py-2.5 text-xs font-medium">
                  <span className="sr-only">Report</span>
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
                  className="border-border hover:bg-muted/40 border-b last:border-0"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={row.href}
                      className="focus-visible:ring-ring flex items-center gap-2 font-medium focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {row.name}
                      {row.role === "admin" && (
                        <Badge variant="neutral" className="shrink-0">
                          Admin
                        </Badge>
                      )}
                    </Link>
                  </td>
                  <td className="text-muted-foreground px-5 py-3">{row.status}</td>
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
                  <td className="px-3 py-3">
                    <Link
                      href={row.reportHref}
                      className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                    >
                      Report
                    </Link>
                  </td>
                  <td className="px-2 py-3">
                    <Link
                      href={row.href}
                      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
                      aria-label={`Open ${row.name}`}
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
