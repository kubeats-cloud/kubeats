import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricRow } from "@/components/weekly/metric-row";
import { EmptyState } from "@/components/states";
import { METRICS, type MetricCounts } from "@/lib/validation/weekly";

/**
 * All nine metrics, read-only: the rep's Dashboard summary and the admin's
 * drill-in both show exactly this, so neither can drift from the Targets tab.
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
  /** False when no targets row exists yet for this member and period. */
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
            title="No commitment for this period yet"
            description="Set the numbers on the Targets tab and the bars will fill in as the period goes."
            action={emptyAction}
          />
        )}
      </CardContent>
    </Card>
  );
}
