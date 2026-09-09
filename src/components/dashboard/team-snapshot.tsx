import Link from "next/link";
import { ChevronRightIcon, UsersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import { METRICS, type MetricCounts } from "@/lib/validation/weekly";
import type { TeamMemberWeek } from "@/lib/week-summary";

/**
 * The admin's view of the week.
 *
 * This used to be a progress table: a "% of commitment" per rep, a coloured
 * bar, and a status of "No commitment yet" / "In progress" / "Submitted".
 * Stage 2 of the redesign ended commitments (docs/flow-redesign-plan.md,
 * changes 3 and 4), which would have left every row reading 0%, no tone and
 * "No commitment yet" for ever — a table of dashes.
 *
 * So the question it answers has changed rather than been dropped. It was
 * "did they do what they said"; it is now "what did they do". That is a
 * weaker question, and deliberately so: with nothing promised there is nothing
 * to measure against, and inventing a denominator would be making one up.
 *
 * Two presentations of one list, kept from the original because the two
 * audiences are not the same person at the same desk. On a phone it is a stack
 * of tappable cards. From `md` it is a table — columns that line up, numbers
 * right-aligned on a tabular figure so they can be compared down the column,
 * and a row height tight enough to see a whole team at once.
 */

/**
 * The columns worth putting in front of an admin.
 *
 * Not all eight metrics: a six-column table on a laptop is readable and a
 * ten-column one is not, and these are the three the client's own weekly
 * question is about. The rest are one tap away on the member's own week, which
 * shows all eight.
 */
const COLUMNS = ["meetings", "sessions_done", "campus_visits_done"] as const;

const columnLabel = (key: (typeof COLUMNS)[number]) =>
  METRICS.find((m) => m.key === key)?.label ?? key;

interface Row {
  id: string;
  name: string;
  role: string;
  achieved: MetricCounts;
  total: number;
  loops: number;
  href: string;
  reportHref: string;
}

function rowsFrom(
  members: TeamMemberWeek[],
  weekStart: string,
  openLoops: Map<string, number>,
): Row[] {
  return members.map((member) => ({
    id: member.member,
    name: member.name,
    role: member.role,
    achieved: member.achieved,
    // Every metric counts once. This is a volume figure, not a score — there is
    // no target to weight it against and it is not pretending to be one.
    total: METRICS.reduce((sum, m) => sum + member.achieved[m.key], 0),
    loops: openLoops.get(member.member) ?? 0,
    href: `/targets?week=${weekStart}&member=${member.member}`,
    // /team and /report answer different questions — all reps for one week
    // against one rep over months — so they stay separate screens. What they
    // needed was a door between them, which is this.
    reportHref: `/report?period=monthly&member=${member.member}`,
  }));
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
                    {row.total === 0
                      ? "Nothing recorded this week"
                      : COLUMNS.map(
                          (key) => `${row.achieved[key]} ${columnLabel(key).toLowerCase()}`,
                        ).join(" · ")}
                  </p>

                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    {row.loops} open loop{row.loops === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <span
                    className={
                      row.total === 0
                        ? "text-muted-foreground text-lg"
                        : "text-lg font-semibold tabular-nums"
                    }
                  >
                    {row.total === 0 ? "—" : row.total}
                  </span>
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
              What each team member recorded this week
            </caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left">
                <th scope="col" className="px-5 py-2.5 text-xs font-medium">
                  Member
                </th>
                {COLUMNS.map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className="px-5 py-2.5 text-right text-xs font-medium"
                  >
                    {columnLabel(key)}
                  </th>
                ))}
                <th scope="col" className="px-5 py-2.5 text-right text-xs font-medium">
                  Open loops
                </th>
                <th scope="col" className="px-5 py-2.5 text-right text-xs font-medium">
                  All activity
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
                  {COLUMNS.map((key) => (
                    <td key={key} className="px-5 py-3 text-right tabular-nums">
                      {row.achieved[key] === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        row.achieved[key]
                      )}
                    </td>
                  ))}
                  <td className="px-5 py-3 text-right tabular-nums">
                    {row.loops === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      row.loops
                    )}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums">
                    {row.total === 0 ? (
                      <span className="text-muted-foreground font-normal">—</span>
                    ) : (
                      row.total
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
