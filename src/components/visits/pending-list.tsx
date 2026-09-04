import Link from "next/link";
import { formatDate, todayISO } from "@/lib/dates";
import { CalendarIcon, ClockIcon, FileTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/states";
import type { PendingVisit } from "@/lib/visits";
import { activityLabelFor } from "@/lib/validation/visit";

/**
 * Rule 3's other half — everything still at "Set", oldest first.
 *
 * Closing one now opens its closing report rather than a four-field dialog: a
 * session that actually happened has more to say than a headcount, and the
 * report is what completes the visit.
 *
 * Admins see the whole team's open loops but cannot close them: the RLS update
 * policy is `member = auth.uid()`, and the account of a visit belongs to the
 * person who made it. Rather than offer a button that would always fail, the
 * row says whose it is.
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
        description="Sessions and campus visits you schedule will wait here until you close them off."
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

              <div className="mt-4">
                {mine ? (
                  <Button asChild className="h-11 w-full">
                    <Link href={`/pending/${visit.id}`}>
                      <FileTextIcon className="size-4" aria-hidden />
                      File the closing report
                    </Link>
                  </Button>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-muted-foreground text-xs">
                      Only {visit.memberName ?? "the owner"} can close this off.
                    </p>
                    <Button asChild variant="outline" className="h-11 shrink-0">
                      <Link href={`/pending/${visit.id}`}>Open</Link>
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
