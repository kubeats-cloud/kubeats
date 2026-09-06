import { Badge } from "@/components/ui/badge";
import {
  type InstituteStatus,
  statusCategory,
} from "@/lib/validation/institute";

/**
 * Rule 4's nine statuses, coloured by the semantic palette rather than by
 * arbitrary hue: anything "done" is green, anything merely "scheduled" or
 * awaiting a reply is amber, anything waiting on someone else's decision is
 * red, and a closed-but-negative outcome is slate.
 *
 * Colour tracks the *outcome*, not the open/closed category — the two are
 * related but not the same, and conflating them would paint "First meeting
 * done" amber merely because more work follows it. The category is what
 * groups the dropdown and what features C and D will query; see
 * INSTITUTE_STATUS_CATALOGUE.
 *
 * "Will not come" is deliberately slate rather than red: red is reserved for
 * pending and overdue, and a firm no is neither. It is a finished loop, so it
 * gets the quietest treatment on the screen.
 */
const VARIANTS: Record<
  InstituteStatus,
  "success" | "warning" | "danger" | "neutral"
> = {
  "First meeting done": "success",
  "Session done": "success",
  "Campus visit done": "success",
  "RSVP received": "success",
  "Session scheduled": "warning",
  "Campus visit scheduled": "warning",
  "Invited principal for event": "warning",
  "Pending for management approval": "danger",
  "Will not come": "neutral",
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
  // The category rides along as a data attribute rather than as more colour:
  // it costs nothing, and it is what C's timeline and D's re-add flow will
  // want to key off when they style a row.
  return (
    <Badge
      variant={VARIANTS[status] ?? "neutral"}
      className={className}
      data-status-category={statusCategory(status) ?? undefined}
    >
      {status}
    </Badge>
  );
}
