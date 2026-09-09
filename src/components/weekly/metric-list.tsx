import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricRow } from "@/components/weekly/metric-row";
import { EmptyState } from "@/components/states";
import { METRICS, type MetricCounts } from "@/lib/validation/weekly";

/**
 * All eight metrics for a week, read-only.
 *
 * The rep's Dashboard summary, the Weekly screen and the admin's drill-in all
 * render exactly this, so none of them can drift from the others.
 *
 * The `targets` and `committed` props are gone. There is no commitment to
 * compare against any more (docs/flow-redesign-plan.md, change 4), so the
 * empty state is no longer "you have not set targets" — a screen that told a
 * rep to go and set numbers would now be pointing at a form that does not
 * exist. It is "nothing recorded yet", which is a statement about the week
 * rather than an instruction.
 */
export function MetricList({
  title,
  achieved,
  description,
}: {
  title: string;
  achieved: MetricCounts;
  description?: string;
}) {
  const nothingYet = METRICS.every((metric) => achieved[metric.key] === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </CardHeader>
      <CardContent>
        {nothingYet ? (
          <EmptyState
            title="Nothing recorded yet this week"
            description="Visits you log will be counted here as the week goes on."
          />
        ) : (
          <div>
            {METRICS.map((metric) => (
              <MetricRow
                key={metric.key}
                label={metric.label}
                achieved={achieved[metric.key]}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
