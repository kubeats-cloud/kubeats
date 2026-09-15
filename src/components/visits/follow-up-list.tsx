"use client";

import { useState } from "react";
import { CalendarIcon, ClockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/states";
import { FormNotice } from "@/components/form-notice";
import { cn } from "@/lib/utils";
import { formatDate, todayISO } from "@/lib/dates";
import { startFollowUp } from "@/lib/visit-actions";
import { EMPTY_STATE } from "@/lib/visit-form-state";
import { statusRow, type StatusCatalogue } from "@/lib/validation/institute";
import type { FollowUp, PurposeOption } from "@/lib/visits";
import { useActionState } from "react";

/**
 * What is still owed — one row per institute still in play.
 *
 * WHAT THIS REPLACED. Pending listed visits sitting at `lifecycle_status =
 * 'Set'`: sessions and campus visits promised and not yet held. That was one
 * kind of owing and it missed every other — a first meeting nobody chased, an
 * approval nobody came back on, an invitation with no answer. Those are the
 * statuses the vocabulary calls OPEN, so that is the question now.
 *
 * IT IS NO LONGER A NOTICE BOARD. Through stage 3 this screen had no action for
 * anybody: a loop was closed by going back to the institute, and Pending merely
 * said which. That was right while "closing" meant completing a specific
 * promised session. It is not right now — every row here is a school somebody
 * has to return to, and the return is the same ordinary visit every time.
 *
 * So a rep taps a row and gets one. The flow that follows is the CHAIN, not a
 * copy of it: `startFollowUp()` puts the institute on today's plan and hands
 * straight back to the Dashboard, where the rep checks in exactly as they would
 * for anything else. Photo, presence guarantee, meeting gate, report — all
 * unchanged. Pending is a new way in, not a second way through.
 *
 * AN ADMIN GETS NO SUCH CONTROL (decision D10). An admin has no campus and does
 * not do field visits, so a launch would put the visit on the admin's own day.
 * They see the same list, read-only, across every campus.
 */
export function FollowUpList({
  items,
  purposes,
  catalogue,
  readOnly,
}: {
  items: FollowUp[];
  /** Offered when starting a follow-up. Empty for an admin, who cannot. */
  purposes: PurposeOption[];
  catalogue: StatusCatalogue;
  /** True for an admin: the whole team's list, and nothing to tap. */
  readOnly: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ClockIcon}
        title="Nothing owed"
        description={
          readOnly
            ? "No institute across the team is waiting on a follow-up."
            : // "yours", not "your campus": after 0028 a rep's Pending is
              // their own institutes, not their campus's. The query did not
              // change — it reads institutes through RLS, and RLS narrowed.
              "Every institute of yours is either finished or has not been visited yet. Anything you leave open will appear here."
        }
      />
    );
  }

  const today = todayISO();

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        // Compared as plain YYYY-MM-DD strings, which sort correctly and cannot
        // be dragged across a day boundary by whichever timezone the code is
        // running in. dates.ts is the only thing that formats one.
        const overdue = item.followUpDate !== null && item.followUpDate < today;
        const row = statusRow(catalogue, item.status);

        return (
          <li key={item.instituteId}>
            <Card
              className={cn(
                "gap-0 p-5",
                overdue && "border-l-danger rounded-l-sm border-l-2",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] leading-tight font-semibold tracking-tight">
                    {item.instituteName}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {item.city ?? "—"}
                    {/* Whose loop it is. Said only when it is NOT the viewer's:
                        a rep does not need telling that their own visit was
                        theirs, and an admin needs telling every time. */}
                    {!item.mine && item.memberName ? ` · ${item.memberName}` : ""}
                  </p>
                </div>
                <Badge variant={row?.tone ?? "neutral"} className="shrink-0">
                  {item.status}
                </Badge>
              </div>

              <p
                className={cn(
                  "mt-3 flex items-center gap-1.5 text-xs",
                  overdue ? "text-danger font-medium" : "text-muted-foreground",
                )}
              >
                <CalendarIcon className="size-3.5" aria-hidden />
                {item.followUpDate
                  ? `${overdue ? "Was due" : "Due"} ${formatDate(item.followUpDate)}`
                  : /* Reachable two ways, both honest rather than hidden: a
                       visit logged before Rule 5 demanded a date, or a status
                       set without a visit this viewer can see. */
                    "No follow-up date recorded"}
              </p>

              {/* The session or campus visit's own date, when the status
                  carries one — a different fact from the chase date, and the
                  one a rep is actually turning up for. */}
              {item.expectedDate && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Scheduled for {formatDate(item.expectedDate)}
                </p>
              )}

              {item.notes && (
                <p className="text-muted-foreground mt-3 line-clamp-2 text-sm leading-relaxed">
                  {item.notes}
                </p>
              )}

              {readOnly ? (
                <p className="text-muted-foreground mt-3 text-xs">
                  {item.memberName
                    ? `${item.memberName} closes this by visiting again.`
                    : "This status was set directly rather than by a visit."}
                </p>
              ) : open === item.instituteId ? (
                <StartFollowUp
                  item={item}
                  purposes={purposes}
                  onCancel={() => setOpen(null)}
                />
              ) : (
                <div className="mt-4">
                  <Button
                    type="button"
                    className="h-11 w-full"
                    onClick={() => setOpen(item.instituteId)}
                  >
                    Visit again
                  </Button>
                </div>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The one question starting a follow-up has to ask.
 *
 * THE PURPOSE, AND NEVER SILENTLY. After stage 3 the purpose decides the visit's
 * activity, and therefore which weekly metric the work lands in — so picking one
 * on the rep's behalf would be picking a number they are measured on. The
 * institute is already decided by the row that was tapped, which is the whole
 * point of starting here rather than on the Dashboard.
 */
function StartFollowUp({
  item,
  purposes,
  onCancel,
}: {
  item: FollowUp;
  purposes: PurposeOption[];
  onCancel: () => void;
}) {
  const [state, formAction, isPending] = useActionState(startFollowUp, EMPTY_STATE);
  const [purpose, setPurpose] = useState("");
  const [note, setNote] = useState("");

  const chosen = purposes.find((option) => option.label === purpose) ?? null;

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <input type="hidden" name="institute_id" value={item.instituteId} />
      <input type="hidden" name="purpose" value={purpose} />
      <input
        type="hidden"
        name="requires_note"
        value={chosen?.requiresNote ? "yes" : "no"}
      />

      <div className="space-y-1.5">
        <Label>What is this visit for?</Label>
        <Select value={purpose} onValueChange={setPurpose}>
          <SelectTrigger
            className="h-11 w-full"
            aria-label="Purpose"
            aria-invalid={state.fieldErrors.purpose ? true : undefined}
          >
            <SelectValue placeholder="Purpose of the visit" />
          </SelectTrigger>
          <SelectContent>
            {purposes.map((option) => (
              <SelectItem key={option.id} value={option.label}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {state.fieldErrors.purpose && (
          <p className="text-danger text-xs">{state.fieldErrors.purpose}</p>
        )}
      </div>

      {chosen?.requiresNote && (
        <div className="space-y-1.5">
          <Input
            name="purpose_note"
            className="h-11"
            maxLength={300}
            placeholder="What is this visit for?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-label="What is this visit for?"
          />
          {state.fieldErrors.purpose_note && (
            <p className="text-danger text-xs">{state.fieldErrors.purpose_note}</p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" className="h-11 flex-1" disabled={isPending}>
          {isPending ? "Starting…" : "Add to today's plan"}
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {/* Said here rather than on the Dashboard, because this is where the rep
          decided to go — and because the next step is theirs to take. */}
      <p className="text-muted-foreground text-xs">
        This puts {item.instituteName} on today&rsquo;s plan. Check in there when
        you arrive.
      </p>

      {state.error && <FormNotice message={state.error} />}
    </form>
  );
}
