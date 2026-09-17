"use client";

import { useEffect, useRef, useState } from "react";
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
import { assignVisit, startFollowUp } from "@/lib/visit-actions";
import { clearDraft, followUpDraftKey, readDraft } from "@/lib/drafts";
import { useDraft } from "@/lib/use-draft";
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

  /*
   * REOPEN THE PANEL THE DRAFT BELONGS TO.
   *
   * The purpose a rep chose is kept by StartFollowUp, but that component only
   * exists while its panel is open — so restoring the answer without restoring
   * WHICH panel was open would restore it into something that is not mounted.
   * This is the other half: the draft names its institute, and the panel it
   * belongs to opens again.
   *
   * Only for a row that is STILL HERE. Pending is recomputed on every request
   * and a follow-up can be closed by somebody else between the rep leaving and
   * coming back — an institute that has dropped off the list must not reopen a
   * panel for a row that is no longer on screen.
   *
   * Never for an admin: their panel is AssignFollowUp, which writes a plan row
   * for somebody else and has no draft of its own.
   */
  const restoredOpen = useRef(false);
  useEffect(() => {
    if (restoredOpen.current) return;
    restoredOpen.current = true;
    const draft = readDraft<FollowUpDraft>(followUpDraftKey());
    const stillListed =
      draft !== null && items.some((item) => item.instituteId === draft.instituteId);
    setOpen(!readOnly && draft !== null && stillListed ? draft.instituteId : null);
  }, [readOnly, items]);

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
                /* STAGE 5b — an admin can hand the chase back to the rep.
                   Still read-only in the sense that matters: nothing here puts
                   a visit on the ADMIN's day. It writes a plan row for the
                   institute's OWNER, who sees it on their dashboard badged as
                   assigned. */
                open === item.instituteId ? (
                  <AssignFollowUp
                    item={item}
                    purposes={purposes}
                    today={today}
                    onCancel={() => setOpen(null)}
                  />
                ) : (
                  <>
                    <p className="text-muted-foreground mt-3 text-xs">
                      {item.memberName
                        ? `${item.memberName} closes this by visiting again.`
                        : "This status was set directly rather than by a visit."}
                    </p>
                    {item.owner ? (
                      <div className="mt-4">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 w-full"
                          onClick={() => setOpen(item.instituteId)}
                        >
                          Assign this follow-up
                        </Button>
                      </div>
                    ) : (
                      /* No owner, nothing to assign to — and FO026 would refuse
                         the plan row anyway. Says so rather than offering a
                         button that cannot work. */
                      <p className="text-danger mt-3 text-xs">
                        Unassigned. Give this institute to a rep before
                        assigning a follow-up.
                      </p>
                    )}
                  </>
                )
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
 * A half-answered "Visit again", kept across a Back and a Forward.
 *
 * THE OPEN PANEL IS PART OF THE DRAFT, not context around it. Only one panel is
 * open at a time and it is closed by default, so restoring the chosen purpose
 * without also restoring WHICH institute it was chosen for would put the answer
 * somewhere the rep cannot see it. The institute id is therefore stored with
 * the purpose and the panel reopens with it.
 *
 * It is also what scopes the draft: a stored institute that is no longer in the
 * list — the follow-up was closed by somebody else, or the row has moved — is
 * ignored on read rather than reopening a panel for a row that is not there.
 */
interface FollowUpDraft {
  instituteId: string;
  purpose: string;
  note: string;
}

/** "Nothing chosen yet", so the restore effect has one path through it. */
const EMPTY_FOLLOW_UP: FollowUpDraft = { instituteId: "", purpose: "", note: "" };

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
  /*
   * THE SAME DRAFT RULE AS LOG VISIT, and it had the same bug.
   *
   * This was two `useState`s with a restore effect and a save effect racing it.
   * On a SOFT navigation — which is the only way anyone reaches this panel, so
   * the gap was total rather than intermittent — the panel remounted empty and
   * the save wrote that emptiness over the stored draft before the restore
   * landed. `useDraft` reads during the first render instead; its header has the
   * whole account.
   *
   * ONE DRAFT SLOT FOR EVERY INSTITUTE, so `accept` is what makes this panel
   * wear only its own. A key per institute would make that automatic and was
   * rejected for a worse problem: drafts for panels the rep has closed would
   * accumulate with nothing to clear them.
   *
   * `state` is the re-save trigger. The draft is cleared when the form is
   * dispatched, so a submission that comes back refused has to put it back.
   */
  const [draft, patchDraft] = useDraft(followUpDraftKey(), EMPTY_FOLLOW_UP, {
    resaveOn: state,
    accept: (stored) => stored.instituteId === item.instituteId,
  });
  const { purpose, note } = draft;

  // Carried on every change so the stored draft always says whose it is — the
  // `accept` above is what reads it back.
  const setField = (fields: { purpose?: string; note?: string }) =>
    patchDraft({ instituteId: item.instituteId, ...fields });

  const chosen = purposes.find((option) => option.label === purpose) ?? null;

  return (
    <form
      action={formAction}
      /*
       * CLEARED AT DISPATCH, for the reason Log Visit's is: a successful
       * `startFollowUp` redirects to the Dashboard, so this component is gone
       * before any success state could be read here. Nothing on screen is
       * cleared with it — the two setters are untouched — so a refusal leaves
       * the rep's answer in place, and the save effect above writes the draft
       * back as soon as `state` changes.
       */
      onSubmit={() => clearDraft(followUpDraftKey())}
      className="mt-4 space-y-3"
    >
      <input type="hidden" name="institute_id" value={item.instituteId} />
      <input type="hidden" name="purpose" value={purpose} />
      <input
        type="hidden"
        name="requires_note"
        value={chosen?.requiresNote ? "yes" : "no"}
      />

      <div className="space-y-1.5">
        <Label>What is this visit for?</Label>
        <Select
          value={purpose}
          onValueChange={(value) => setField({ purpose: value })}
        >
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
            onChange={(event) => setField({ note: event.target.value })}
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
        {/* Cancel is a decision, not a navigation: the rep has said they are
            not doing this now, so the draft goes with the panel. Without this
            it would reopen the next time they tapped "Visit again" on this
            institute, having been explicitly dismissed. */}
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          onClick={() => {
            clearDraft(followUpDraftKey());
            onCancel();
          }}
        >
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

/**
 * Stage 5b — an admin hands an open institute's follow-up back to its owner.
 *
 * REUSES `assignVisit`, WHICH IS THE POINT. This writes no plan row of its own
 * and knows nothing about `daily_plans`; it posts the same four fields the
 * Assign screen posts, to the same audited action. So the admin gate, the
 * purpose lookup that carries `purpose_id`, the `assigned_by` stamp, the
 * past-date refusal and the upsert's conflict key all apply here exactly as
 * they do there — and every guard below stays in force:
 *
 *   FO023  guard_plan_assignment — since 0028 the institute must BELONG to the
 *          assigned rep, not merely share their campus. Satisfied here by
 *          construction: `member` is the institute's own `registered_by`.
 *   FO026  enforce_plan_institute_owned — the same predicate again on the row
 *          itself, and again when the rep stamps their arrival. It is what
 *          catches the gap between this page being rendered and the button
 *          being pressed: reassign the institute in between and the assignment
 *          is refused rather than landing on the wrong rep's day.
 *   FO021/FO022 campus — untouched, and implied by ownership.
 *
 * THE REP IS NOT A CHOICE. An open institute has exactly one owner, and any
 * other rep would be refused by both guards above, so offering a picker would
 * be offering nine wrong answers and one right one. The owner is shown, not
 * chosen.
 *
 * THE PURPOSE IS a choice, and must be. Stage 3 derives the visit's activity
 * from `purpose_id`, so the purpose decides which weekly metric the rep's work
 * lands in — picking one on their behalf would be picking a number they are
 * measured on. Same reasoning as `StartFollowUp` above.
 */
function AssignFollowUp({
  item,
  purposes,
  today,
  onCancel,
}: {
  item: FollowUp;
  purposes: PurposeOption[];
  today: string;
  onCancel: () => void;
}) {
  const [state, formAction, isPending] = useActionState(assignVisit, EMPTY_STATE);
  const [purpose, setPurpose] = useState("");
  const [date, setDate] = useState(today);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <input type="hidden" name="institute_id" value={item.instituteId} />
      {/* The owner, never a picked rep — see the note above. */}
      <input type="hidden" name="member" value={item.owner ?? ""} />
      <input type="hidden" name="purpose" value={purpose} />
      <input type="hidden" name="date" value={date} />

      <p className="text-muted-foreground text-xs">
        Assigning to{" "}
        <span className="text-foreground font-medium">
          {item.ownerName ?? "this institute's rep"}
        </span>
        , who this institute belongs to.
      </p>

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

      <div className="space-y-1.5">
        <Label htmlFor={`assign-when-${item.instituteId}`}>When</Label>
        <Input
          id={`assign-when-${item.instituteId}`}
          type="date"
          className="h-11"
          min={today}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        {state.fieldErrors.date && (
          <p className="text-danger text-xs">{state.fieldErrors.date}</p>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          type="submit"
          className="h-11 flex-1"
          disabled={isPending || purpose === ""}
        >
          {isPending ? "Assigning…" : "Assign"}
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {state.ok && (
        <p
          role="status"
          className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
        >
          Assigned. It is on their plan for that day.
        </p>
      )}
      {state.error && <FormNotice message={state.error} />}
    </form>
  );
}
