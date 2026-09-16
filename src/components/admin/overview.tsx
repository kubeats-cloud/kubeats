import Link from "next/link";
import {
  ActivityIcon,
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
export function AdminOverview({ data }: { data: OverviewData }) {
  const stuck = data.openCheckIns.filter((v) => v.stale).length;

  return (
    <>
      <SectionTitle>Today and this week</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          icon={ActivityIcon}
          value={data.visitsToday}
          label="Visits today"
          tone={data.visitsToday > 0 ? "good" : "quiet"}
        />
        <Stat icon={CalendarRangeIcon} value={data.visitsThisWeek} label="Visits this week" />
        <Stat
          icon={ClipboardCheckIcon}
          value={data.reportsThisWeek}
          label="Reports filed"
          hint={
            data.visitsThisWeek > 0
              ? `of ${data.visitsThisWeek}`
              : undefined
          }
        />
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
                      {visit.memberName} · {formatDate(visit.date)} · {visit.activityLabel}
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
                    <span className="truncate text-sm font-medium">{rep.name}</span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {rep.visits} visit{rep.visits === 1 ? "" : "s"}
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
              <p className="text-2xl font-semibold tabular-nums">{data.openLoops}</p>
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
              <Shortcut href="/data" icon={DatabaseIcon} label="Data and backups" />
              <Shortcut href="/report" icon={ChartColumnIcon} label="Activity report" />
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
  tone = "quiet",
}: {
  icon: typeof ActivityIcon;
  value: number;
  label: string;
  hint?: string;
  tone?: "good" | "quiet";
}) {
  return (
    <Card className="gap-0 p-4">
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
