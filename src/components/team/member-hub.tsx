import Link from "next/link";
import { ChevronRightIcon, FileTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import { InstituteStatusBadge } from "@/components/institutes/status-badge";
import { VisitPhotoThumb } from "@/components/visits/visit-photo";
import { formatDate } from "@/lib/dates";
import { TYPE_LABELS } from "@/lib/validation/institute";
import type { StatusCatalogue } from "@/lib/validation/institute";
import type { Institute } from "@/lib/institutes";
import type { VisitRow } from "@/lib/admin-workspace";
import type { MemberToday, Pipeline, PipelineRow } from "@/lib/team-hub";
import { cn } from "@/lib/utils";

/**
 * The member hub's own blocks.
 *
 * Everything that already had a component renders through it — MetricList for
 * the week, ActivitySummary for the period, FollowUpList for what is owed,
 * OpenCheckIns for who is mid-visit. What is here is only the shapes that had
 * no home: today's three counts, the status pipeline, and the two short lists
 * that end in a link to the screen that owns the full version.
 *
 * NOTHING HERE FETCHES. The page reads; these draw. That is what lets the
 * pipeline be counted from the very array the institute list prints, so the
 * two cannot disagree.
 */

/* ------------------------------------------------------------------ */
/* Today                                                               */
/* ------------------------------------------------------------------ */

/**
 * Planned, visited, institutes — and the third is not a repeat of the second.
 *
 * Since 0033 an institute may be visited more than once in a day, so "5 visits"
 * and "5 institutes" are different claims and the gap between them is real
 * information: two visits to one school is a rep working it hard, not a rep
 * covering two schools.
 *
 * `planned` can legitimately be SMALLER than `visited` — a rep adds a row to
 * their own plan and walks it immediately, and an assigned visit that never
 * happened leaves a plan row with nothing against it. Neither is an error, so
 * neither is flagged as one.
 */
export function TodayCard({ today }: { today: MemberToday }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Stat value={today.planned} label="Planned" />
      <Stat value={today.visited} label="Visits logged" />
      <Stat
        value={today.institutes}
        label="Institutes"
        hint={
          today.visited > today.institutes
            ? `${today.visited} visits`
            : undefined
        }
      />
    </div>
  );
}

function Stat({
  value,
  label,
  hint,
}: {
  value: number;
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

/* ------------------------------------------------------------------ */
/* The pipeline                                                        */
/* ------------------------------------------------------------------ */

/** Tone → the solid fill its bar takes. The semantic palette, not raw colour. */
const TONE_BAR: Record<string, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-neutral",
};

/**
 * Where this rep's institutes stand.
 *
 * Bars are scaled against the LARGEST ROW rather than the total, the same
 * choice `ActivitySummary` makes: against a total, a pipeline with one big
 * bucket flattens every other row to a sliver and the shape disappears.
 *
 * The open/closed split is stated as a line of text rather than as a second
 * chart. It is two numbers.
 */
export function PipelineCard({
  pipeline,
  catalogue,
}: {
  pipeline: Pipeline;
  catalogue: StatusCatalogue;
}) {
  if (pipeline.total === 0) {
    return (
      <Card className="p-4">
        <p className="text-muted-foreground text-sm">
          This rep has not registered any institutes yet.
        </p>
      </Card>
    );
  }

  const max = Math.max(...pipeline.rows.map((row) => row.count), 0);

  return (
    <Card className="p-4">
      <ul className="space-y-2.5">
        {pipeline.rows.map((row) => (
          <PipelineBar
            key={row.status ?? "__none__"}
            row={row}
            max={max}
            catalogue={catalogue}
          />
        ))}
      </ul>

      <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">
        <span className="text-foreground font-semibold tabular-nums">
          {pipeline.open}
        </span>{" "}
        open ·{" "}
        <span className="text-foreground font-semibold tabular-nums">
          {pipeline.closed}
        </span>{" "}
        closed
        {pipeline.unset > 0 && (
          <>
            {" · "}
            <span className="text-foreground font-semibold tabular-nums">
              {pipeline.unset}
            </span>{" "}
            not yet reached
          </>
        )}
        {" · "}
        {pipeline.total} institute{pipeline.total === 1 ? "" : "s"} in all
      </p>
    </Card>
  );
}

function PipelineBar({
  row,
  max,
  catalogue,
}: {
  row: PipelineRow;
  max: number;
  catalogue: StatusCatalogue;
}) {
  return (
    <li className="flex items-center gap-3">
      <span className="w-40 shrink-0 truncate text-sm">
        {/* The badge carries the status's own colour, which is stored data and
            tracks the outcome rather than the open/closed category. The "no
            status yet" bucket has a null status, which the badge already
            renders as its own neutral label. */}
        <InstituteStatusBadge status={row.status} catalogue={catalogue} />
        {row.retired && (
          <span className="text-muted-foreground ml-1 text-[11px]">retired</span>
        )}
      </span>
      <span className="bg-muted h-2.5 flex-1 overflow-hidden rounded-full">
        <span
          className={cn(
            "block h-full rounded-full",
            TONE_BAR[row.tone ?? "neutral"] ?? "bg-neutral",
          )}
          style={{ width: `${max > 0 ? Math.round((row.count / max) * 100) : 0}%` }}
        />
      </span>
      <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">
        {row.count}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Their institutes                                                    */
/* ------------------------------------------------------------------ */

/**
 * The institutes this rep REGISTERED — `institutes.registered_by`.
 *
 * Not the ones they visited, which is a different question and the one
 * `ActivitySummary` answers further down the page. The two part company
 * whenever an institute is reassigned, or whenever two reps share a campus and
 * one covers for the other, so both are on the hub and both say which they are.
 *
 * A short list with a way to the full one, rather than the registry pasted in:
 * /institutes is the screen that owns searching and filtering it.
 */
export function TheirInstitutes({
  institutes,
  catalogue,
  shown,
}: {
  institutes: Institute[];
  catalogue: StatusCatalogue;
  shown: number;
}) {
  if (institutes.length === 0) {
    return (
      <EmptyState
        title="No institutes registered"
        description="Institutes this rep registers appear here, with where each one stands."
      />
    );
  }

  return (
    <Card className="divide-border gap-0 divide-y p-0 shadow-xs">
      {institutes.slice(0, shown).map((institute) => (
        <Link
          key={institute.id}
          href={`/institutes/${institute.id}`}
          className="hover:bg-accent/50 focus-visible:ring-ring flex items-center gap-3 px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{institute.name}</p>
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {TYPE_LABELS[institute.type]}
              {institute.city && ` · ${institute.city}`}
            </p>
          </div>
          <InstituteStatusBadge
            status={institute.status}
            catalogue={catalogue}
            className="shrink-0"
          />
          <ChevronRightIcon
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
        </Link>
      ))}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Recent visits                                                       */
/* ------------------------------------------------------------------ */

/**
 * The last few visits, with the photo that proves each one.
 *
 * NOT the register. Review owns that — its filters, its paging, its seven
 * columns — and the hub links into it pre-filtered to this rep rather than
 * growing a second copy. What belongs here is the answer to "what has this
 * person been doing lately", which is a handful of rows.
 *
 * The institute name goes to the INSTITUTE, the row to the VISIT. Two
 * destinations because they are two questions, and the plan's whole point is
 * that a name gets you to the thing it names.
 */
export function RecentVisits({ visits }: { visits: VisitRow[] }) {
  if (visits.length === 0) {
    return (
      <EmptyState
        icon={FileTextIcon}
        title="No visits logged yet"
        description="Visits appear here the moment this rep saves one."
      />
    );
  }

  return (
    <Card className="divide-border gap-0 divide-y p-0 shadow-xs">
      {visits.map((visit) => (
        <div key={visit.id} className="flex items-center gap-3 px-4 py-3">
          {visit.photo ? (
            <VisitPhotoThumb
              photo={visit.photo}
              caption={`${visit.activityLabel} at ${visit.instituteName}`}
            />
          ) : (
            <div className="border-border size-16 shrink-0 rounded-md border border-dashed" />
          )}

          <div className="min-w-0 flex-1">
            <Link
              href={`/institutes/${visit.instituteId}`}
              className="focus-visible:ring-ring block truncate rounded-sm text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              {visit.instituteName}
            </Link>
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {formatDate(visit.date)} · {visit.activityLabel}
              {visit.standing && ` · ${visit.standing}`}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge variant={visit.reportedAt ? "success" : "neutral"}>
              {visit.reportedAt ? "Filed" : "No report"}
            </Badge>
            <Link
              href={`/review/${visit.id}`}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-xs underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
            >
              Open
            </Link>
          </div>
        </div>
      ))}
    </Card>
  );
}
