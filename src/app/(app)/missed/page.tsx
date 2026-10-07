import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CountLink } from "@/components/ui/count-link";
import { EmptyState, ErrorState } from "@/components/states";
import { getCurrentUser, isAdmin, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logError, settled } from "@/lib/errors";
import { missedFollowUpRecord, missedDaysFor } from "@/lib/alerts";
import { formatDate, todayISO } from "@/lib/dates";

export const metadata = { title: "Missed follow-ups" };

/**
 * The missed-follow-up record (Phase E1).
 *
 * TWO VIEWS OF ONE MODULE, WHICH IS WHY THIS IS NOT IN `ADMIN_ONLY_PATHS`. The
 * brief asks for it to be visible to the rep (their own) AND to admins, so an
 * admin-only route would exclude half its audience. A rep lands on their own
 * days; an admin lands on the team. Nothing branches on role for PERMISSION —
 * `alert_events_select` is `supervises(member)` since 0042, so a rep asking
 * for the team view gets exactly their own row back and the page renders the
 * truth either way. The role check below chooses a DEFAULT, not an entitlement.
 *
 * OFF THE NAV BAR, reached from Pending and from the admin Overview. CLAUDE.md's
 * screen-ownership rule is explicit that a new tab has to earn its place in a
 * thumb-reachable bar, and a record consulted occasionally is exactly the case
 * `/data` and `/materials/manage` settled by being one tap deeper.
 *
 * ⚠ THE TEAM BOUNDARY IS REAL NOW, AND THIS SCREEN NO LONGER DRAWS IT.
 *
 * E1 scoped "my team" here with `created_by`, as a SOFT FILTER, precisely
 * because created_by must never be a boundary — 0034 backfills nothing, so
 * making it one would have hidden every pre-0034 rep from every admin,
 * silently, on the one screen built to show them.
 *
 * Since 0042 the boundary is `supervises(member)` in `alert_events_select`, so
 * a TEAM LEAD opening this page already gets exactly their own reps with no
 * filter of any kind — which is why the role check below still chooses a
 * DEFAULT rather than an entitlement, and why nothing here restates a boundary
 * that could drift from the policy's. The switch that remains is an ADMIN's,
 * and it now groups by whether a rep is on a team at all.
 */

const WINDOW_DAYS = 30;

function daysAgo(iso: string, days: number): string {
  // Date arithmetic on a YYYY-MM-DD string, done in UTC so it cannot be dragged
  // across a day boundary by the runtime's timezone — the same split weeks.ts
  // uses: the DAY comes from todayISO()/app_today(), the ARITHMETIC is UTC.
  const ms = Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export default async function MissedPage(props: PageProps<"/missed">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = isAdmin(user);
  /*
   * ⚠ TWO QUESTIONS, NOT ONE, and conflating them made a team lead's record
   * render EMPTY.
   *
   * `staff` decides WHICH VIEW: the supervision table, or the personal list of
   * your own missed days. A team lead supervises, so they get the table — the
   * page branched on `admin` and handed them the rep's view, which reads
   * `record.rows[0]` as "you" and finds nothing, because a lead has no alerts
   * of their own (E1: a lead is a reader, not a subject).
   *
   * `admin` decides only whether the SCOPE SWITCH renders. A lead needs no
   * switch: RLS has already narrowed their rows to their own reps.
   */
  const staff = isStaff(user);
  const searchParams = await props.searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const today = todayISO();
  const from = daysAgo(today, WINDOW_DAYS);
  const scope = first(searchParams.scope) === "all" ? "all" : "team";

  /*
   * ⚠ THE "TEAM" IS NOW A REAL TEAM (H3). This read `created_by` — a soft
   * filter chosen in E1 precisely BECAUSE created_by must not be a boundary:
   * 0034 backfills nothing, so every rep made before it has none and would
   * have vanished from every admin's view of the one screen built to show them.
   *
   * `team_lead_id` is the actual boundary, so the filter and the permission
   * finally agree. Two consequences worth stating:
   *
   *   A TEAM LEAD NEEDS NO FILTER AT ALL. `alert_events_select` is
   *   supervises(member) since 0042, so their query already returns exactly
   *   their own reps — a member list here would restate the boundary in a
   *   second place that could drift from it. The switch is an ADMIN's control.
   *
   *   AN ADMIN'S "MY TEAM" IS NOW THE LEADS THEY SUPERVISE, which for an admin
   *   is everybody — so the switch becomes "grouped by team" rather than a
   *   narrowing, and `scope=all` is unchanged.
   */
  let teamIds: string[] | undefined;
  if (admin && scope === "team") {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "rep")
      .not("team_lead_id", "is", null);
    if (error) {
      logError("missed:team", error);
    }
    teamIds = (data ?? []).map((row) => row.id as string);
  }

  const record = await settled(
    missedFollowUpRecord(from, today, admin ? teamIds : undefined),
    { ok: false as const },
    "missed:record",
  );

  // A rep's own days, which is the detail a supervisor reaches through a
  // CountLink. Only a REP needs it — a team lead reads the table like an admin.
  const ownDays = staff
    ? null
    : await settled(missedDaysFor(user.id, from, today), { ok: false as const }, "missed:days");

  return (
    <>
      <PageHeader
        title="Missed follow-ups"
        description={
          staff
            ? "Days that ended with follow-ups still open, per rep."
            : "Days that ended with your follow-ups still open."
        }
      />

      <p className="text-muted-foreground mb-4 text-xs">
        {formatDate(from)} – {formatDate(today)} · last {WINDOW_DAYS} days
      </p>

      {/*
        THE SCOPE SWITCH IS AN ADMIN'S ONLY, and it is a filter rather than a
        permission — see the note at the head of this file. A team lead never
        sees it because they never need it: RLS has already narrowed their rows
        to their own reps.

        "Everyone" exists for the rep who is on no team yet — the day-one state,
        since 0041 assigns nobody — who would otherwise be invisible on the one
        screen built to show them. That is the same failure the created_by
        decision avoided, surviving the move to the real boundary.
      */}
      {admin && (
        <div className="mb-4 flex gap-2">
          <Button asChild variant={scope === "team" ? "default" : "outline"} className="h-11">
            <Link href="/missed">On a team</Link>
          </Button>
          <Button asChild variant={scope === "all" ? "default" : "outline"} className="h-11">
            <Link href="/missed?scope=all">Everyone</Link>
          </Button>
        </div>
      )}

      {!record.ok ? (
        <ErrorState message="We could not load the record just now. Please try again in a moment." />
      ) : record.rows.length === 0 ? (
        <EmptyState
          title="Nothing missed"
          description={
            staff
              ? "No day in this window ended with a rep's follow-ups still open."
              : "No day in this window ended with your follow-ups still open. Keep it up."
          }
        />
      ) : staff ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {!admin ? "My team" : scope === "team" ? "On a team" : "Everyone"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">Rep</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Days missed</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Follow-ups</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {record.rows.map((row) => (
                    <tr key={row.memberId} className="border-border border-t">
                      <td className="px-4 py-3">
                        {/* 3df3e09's rule: a name opens the hub, a count opens
                            the rows behind it. */}
                        <Link
                          href={`/team/${row.memberId}`}
                          className="hover:text-primary underline decoration-dotted underline-offset-4"
                        >
                          {row.memberName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <CountLink
                          value={row.daysMissed}
                          href={`/review?member=${row.memberId}`}
                          label={`${row.daysMissed} days missed by ${row.memberName}`}
                        />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.followUpsMissed}
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {row.lastMissed ? formatDate(row.lastMissed) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* A rep's own view: the days themselves, not a one-row table of
           themselves. Same data, the question they would actually ask. */
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {record.rows[0].daysMissed} day
              {record.rows[0].daysMissed === 1 ? "" : "s"} ·{" "}
              {record.rows[0].followUpsMissed} follow-up
              {record.rows[0].followUpsMissed === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ownDays?.ok ? (
              <ul className="divide-border divide-y">
                {ownDays.days.map((day) => (
                  <li
                    key={day.forDate}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <span className="text-sm">{formatDate(day.forDate)}</span>
                    <Badge variant="danger">
                      {day.count} missed
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <ErrorState message="We could not load the individual days." />
            )}
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground mt-6 text-xs">
        A day is counted when the 7:00 PM check found follow-ups still open.
        Closing them afterwards does not remove the day — the record is of what
        happened, not of what is outstanding now. What is still owed is on{" "}
        <Link href="/pending" className="underline underline-offset-4">
          Pending
        </Link>
        .
      </p>
    </>
  );
}
