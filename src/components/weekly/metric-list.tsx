import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricRow } from "@/components/weekly/metric-row";
import { EmptyState } from "@/components/states";
import { METRICS, type MetricCounts } from "@/lib/validation/weekly";

/**
 * All eight metrics, read-only: the rep's Dashboard summary and the admin's
 * drill-in both show exactly this, so neither can drift from the Weekly tab.
 */
export function MetricList({
  title,
  targets,
  achieved,
  committed,
  emptyAction,
}: {
  title: string;
  targets: MetricCounts;
  achieved: MetricCounts;
  /** False when no weekly_targets row exists yet for this member and week. */
  committed: boolean;
  emptyAction?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {committed ? (
          <div className="space-y-4">
            {METRICS.map((metric) => (
              <MetricRow
                key={metric.key}
                label={metric.label}
                achieved={achieved[metric.key]}
                target={targets[metric.key]}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No commitment for this week yet"
            description="Set the eight numbers on the Weekly tab and the bars will fill in as the week goes."
            action={emptyAction}
          />
        )}
      </CardContent>
    </Card>
  );
}
