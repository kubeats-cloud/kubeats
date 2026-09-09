import { formatDate, todayISO } from "@/lib/dates";
import { CalendarIcon, ClockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import type { PendingVisit } from "@/lib/visits";
import { activityLabelFor } from "@/lib/validation/visit";

/**
 * Rule 3's other half — everything still at "Set" and not yet closed, oldest
 * first.
 *
 * A READ-ONLY NOTICE BOARD as of stage 3. There is no button here any more,
 * for anybody, because closing a loop is no longer something you do to a list:
 * a "Set" session is completed by going back to the institute, checking in and
 * logging the visit that completes it, which is the same chain as every other
 * visit. The feedback form on that visit offers the open loop and closes it.
 *
 * So this screen answers one question — what is still owed — and hands the
 * answer to the Dashboard, which is where work starts.
 */
export function PendingList({
  visits,
  currentUserId,
}: {
  visits: PendingVisit[];
  currentUserId: string;
}) {
  if (visits.length === 0) {
    return (
      <EmptyState
        icon={ClockIcon}
        title="No open loops"
        description="Sessions and campus visits you schedule wait here until you go back and complete them."
      />
    );
  }

  // Compared as plain YYYY-MM-DD strings, which sort correctly and cannot be
  // dragged across a day boundary by whichever timezone the code is running in.
  // The Date arithmetic this replaces read the due date as UTC midnight and
  // "today" as the server's local midnight — two different calendars, and a
  // loop that fell due at 05:30 IST rather than at midnight.
  const today = todayISO();

  return (
    <ul className="space-y-3">
      {visits.map((visit) => {
        const due = visit.expected_date ?? visit.date;
        const overdue = due < today;
        const mine = visit.member === currentUserId;

        return (
          <li key={visit.id}>
            {/* An overdue loop earns a red edge, not a redesign: one strip of
                colour is enough to find it while scrolling, and the card stays
                the same shape as the ones that are merely scheduled. */}
            <Card
              className={cn(
                "gap-0 p-5",
                overdue && "border-l-danger rounded-l-sm border-l-2",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] leading-tight font-semibold tracking-tight">
                    {visit.instituteName}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {activityLabelFor(visit.activity)}
                    {!mine && visit.memberName ? ` · ${visit.memberName}` : ""}
                  </p>
                </div>
                <Badge variant={overdue ? "danger" : "warning"} className="shrink-0">
                  {overdue ? "Overdue" : "Scheduled"}
                </Badge>
              </div>

              <p
                className={cn(
                  "mt-3 flex items-center gap-1.5 text-xs",
                  overdue ? "text-danger font-medium" : "text-muted-foreground",
                )}
              >
                <CalendarIcon className="size-3.5" aria-hidden />
                Expected {formatDate(visit.expected_date ?? visit.date)}
              </p>

              {visit.notes && (
                <p className="text-muted-foreground mt-3 line-clamp-2 text-sm leading-relaxed">
                  {visit.notes}
                </p>
              )}

              {/* No action. Closing happens by visiting the institute again,
                  not from here — see the note at the top of this file. */}
              <p className="text-muted-foreground mt-3 text-xs">
                {mine
                  ? "Closed by visiting again: check in at this institute and log the visit that completes it."
                  : `${visit.memberName ?? "The owner"} closes this by visiting again.`}
              </p>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
