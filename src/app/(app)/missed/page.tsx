import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CountLink } from "@/components/ui/count-link";
import { EmptyState, ErrorState } from "@/components/states";
import { getCurrentUser, isAdmin } from "@/lib/auth";
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
 * `alert_events_select` is `member = auth.uid() or is_admin()`, so a rep asking
 * for the team view gets exactly their own row back and the page renders the
 * truth either way. The role check below chooses a DEFAULT, not an entitlement.
 *
 * OFF THE NAV BAR, reached from Pending and from the admin Overview. CLAUDE.md's
 * screen-ownership rule is explicit that a new tab has to earn its place in a
 * thumb-reachable bar, and a record consulted occasionally is exactly the case
 * `/data` and `/materials/manage` settled by being one tap deeper.
 *
 * "TEAM LEAD" IS AN ADMIN SCOPED BY `created_by`, and that scoping lives HERE
 * rather than in RLS. 0040 section 4 gives the reason at length: `created_by` is
 * null for every profile created before 0034 (that migration took a deliberate
 * decision not to backfill), so making it the boundary would hide the oldest
 * reps from every admin, silently, on the one screen built to show them. As a
 * filter it is safe — an admin can always switch to everyone and see what the
 * filter was hiding.
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
  const searchParams = await props.searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const today = todayISO();
  const from = daysAgo(today, WINDOW_DAYS);
  const scope = first(searchParams.scope) === "all" ? "all" : "team";

  /*
   * An admin's team: the reps they created. A rep never reaches this branch —
   * their own record needs no member list, because RLS already narrows it to
   * one row and passing their own id would merely restate the boundary.
   */
  let teamIds: string[] | undefined;
  if (admin && scope === "team") {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "rep")
      .eq("created_by", user.id);
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

  // A rep's own days, which is the detail an admin reaches through a CountLink.
  const ownDays = admin
    ? null
    : await settled(missedDaysFor(user.id, from, today), { ok: false as const }, "missed:days");

  return (
    <>
      <PageHeader
        title="Missed follow-ups"
        description={
          admin
            ? "Days that ended with follow-ups still open, per rep."
            : "Days that ended with your follow-ups still open."
        }
      />

      <p className="text-muted-foreground mb-4 text-xs">
        {formatDate(from)} – {formatDate(today)} · last {WINDOW_DAYS} days
      </p>

      {/*
        THE SCOPE SWITCH IS AN ADMIN'S ONLY, and it is a filter rather than a
        permission — see the note at the head of this file. "My team" is the
        default because that is what "team lead" asks for; "Everyone" exists
        because a rep whose created_by is null belongs to no team and would
        otherwise be invisible, which is the exact failure the RLS decision
        avoids and this control makes recoverable.
      */}
      {admin && (
        <div className="mb-4 flex gap-2">
          <Button asChild variant={scope === "team" ? "default" : "outline"} className="h-11">
            <Link href="/missed">My team</Link>
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
            admin
              ? "No day in this window ended with a rep's follow-ups still open."
              : "No day in this window ended with your follow-ups still open. Keep it up."
          }
        />
      ) : admin ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {scope === "team" ? "My team" : "Everyone"}
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
