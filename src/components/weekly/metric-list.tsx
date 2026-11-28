import { MetricRow } from "@/components/weekly/metric-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import { METRICS, type MetricCounts } from "@/lib/validation/weekly";
import type { StatusTargetValue } from "@/lib/validation/target-status-targets";

/**
 * All eight metrics for a week, read-only: the rep's Dashboard summary and the
 * admin's drill-in both show exactly this, so neither can drift from the
 * Targets tab.
 *
 * THE EMPTY STATE IS THE ONE JUDGEMENT CALL HERE. Before stage 2 a week with
 * no commitment showed nothing but "go and set some targets", which threw away
 * work the rep had actually done. After stage 2 there was no commitment to
 * show at all. This keeps both: the rows render whenever there is anything to
 * put in them — a target, a visit, or both — and the empty state appears only
 * when the week is genuinely blank on both counts. Rows with a target get a
 * bar; rows without one get their count, which MetricRow handles.
 *
 * `emptyDescription` exists because this card has two audiences. The default is
 * neutral, for the admin drilling into someone else's week — telling THEM to go
 * and set the numbers would be pointing at a form they do not have. The
 * Dashboard overrides it with the rep-facing sentence and supplies the button.
 */
export function MetricList({
  title,
  targets,
  achieved,
  statusTargets = [],
  description,
  emptyDescription = "Targets set for this week fill in as visits are logged.",
  emptyAction,
}: {
  title: string;
  targets: MetricCounts;
  achieved: MetricCounts;
  /** Extra numeric commitments have no achieved/progress UI in this phase. */
  statusTargets?: StatusTargetValue[];
  description?: string;
  /** Reworded when the reader is the person who can act on it. */
  emptyDescription?: string;
  /** Offered on the blank-week empty state, e.g. "Set this week's targets". */
  emptyAction?: React.ReactNode;
}) {
  const nothingAtAll =
    statusTargets.length === 0 &&
    METRICS.every(
      (metric) => targets[metric.key] === 0 && achieved[metric.key] === 0,
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </CardHeader>
      <CardContent>
        {nothingAtAll ? (
          <EmptyState
            title="Nothing set and nothing recorded yet"
            description={emptyDescription}
            action={emptyAction}
          />
        ) : (
          <div>
            {METRICS.map((metric) => (
              <MetricRow
                key={metric.key}
                label={metric.label}
                achieved={achieved[metric.key]}
                target={targets[metric.key]}
              />
            ))}
            {statusTargets.length > 0 && (
              <div className="mt-4 space-y-1 border-t pt-4">
                <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                  Target status targets
                </p>
                {statusTargets.map((target) => (
                  <div
                    key={target.statusName}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <span className="text-sm">{target.statusName}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {target.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
