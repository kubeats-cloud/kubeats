import { formatDateTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { InstituteStatusBadge } from "@/components/institutes/status-badge";
import {
  type StatusCatalogue,
  type StatusCategory,
  statusCategory,
} from "@/lib/validation/institute";
import type { StatusChange } from "@/lib/status-history";

/**
 * The status journey (feature C), newest first.
 *
 * Newest first because the top of this list is where the institute stands
 * today, which is the question a rep opening the page is actually asking; the
 * history below it is context. It also matches the visit list further down the
 * page, so the two read the same way.
 *
 * The rail and dots are a border and a few rounded spans — no timeline
 * library, and nothing here that a card and a badge could not already do.
 */

/**
 * The dot colour says open or closed; the badge beside it keeps the status's
 * own colour, which tracks the OUTCOME. The two differ on purpose — "First
 * meeting done" is a green badge on an amber dot — so the word is always
 * printed next to the dot rather than leaving colour to carry the meaning
 * alone.
 */
const DOT: Record<StatusCategory, string> = {
  open: "bg-warning",
  closed: "bg-success",
};

export function StatusTimeline({
  changes,
  currentStatus,
  currentCallStatus,
  catalogue,
  callCatalogue,
}: {
  changes: StatusChange[];
  /** Used only to mark the newest VISIT entry as where things stand now. */
  currentStatus: string | null;
  /** The same question for the CALL track (0072). */
  currentCallStatus: string | null;
  /** The visit vocabulary, loaded from the database by the page. */
  catalogue: StatusCatalogue;
  /** The call vocabulary — a second list since 0070, not an alias. */
  callCatalogue: StatusCatalogue;
}) {
  return (
    <ol className="border-border ml-1 space-y-4 border-l pl-5">
      {changes.map((change, index) => {
        /*
         * THE CATALOGUE FOLLOWS THE TRACK, not the newest entry. A call status
         * and a visit status may share a spelling today and mean different
         * things after an admin edits one list, so colouring (and the
         * open/closed word) must come from the vocabulary this line belongs to.
         */
        const vocabulary = change.source === "call" ? callCatalogue : catalogue;
        const category = statusCategory(vocabulary, change.status);
        const isCurrent =
          change.status ===
            (change.source === "call" ? currentCallStatus : currentStatus) &&
          changes.findIndex((c) => c.source === change.source) === index;

        return (
          <li key={change.id} className="relative">
            <span
              aria-hidden
              className={`ring-background absolute top-1.5 -left-[26px] size-2.5 rounded-full ring-4 ${
                category ? DOT[category] : "bg-neutral"
              }`}
            />

            <div className="flex flex-wrap items-center gap-2">
              <InstituteStatusBadge status={change.status} catalogue={vocabulary} />
              {/* Which track a line came from. Without it the two histories
                  interleave into one list in which a Call and a Visit status
                  are indistinguishable. */}
              <Badge variant="neutral">
                {change.source === "call" ? "Call" : "Visit"}
              </Badge>
              {isCurrent && <Badge variant="secondary">Current</Badge>}
            </div>

            <p className="text-muted-foreground mt-1 text-xs">
              {category && <span className="capitalize">{category}</span>}
              {category && " · "}
              {formatDateTime(change.changedAt)}
              {" · "}
              {change.changedByName ??
                (change.changedBy ? "a team member" : "not recorded")}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
