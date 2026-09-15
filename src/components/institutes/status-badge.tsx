import { Badge } from "@/components/ui/badge";
import {
  statusRow,
  type StatusCatalogue,
} from "@/lib/validation/institute";

/**
 * An institute's status, coloured by the semantic palette.
 *
 * THE COLOUR IS DATA NOW. This held a nine-key `Record` mapping each status to
 * a variant, which stopped being possible the moment an admin could add one —
 * migration 0026 makes `institutes.status` a foreign key to
 * `public.institute_statuses`, and that table carries a `tone` column.
 *
 * It is a stored value and NOT a derivation, and that is the part worth
 * keeping: colour tracks the **outcome**, not the open/closed category. The two
 * are related and are not the same. "First meeting done" is green and still
 * open; deriving the colour from the category would paint it amber merely
 * because more work follows it. "Will not come" is deliberately slate rather
 * than red — red is for pending and overdue, and a firm no is neither. It is a
 * finished loop and gets the quietest treatment on the screen.
 *
 * A status the catalogue does not have falls back to neutral rather than
 * throwing. That is reachable for one render after an admin retires a status
 * the page was already holding, and a grey badge is a better answer than a
 * crash.
 */
export function InstituteStatusBadge({
  status,
  catalogue,
  className,
}: {
  status: string | null;
  /** The vocabulary, loaded from the database by the page that renders this. */
  catalogue: StatusCatalogue;
  className?: string;
}) {
  if (!status) {
    return (
      <Badge variant="neutral" className={className}>
        No status yet
      </Badge>
    );
  }

  const row = statusRow(catalogue, status);

  // The category rides along as a data attribute rather than as more colour:
  // it costs nothing, and it is what a timeline or a re-add flow keys off when
  // it wants to style a row.
  return (
    <Badge
      variant={row?.tone ?? "neutral"}
      className={className}
      data-status-category={row?.category ?? undefined}
    >
      {status}
    </Badge>
  );
}
