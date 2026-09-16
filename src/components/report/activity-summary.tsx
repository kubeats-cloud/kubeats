import { Badge } from "@/components/ui/badge";
import {
  ACCURACY_UNAVAILABLE,
  LOCATION_UNAVAILABLE,
  formatArea,
} from "@/lib/location-display";
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
import { FileTextIcon, MapPinOffIcon } from "lucide-react";

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

/** Every check-in and check-out answers these four, in this order. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd className="min-w-0 text-right text-xs break-words">{value}</dd>
    </div>
  );
}

/** When an event never happened, or happened before anything recorded it. */
const NOT_RECORDED = "Not recorded";

/**
 * One end of a visit: arriving, or leaving.
 *
 * THE SAME COMPONENT FOR BOTH, and that is the requirement rather than a way of
 * saving lines. The two used to be hand-written table cells that had drifted
 * apart — the check-in showed an area name and an accuracy badge, the check-out
 * showed the same fields against columns the app never wrote, so in practice an
 * admin saw four facts on the left and a bare timestamp on the right. One
 * component cannot drift from itself.
 *
 * NOTHING HERE HAS A FALLBACK, which is the other requirement. A missing
 * position prints as missing. It is never filled in from the arrival, from the
 * institute's registered address, or from another visit — see the note at the
 * head of location-display.ts for why substituting any of those turns "the rep
 * was here" into "the rep said they were here".
 */
function PresencePanel({
  title,
  at,
  latitude,
  longitude,
  accuracy,
  area,
  manualReason,
}: {
  title: string;
  at: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  area: string | null;
  /** #6 — set only on an arrival the rep deliberately made without a fix. */
  manualReason?: string | null;
}) {
  const coords = formatCoords(latitude, longitude);

  return (
    <div className="bg-card px-4 py-3">
      <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {title}
      </p>
      <dl className="mt-2 space-y-1.5">
        <Fact label="Date & time" value={at ? formatDateTime(at) : NOT_RECORDED} />
        <Fact
          label="GPS coordinates"
          value={
            coords ? (
              <span className="tabular-nums">{coords}</span>
            ) : (
              LOCATION_UNAVAILABLE
            )
          }
        />
        {/* The area name is decoration and says so when it is absent, but only
            once there is a position for it to describe. "Area unavailable"
            under no coordinates at all would suggest a lookup that failed,
            when in fact nothing was ever located. */}
        <Fact
          label="Location / address"
          value={coords ? formatArea(area) : LOCATION_UNAVAILABLE}
        />
        <Fact
          label="GPS accuracy"
          value={
            coords && accuracy !== null ? (
              <Badge variant={ACCURACY_BADGE[accuracyBand(accuracy)]}>
                {describeAccuracy(accuracy)}
              </Badge>
            ) : (
              ACCURACY_UNAVAILABLE
            )
          }
        />
      </dl>

      {/* An override nobody can see is a bypass. Kept below the four facts
          rather than in place of one, so the shape of the two panels stays
          identical and this reads as what it is: the rep's own account of why
          the rows above say what they say. */}
      {manualReason && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="warning">
            <MapPinOffIcon className="size-3" aria-hidden />
            No location
          </Badge>
          <span className="text-muted-foreground">
            &ldquo;{manualReason}&rdquo;
          </span>
        </p>
      )}
    </div>
  );
}

/** One planned visit, arrival and departure side by side. */
function PresenceCard({ visit }: { visit: ActivityReport["plannedVisits"][number] }) {
  return (
    <Card className="gap-0 overflow-hidden p-0 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{visit.instituteName}</p>
          <p className="text-muted-foreground truncate text-xs">
            {formatDate(visit.date)} · {visit.purpose}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Badge variant={VISIT_STATUS_BADGE[visit.status]}>{visit.status}</Badge>
          {visit.reportFiled === null ? (
            <Badge variant="neutral">Not logged</Badge>
          ) : (
            <Badge variant={visit.reportFiled ? "success" : "neutral"}>
              {visit.reportFiled ? "Filed" : "No report"}
            </Badge>
          )}
        </div>
      </div>

      {/* A one-pixel gap filled by the border colour, so the two halves are
          divided on a wide screen and stacked cleanly on a phone. */}
      <div className="bg-border grid gap-px sm:grid-cols-2">
        <PresencePanel
          title="Checked in"
          at={visit.checkinAt}
          latitude={visit.checkinLat}
          longitude={visit.checkinLng}
          accuracy={visit.checkinAccuracy}
          area={visit.checkinArea}
          manualReason={
            visit.checkinLocationManual ? (visit.checkinManualReason ?? "No reason given") : null
          }
        />
        <PresencePanel
          title="Checked out"
          at={visit.checkoutAt}
          latitude={visit.checkoutLat}
          longitude={visit.checkoutLng}
          accuracy={visit.checkoutAccuracy}
          area={visit.checkoutArea}
        />
      </div>

      {/* Both real timestamps or nothing: visitMinutes returns null unless it
          has an arrival AND a departure, so a swept or admin-cleared visit
          reads "Not recorded" rather than being given an invented duration. */}
      <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5">
        <span className="text-muted-foreground text-xs">Total duration</span>
        <span className="text-xs font-semibold tabular-nums">
          {formatDuration(visit.minutes)}
        </span>
      </div>
    </Card>
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
          /*
           * A CARD PER VISIT, NOT A ROW PER VISIT.
           *
           * This was a seven-column table scrolling sideways inside its own box,
           * with the arrival and the departure crammed into one cell each as
           * four stacked unlabelled lines. Asked to show the same four facts on
           * both sides, that layout could only get wider — and it was already
           * past the width of the phone every other screen in this app is built
           * for. Two labelled panels side by side say more in less room, and
           * stack rather than scroll when there is none.
           */
          <div className="space-y-3">
            {plannedVisits.map((visit) => (
              <PresenceCard key={visit.id} visit={visit} />
            ))}
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
