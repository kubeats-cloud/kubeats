import { Progress } from "@/components/ui/progress";
import { TONE_BAR, percentOf, toneFor } from "@/lib/validation/weekly";
import { cn } from "@/lib/utils";

/**
 * One metric's target-vs-achieved bar.
 *
 * Shared by the Targets tab and the Dashboard on purpose: the two screens show
 * the same numbers, and a rep who sees them disagree stops trusting both.
 *
 * A METRIC WITH NO TARGET GETS NO BAR. That case did not exist before stage 2
 * — a week either had a commitment or the whole card was replaced by an empty
 * state — and it exists now because the week screen keeps showing what was
 * actually recorded whether or not anything was promised. "3 / 0" with a full
 * green bar would be a lie in both halves, so an uncommitted metric renders as
 * the stage 2 row did: the label, the count, and nothing measuring it.
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
  if (target <= 0) {
    return (
      <div
        className={cn(
          "border-border flex items-baseline justify-between gap-3 border-b py-2.5 last:border-0",
          className,
        )}
      >
        <span className="text-muted-foreground text-sm">{label}</span>
        <span
          className={cn(
            "text-base font-semibold tabular-nums",
            // Zero is real information, but it is not an achievement — it
            // should not shout as loudly as a number the rep earned.
            achieved === 0 && "text-muted-foreground font-normal",
          )}
        >
          {achieved}
        </span>
      </div>
    );
  }

  const tone = toneFor(achieved, target);
  const pct = percentOf(achieved, target);

  return (
    <div className={cn("space-y-1.5 py-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground text-sm">{label}</span>
        {showPercent ? (
          <span className="text-sm font-semibold tabular-nums">{pct}%</span>
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
