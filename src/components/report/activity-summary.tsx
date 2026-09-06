import { Badge } from "@/components/ui/badge";
import { LOCATION_UNAVAILABLE, formatArea } from "@/lib/location-display";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import { SectionTitle } from "@/components/section-title";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { ActivityReport, PeriodBucket } from "@/lib/activity-report";
import {
  VISIT_STATUS_BADGE,
  formatCoords,
  formatDuration,
} from "@/lib/validation/checkin";
import {
  ACCURACY_BADGE,
  accuracyBand,
  describeAccuracy,
} from "@/lib/validation/location";
import { FileTextIcon } from "lucide-react";

/**
 * One rep's activity, aggregated and read-only.
 *
 * The bars are divs with a percentage width. There is no chart library here on
 * purpose: a count per month is a list of numbers, and a bar is the width of
 * the number — anything more would be a dependency the deploy budget has to
 * carry for the rest of the project's life.
 *
 * Everything shown is derived from visits, daily_plans and institutes. Nothing
 * on this screen is collected for it.
 */

function Stat({
  value,
  label,
  hint,
}: {
  value: number | string;
  label: string;
  hint?: string;
}) {
  return (
    <Card className="gap-0 p-4">
      <p className="text-[26px] leading-none font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="text-muted-foreground mt-2 text-[11px] font-medium tracking-wide">
        {label}
        {hint && <span className="ml-1 opacity-70">{hint}</span>}
      </p>
    </Card>
  );
}

/**
 * A horizontal bar scaled against the largest value in its own set, so a quiet
 * month is still visible next to a busy one. Scaling against a fixed maximum
 * would flatten every bar in a slow year to nothing.
 */
function Bars({
  buckets,
  emptyLabel,
}: {
  buckets: PeriodBucket[];
  emptyLabel: string;
}) {
  const max = Math.max(...buckets.map((b) => b.visits), 0);

  if (max === 0) {
    return <p className="text-muted-foreground text-sm">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-1.5">
      {buckets.map((bucket) => (
        <li key={bucket.key} className="flex items-center gap-3">
          <span className="text-muted-foreground w-10 shrink-0 text-xs">
            {bucket.label}
          </span>
          <span className="bg-muted h-2.5 flex-1 overflow-hidden rounded-full">
            <span
              className="bg-primary block h-full rounded-full"
              style={{ width: `${Math.round((bucket.visits / max) * 100)}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums">
            {bucket.visits}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ActivitySummary({ report }: { report: ActivityReport }) {
  const {
    totalVisits,
    institutesCovered,
    meetingsHeld,
    completed,
    pending,
    reported,
    unreported,
    byActivity,
    byInstitute,
    byMonth,
    byYear,
    plannedVisits,
  } = report;

  const activityMax = Math.max(...byActivity.map((a) => a.visits), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={totalVisits} label="Total visits" />
        <Stat value={institutesCovered} label="Institutes covered" />
        <Stat value={completed} label="Completed" />
        <Stat
          value={pending}
          label="Pending"
          hint={pending > 0 ? "still open" : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By activity</CardTitle>
          </CardHeader>
          <CardContent>
            {totalVisits === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing logged in this period.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {byActivity.map((activity) => (
                  <li key={activity.key} className="flex items-center gap-3">
                    <span className="text-muted-foreground w-32 shrink-0 truncate text-sm">
                      {activity.label}
                    </span>
                    <span className="bg-muted h-2.5 flex-1 overflow-hidden rounded-full">
                      <span
                        className="bg-primary block h-full rounded-full"
                        style={{
                          width: `${activityMax > 0 ? Math.round((activity.visits / activityMax) * 100) : 0}%`,
                        }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">
                      {activity.visits}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Rule 7's meetings figure is the plan's, not the log's, so it is
                shown apart from the activity counts rather than mixed in. */}
            <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">
              Meetings held, counted from the daily plan:{" "}
              <span className="text-foreground font-semibold tabular-nums">
                {meetingsHeld}
              </span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reporting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-sm">
                Closing report filed
              </span>
              <Badge variant={unreported === 0 ? "success" : "neutral"}>
                {reported} of {totalVisits}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-sm">Still to write up</span>
              <Badge variant={unreported > 0 ? "warning" : "neutral"}>
                {unreported}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-sm">
                Open loops (Set, not yet Done)
              </span>
              <Badge variant={pending > 0 ? "warning" : "success"}>{pending}</Badge>
            </div>
            <p className="text-muted-foreground pt-1 text-xs leading-relaxed">
              A session or campus visit stays pending until it is closed as Done.
              Every other activity is complete the moment it is logged.
            </p>
          </CardContent>
        </Card>
      </div>

      <div>
        <SectionTitle>Institutes visited</SectionTitle>
        {byInstitute.length === 0 ? (
          <EmptyState
            icon={FileTextIcon}
            title="No institutes visited in this period"
            description="Visits logged against an institute appear here, with how many times each was reached."
          />
        ) : (
          <Card className="gap-0 divide-border divide-y p-0 shadow-xs">
            {byInstitute.map((institute) => (
              <div
                key={institute.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{institute.name}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {institute.typeLabel} · last visit{" "}
                    {formatDate(institute.lastVisit)}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {institute.visits} visit{institute.visits === 1 ? "" : "s"}
                </Badge>
              </div>
            ))}
          </Card>
        )}
      </div>

      <div>
        <SectionTitle>Field presence</SectionTitle>
        {plannedVisits.length === 0 ? (
          <EmptyState
            icon={FileTextIcon}
            title="No planned visits in this period"
            description="Check-in and check-out times, locations and time on site appear here for every planned visit."
          />
        ) : (
          /* Wide on purpose, and scrolling inside its own box rather than
             pushing the page sideways. */
          <div className="border-border overflow-x-auto rounded-md border">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Scheduled</th>
                  <th className="px-3 py-2 text-left font-medium">Institute</th>
                  <th className="px-3 py-2 text-left font-medium">Checked in</th>
                  <th className="px-3 py-2 text-left font-medium">Checked out</th>
                  <th className="px-3 py-2 text-left font-medium">On site</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Report</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {plannedVisits.map((visit) => {
                  const inAt = formatCoords(visit.checkinLat, visit.checkinLng);
                  const outAt = formatCoords(visit.checkoutLat, visit.checkoutLng);
                  return (
                    <tr key={visit.id}>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        {formatDate(visit.date)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className="block max-w-48 truncate">
                          {visit.instituteName}
                        </span>
                        <span className="text-muted-foreground block max-w-48 truncate text-xs">
                          {visit.purpose}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        {visit.checkinAt ? formatDateTime(visit.checkinAt) : "—"}
                        <span className="text-muted-foreground block text-xs tabular-nums">
                          {visit.checkinAt ? (inAt ?? LOCATION_UNAVAILABLE) : ""}
                        </span>
                        {visit.checkinAt && inAt && (
                          <span className="text-muted-foreground block text-xs">
                            {formatArea(visit.checkinArea)}
                          </span>
                        )}
                        {visit.checkinAt && (
                          <span className="block text-xs">
                            <Badge
                              variant={ACCURACY_BADGE[accuracyBand(visit.checkinAccuracy)]}
                            >
                              {describeAccuracy(visit.checkinAccuracy)}
                            </Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        {visit.checkoutAt ? formatDateTime(visit.checkoutAt) : "—"}
                        <span className="text-muted-foreground block text-xs tabular-nums">
                          {visit.checkoutAt ? (outAt ?? LOCATION_UNAVAILABLE) : ""}
                        </span>
                        {visit.checkoutAt && outAt && (
                          <span className="text-muted-foreground block text-xs">
                            {formatArea(visit.checkoutArea)}
                          </span>
                        )}
                        {visit.checkoutAt && (
                          <span className="block text-xs">
                            <Badge
                              variant={ACCURACY_BADGE[accuracyBand(visit.checkoutAccuracy)]}
                            >
                              {describeAccuracy(visit.checkoutAccuracy)}
                            </Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap tabular-nums">
                        {formatDuration(visit.minutes)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Badge variant={VISIT_STATUS_BADGE[visit.status]}>
                          {visit.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {visit.reportFiled === null ? (
                          <span className="text-muted-foreground text-xs">
                            Not logged
                          </span>
                        ) : (
                          <Badge
                            variant={visit.reportFiled ? "success" : "neutral"}
                          >
                            {visit.reportFiled ? "Filed" : "No report"}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              By month · {byMonth[0]?.key.slice(0, 4)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Bars
              buckets={byMonth}
              emptyLabel="Nothing logged in this year yet."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By year</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars
              buckets={byYear}
              emptyLabel="No visits logged yet."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
