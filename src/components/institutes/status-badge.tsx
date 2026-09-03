import { Badge } from "@/components/ui/badge";
import type { InstituteStatus } from "@/lib/validation/institute";

/**
 * Rule 4's six statuses, coloured by the semantic palette rather than by
 * arbitrary hue: anything "done" is green, anything merely "scheduled" is
 * amber, anything waiting on someone else is red, and no status yet is slate.
 */
const VARIANTS: Record<InstituteStatus, "success" | "warning" | "danger"> = {
  "First meeting done": "success",
  "Session done": "success",
  "Campus visit done": "success",
  "Session scheduled": "warning",
  "Campus visit scheduled": "warning",
  "Pending for management approval": "danger",
};

export function InstituteStatusBadge({
  status,
  className,
}: {
  status: InstituteStatus | null;
  className?: string;
}) {
  if (!status) {
    return (
      <Badge variant="neutral" className={className}>
        No status yet
      </Badge>
    );
  }
  return (
    <Badge variant={VARIANTS[status] ?? "neutral"} className={className}>
      {status}
    </Badge>
  );
}
