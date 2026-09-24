import Link from "next/link";
import {
  ActivityIcon,
  Building2Icon,
  CalendarRangeIcon,
  ChartColumnIcon,
  CameraIcon,
  ClipboardCheckIcon,
  ClockIcon,
  DatabaseIcon,
  FileTextIcon,
  SendIcon,
  UsersIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/section-title";
import { OpenCheckIns } from "@/components/admin/open-checkins";
import { EmptyState } from "@/components/states";
import { VisitPhotoThumb } from "@/components/visits/visit-photo";
import { CountLink } from "@/components/ui/count-link";
import type { Overview as OverviewData } from "@/lib/admin-workspace";
import { formatDate } from "@/lib/dates";

/**
 * The supervisor's landing screen.
 *
 * It answers the four questions an admin opens the app to ask — did anyone go
 * out today, is the work being written up, is the evidence arriving, and what
 * is still open — and then gets out of the way towards Review, which is where
 * the actual reading happens.
 *
 * No charts. A team of twenty produces a number small enough to read as a
 * number, and a sparkline of five data points is decoration pretending to be
 * analysis.
 */
export function AdminOverview({
  data,
  today,
  weekStart,
  weekEnd,
}: {
  data: OverviewData;
  /**
   * The app's definition of today, passed in rather than computed here.
   *
   * `todayISO()` is a server helper and this is the component that renders the
   * link; taking the value from the page means the tile's numbers and the
   * range its link opens come from ONE reading of the day. Asking again here
   * could, at midnight IST, produce a link to a different day than the one
   * counted.
   */
  today: string;
  /**
   * The week getOverview() counted, passed in for the same reason `today` is:
   * the tiles' numbers and the ranges their links open must come from ONE
   * reading of the calendar. `weekEnd` is `weekCountEnd()` — the Sunday every
   * rollup counts to, not the Saturday a rep is shown — so the link returns
   * exactly the rows the tile counted.
   */
  weekStart: string;
  weekEnd: string;
}) {
  const stuck = data.openCheckIns.filter((v) => v.stale).length;

  return (
    <>
      <SectionTitle>Today and this week</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/*
          ONE TILE, THREE FACTS — and still the fourth of four, because the row
          is `grid-cols-2 md:grid-cols-4` and a fifth tile would break it.

          It read "Visits today: 7", which is the answer to a question nobody
          asks first. The morning question is "twelve planned, how many done",
          and since 0033 there is a third number behind it: one institute can be
          visited twice in a day, so visits and institutes reached are no longer
          the same count. All three live in the space the one used to.
        */}
        <Stat
          icon={ActivityIcon}
          value={
            data.plannedToday === null ? (
              data.visitsToday
            ) : (
              <>
                {data.visitsToday}
                <span className="text-muted-foreground text-[20px] font-medium">
                  {" / "}
                  {data.plannedToday}
                </span>
              </>
            )
          }
          label={
            data.plannedToday === null ? "Visits today" : "Visits today · of planned"
          }
          sub={`${data.institutesToday} institute${data.institutesToday === 1 ? "" : "s"}`}
          tone={data.visitsToday > 0 ? "good" : "quiet"}
          href={`/review?from=${today}&to=${today}`}
        />
        <Stat
          icon={CalendarRangeIcon}
          value={data.visitsThisWeek}
          label="Visits this week"
          href={`/review?from=${weekStart}&to=${weekEnd}`}
        />
        <Stat
          icon={ClipboardCheckIcon}
          value={data.reportsThisWeek}
          label="Reports filed"
          hint={
            data.visitsThisWeek > 0
              ? `of ${data.visitsThisWeek}`
              : undefined
          }
          href={`/review?reported=reported&from=${weekStart}&to=${weekEnd}`}
        />
        {/* No link: there is no photo filter on Review, and a tile that
            opened "this week's visits" under the word "photos" would be
            answering a question nobody asked. */}
        <Stat icon={CameraIcon} value={data.photosThisWeek} label="Photos in" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        {/* Recent activity ---------------------------------------------- */}
        <div>
          <SectionTitle
            action={
              <Button asChild variant="outline" className="h-9">
                <Link href="/review">Open Review</Link>
              </Button>
            }
          >
            Latest from the team
          </SectionTitle>

          {data.recent.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title="Nothing logged yet"
              description="Visits appear here the moment a rep saves one."
            />
          ) : (
            <Card className="gap-0 divide-y divide-border p-0 shadow-xs">
              {data.recent.map((visit) => (
                <div key={visit.id} className="flex items-center gap-3 px-4 py-3">
                  {visit.photo ? (
                    <VisitPhotoThumb
                      photo={visit.photo}
                      caption={`${visit.activityLabel} at ${visit.instituteName}`}
                    />
                  ) : (
                    <div className="border-border mt-2 size-16 shrink-0 rounded-md border border-dashed" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/review/${visit.id}`}
                      className="truncate font-medium hover:underline"
                    >
                      {visit.instituteName}
                    </Link>
                    <p className="text-muted-foreground mt-0.5 truncate text-xs">
                      <Link
                        href={`/team/${visit.memberId}`}
                        className="focus-visible:ring-ring rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {visit.memberName}
                      </Link>{" "}
                      · {formatDate(visit.date)} · {visit.activityLabel}
                    </p>
                  </div>
                  <Badge
                    variant={visit.reportedAt ? "success" : "neutral"}
                    className="shrink-0"
                  >
                    {visit.reportedAt ? "Filed" : "No report"}
                  </Badge>
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* Side rail ----------------------------------------------------- */}
        <div className="space-y-6">
          <div>
            <SectionTitle>Out today</SectionTitle>
            {data.activeToday.length === 0 ? (
              <Card className="p-4">
                <p className="text-muted-foreground text-sm">
                  Nobody has logged a visit yet today.
                </p>
              </Card>
            ) : (
              <Card className="gap-0 divide-y divide-border p-0 shadow-xs">
                {data.activeToday.map((rep) => (
                  <div
                    key={rep.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <Link
                      href={`/team/${rep.id}`}
                      className="focus-visible:ring-ring truncate rounded-sm text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {rep.name}
                    </Link>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      <CountLink
                        value={rep.visits}
                        href={`/review?member=${rep.id}&from=${today}&to=${today}`}
                        label={`Open ${rep.name}'s ${rep.visits} visit${rep.visits === 1 ? "" : "s"} today`}
                      />{" "}
                      visit{rep.visits === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </div>

          {/* Placed directly under "Out today", because they answer the same
              question a minute apart: who is out, and is anybody stuck. */}
          <div>
            <SectionTitle>
              Still checked in
              {stuck > 0 && (
                <Badge variant="danger" className="ml-2">
                  {stuck} stuck
                </Badge>
              )}
            </SectionTitle>
            <OpenCheckIns visits={data.openCheckIns} />
          </div>

          <div>
            <SectionTitle>Open loops</SectionTitle>
            <Card className="p-4">
              {/* ?lifecycle=Set is the SAME predicate this number counts —
                  still "Set", not yet closed — so the list cannot disagree
                  with the tile above it. */}
              <p className="text-2xl font-semibold tabular-nums">
                <CountLink
                  value={data.openLoops}
                  href="/review?lifecycle=Set"
                  label={`Open the ${data.openLoops} loop${data.openLoops === 1 ? "" : "s"} the team has not closed`}
                />
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Sessions and campus visits the team has set but not yet closed.
              </p>
            </Card>
          </div>

          <div>
            <SectionTitle>Go to</SectionTitle>
            <div className="grid gap-2">
              <Shortcut href="/assign" icon={SendIcon} label="Assign a visit" />
              {/*
                Stage 5b's way in. `/pending` is deliberately NOT a seventh
                admin tab — the bar is six, and this is the same distance the
                activity report and the data screen are kept at. ClockIcon is
                the icon a rep's own Pending tab uses, so the two screens read
                as one thing seen from two sides.
              */}
              <Shortcut href="/pending" icon={ClockIcon} label="Follow-ups owed" />
              <Shortcut href="/team" icon={UsersIcon} label="Team progress" />
              {/* The pipeline snapshot. Beside Team progress because the two
                  are the same question asked of different things: how is the
                  team doing, and where has their pipeline got to. */}
              <Shortcut
                href="/institutes/report"
                icon={Building2Icon}
                label="Pipeline by rep"
              />
              <Shortcut href="/data" icon={DatabaseIcon} label="Data and backups" />
              {/* /team/report, NOT /report. /report is a rep's own activity and
                  an admin has none — following it only to be redirected would
                  work, but pointing at the destination is what stops the
                  Overview implying an admin has activity of their own. */}
              <Shortcut
                href="/team/report"
                icon={ChartColumnIcon}
                label="Activity report"
              />
              <Shortcut
                href="/materials/manage"
                icon={FileTextIcon}
                label="Materials library"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({
  icon: Icon,
  value,
  label,
  hint,
  sub,
  href,
  tone = "quiet",
}: {
  icon: typeof ActivityIcon;
  /** A node rather than a number, so a tile can carry "7 / 12". */
  value: React.ReactNode;
  label: string;
  hint?: string;
  /** A third line under the label — a second, smaller fact. */
  sub?: string;
  /** Makes the whole tile a link to the rows behind it. */
  href?: string;
  tone?: "good" | "quiet";
}) {
  const body = (
    <>
      <Icon
        className={
          tone === "good" ? "text-primary size-4" : "text-muted-foreground size-4"
        }
        aria-hidden
      />
      <p className="mt-3 text-[26px] leading-none font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="text-muted-foreground mt-2 text-[11px] font-medium tracking-wide">
        {label}
        {hint && <span className="ml-1 opacity-70">{hint}</span>}
      </p>
      {sub && (
        <p className="text-muted-foreground mt-1 text-[11px] tabular-nums opacity-70">
          {sub}
        </p>
      )}
    </>
  );

  if (!href) return <Card className="gap-0 p-4">{body}</Card>;

  /*
   * THE WHOLE TILE IS THE TARGET, not the number inside it.
   *
   * A 26px figure is a small tap target and the card around it is not; on a
   * phone the card is what a thumb lands on anyway. The affordance is the
   * hover lift rather than an underline — underlining a headline number makes
   * a dashboard look like a link farm, which is the same call the report grid
   * makes in the other direction for its dense little counts.
   */
  return (
    <Card className="gap-0 p-0">
      <Link
        href={href}
        className="hover:bg-accent/40 focus-visible:ring-ring block rounded-xl p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {body}
      </Link>
    </Card>
  );
}

function Shortcut({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof ActivityIcon;
  label: string;
}) {
  return (
    <Button asChild variant="outline" className="h-11 justify-start">
      <Link href={href}>
        <Icon className="size-4" aria-hidden />
        {label}
      </Link>
    </Button>
  );
}

/** Used by the Overview's "open loops" wording elsewhere. */
export const OPEN_LOOP_ICON = ClockIcon;
