import { cn } from "@/lib/utils";

/**
 * One metric's count for the week.
 *
 * It used to be a target-vs-achieved bar: "3 / 8" with a progress bar coloured
 * by how close the two were. Stage 2 of the redesign removed the target, and
 * with it the only thing a bar could measure — a bar with no target is either
 * always empty or always full, and both are lies.
 *
 * So this is now a label and a number. The number is deliberately the loudest
 * thing in the row: it is the whole content, and a rep reading their week
 * should be able to take it in at a glance rather than decode a chart.
 *
 * Shared by the Weekly screen and the Dashboard on purpose: the two show the
 * same figures, and a rep who sees them disagree stops trusting both.
 */
export function MetricRow({
  label,
  achieved,
  className,
}: {
  label: string;
  achieved: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 border-b border-border py-2.5 last:border-0",
        className,
      )}
    >
      <span className="text-muted-foreground text-sm">{label}</span>
      <span
        className={cn(
          "text-base font-semibold tabular-nums",
          // Zero is real information, but it is not an achievement — it should
          // not shout as loudly as a number the rep earned.
          achieved === 0 && "text-muted-foreground font-normal",
        )}
      >
        {achieved}
      </span>
    </div>
  );
}
