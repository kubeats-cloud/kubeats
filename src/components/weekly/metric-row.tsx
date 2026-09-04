import { Progress } from "@/components/ui/progress";
import {
  TONE_BAR,
  percentOf,
  toneFor,
} from "@/lib/validation/weekly";
import { cn } from "@/lib/utils";

/**
 * One metric's target-vs-achieved bar.
 *
 * Shared by the Weekly tab and the Dashboard on purpose: the two screens show
 * the same numbers, and a rep who sees them disagree stops trusting both.
 */
export function MetricRow({
  label,
  achieved,
  target,
  showPercent = false,
  className,
}: {
  label: string;
  achieved: number;
  target: number;
  showPercent?: boolean;
  className?: string;
}) {
  const tone = toneFor(achieved, target);
  const pct = percentOf(achieved, target);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground text-sm">{label}</span>
        {showPercent ? (
          <span className="text-sm font-semibold tabular-nums">
            {target > 0 ? `${pct}%` : "—"}
          </span>
        ) : (
          <span className="text-sm font-semibold tabular-nums">
            {achieved} / {target}
          </span>
        )}
      </div>
      <Progress
        value={pct}
        indicatorClassName={TONE_BAR[tone]}
        aria-label={`${label}: ${achieved} of ${target}`}
      />
    </div>
  );
}
