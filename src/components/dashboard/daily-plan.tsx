"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2Icon, PlusIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/states";
import { CheckInButton } from "@/components/dashboard/check-buttons";
import { addToDailyPlan, removeFromDailyPlan } from "@/lib/visit-actions";
import { EMPTY_STATE, type FormState } from "@/lib/visit-form-state";
import type { PickerInstitute, PlanEntry, PurposeOption } from "@/lib/visits";
import {
  dailyPlanFormDataToInput,
  dailyPlanSchema,
  dailyPlanSummary,
  visitFieldErrors,
} from "@/lib/validation/visit";
import {
  institutePickerLabel,
  reopeningInstitute,
  type StatusCatalogue,
} from "@/lib/validation/institute";
import {
  formatDuration,
  visitMinutes,
  visitStatusOf,
} from "@/lib/validation/checkin";
import { FormNotice } from "@/components/form-notice";

/**
 * Today's plan, which the Dashboard owns (see CLAUDE.md).
 *
 * This is not a convenience list. The meeting gate checks a visit against these
 * rows, so an institute that never gets planned here can never have a meeting
 * logged against it at all.
 */
export function DailyPlan({
  institutes,
  purposes,
  entries,
  catalogue,
}: {
  institutes: PickerInstitute[];
  purposes: PurposeOption[];
  entries: PlanEntry[];
  /** The status vocabulary, for the closed-institute warning and its label. */
  catalogue: StatusCatalogue;
}) {
  const [state, formAction, isPending] = useActionState(
    addToDailyPlan,
    EMPTY_STATE,
  );
  const [clientState, setClientState] = useState<FormState>(EMPTY_STATE);
  const [instituteId, setInstituteId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [purposeNote, setPurposeNote] = useState("");
  const [removing, startRemoving] = useTransition();

  /**
   * The purpose row behind the chosen label.
   *
   * Matched on the label because that is what the Select's value is and what
   * `daily_plans.purpose` stores. Labels are UNIQUE in the database, so this
   * cannot be ambiguous — and `purpose_id` is what the action writes, so the
   * label is never the key anything durable depends on.
   */
  const chosen = purposes.find((option) => option.label === purpose) ?? null;

  // One attempt is being explained at a time, and the summary has to come from
  // the same attempt as the inline messages under the fields. Reading
  // `state.error ?? clientState.error` across two objects can pair a server
  // summary with stale client field errors, which is how a form starts
  // contradicting itself.
  const shown = state.error ? state : clientState;

  // A complaint about a field the rep has since answered is worse than no
  // complaint at all — it marks a filled-in field red and makes them press the
  // button again just to learn they had already fixed it. So a field-level
  // message lives exactly as long as the field is still empty, whether the
  // complaint came from the check below or from the server, and the summary is
  // recomputed from whatever is genuinely still missing. Errors that belong to
  // no field — an expired session, a database that would not take the row —
  // pass through untouched, because nothing the rep types clears those.
  const answered: Record<string, boolean> = {
    institute_id: instituteId !== "",
    purpose: purpose !== "",
    purpose_note: purposeNote.trim() !== "",
  };
  const fieldErrors = Object.fromEntries(
    Object.entries(shown.fieldErrors).filter(([key]) => !answered[key]),
  );
  const stillMissing = Object.keys(fieldErrors).length;
  const error = Object.keys(shown.fieldErrors).length
    ? stillMissing
      ? dailyPlanSummary(fieldErrors)
      : null
    : shown.error;
  /**
   * Split by what the VISIT is doing, not by meetings_actual.
   *
   * It used to be `meetings_actual !== null`, and that quietly mis-sorted every
   * activity except a meeting. Rule 7 sets meetings_actual for meetings alone,
   * so a session that had been logged, filed and checked out still counted as
   * "not held" — it sat in the open list, rendered as "In progress" with a
   * Continue button, and never showed its duration. A rep would have been told
   * a finished visit was still running, and the one tap offered led nowhere.
   *
   * visitStatusOf() is the same question the database answers with
   * plan_visit_status(), so this now sorts on the fact rather than on a proxy
   * for it that only held for one activity.
   */
  const statusOf = (entry: PlanEntry) =>
    visitStatusOf({
      checkinAt: entry.checkinAt,
      checkoutAt: entry.checkoutAt,
      checkoutMissing: entry.checkoutMissing,
    });

  const done = entries.filter((entry) => statusOf(entry) === "Completed");
  const open = entries.filter((entry) => statusOf(entry) !== "Completed");

  /**
   * "Visit 2 of 3" — which institutes appear more than once today, and where
   * each entry sits in its own sequence.
   *
   * Migration 0033 lets a rep plan one school several times in a day, so the
   * list can now hold two rows reading "St Xavier's · Follow-up" with nothing
   * to tell them apart. Two identical rows where one has a Continue button and
   * the other is finished is the kind of ambiguity that gets a rep to tap the
   * wrong one.
   *
   * NUMBERED OLDEST-FIRST, so "visit 1" is the morning one and the numbering
   * matches the order the day actually happened in. `getTodayPlan` returns
   * newest-first, hence the reverse.
   *
   * COMPUTED OVER `entries`, NOT over the split lists, so a morning visit that
   * has finished and an afternoon one still running are numbered 1 and 2
   * against each other rather than each being "1 of 1" in its own column.
   *
   * NO TIMES HERE, deliberately. An arrival time would disambiguate too, and
   * CLAUDE.md is explicit that a rep does not see a clock against their own
   * name while they are mid-visit — the arrival is captured, shown to admins
   * and shown on the finished record, and not read back to them in the
   * building. A sequence number says which is which and carries no clock.
   */
  const sequence = useMemo(() => {
    const byInstitute = new Map<string, string[]>();
    for (const entry of [...entries].reverse()) {
      const seen = byInstitute.get(entry.institute_id);
      if (seen) seen.push(entry.id);
      else byInstitute.set(entry.institute_id, [entry.id]);
    }

    const placed = new Map<string, { index: number; total: number }>();
    for (const ids of byInstitute.values()) {
      // A single visit needs no label at all — that is the ordinary day, and
      // numbering it "1 of 1" would be noise on every row.
      if (ids.length < 2) continue;
      ids.forEach((id, i) => placed.set(id, { index: i + 1, total: ids.length }));
    }
    return placed;
  }, [entries]);

  // #7 — one active visit at a time. Whichever entry is checked in and not yet
  // checked out is holding this rep; every other Check in button says so
  // instead of offering a tap the database would refuse (FO013).
  const openElsewhere =
    entries.find((entry) => statusOf(entry) === "In Progress") ?? null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const parsed = dailyPlanSchema.safeParse(
      dailyPlanFormDataToInput(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      // Stops the server action as well: React skips a form action when the
      // submit event has been prevented. Nothing is added, and now the rep is
      // told why rather than watching the button do nothing.
      event.preventDefault();
      const problems = visitFieldErrors(parsed.error);
      setClientState({ error: dailyPlanSummary(problems), fieldErrors: problems });
      return;
    }
    setClientState(EMPTY_STATE);
    // The row is upserted, so re-planning the same institute just corrects the
    // purpose. Clearing the picker afterwards keeps the next entry quick.
    //
    // LEFT ON `action={formAction}` DELIBERATELY, unlike the visit form and the
    // four others that were moved to a manual dispatch. React resets a form
    // after its action runs and Radix Selects revert to their mount value when
    // it does (log-visit-form.tsx has the chain), but here that cannot produce
    // wrong data:
    //
    //   * both pickers mount EMPTY, so a revert is a revert to nothing, and
    //     dailyPlanSchema refuses an empty institute or purpose with a sentence.
    //     It fails loudly. The visit form's danger was reverting to a VALID
    //     value that submitted happily and said nothing.
    //   * a client-side refusal calls preventDefault above, which skips the
    //     action entirely, so no reset fires on the common failure at all.
    //   * clearing after a successful add is the WANTED behaviour, and it is
    //     done here in code rather than left to the reset.
    //
    // Being exact about "only on success", because it is not quite: this clears
    // on any client-VALID attempt, so a server-side refusal (an expired
    // session, an institute deleted underneath) also empties the pickers and
    // the rep re-picks. That is a re-pick, not a wrong row, and separating the
    // two would mean tracking the result in an effect for a case worth less
    // than the machinery.
    setInstituteId("");
    setPurpose("");
    setPurposeNote("");
  }

  const canAdd = institutes.length > 0 && purposes.length > 0;

  // Non-null only when the selected institute's loop is already finished —
  // the one case worth saying something about before the rep hits Add.
  const reopening = reopeningInstitute(catalogue, institutes, instituteId);

  return (
    <Card>
      <CardHeader>
        {/* The held/planned counts live in the snapshot tiles above; repeating
            them here would only give them a chance to disagree. */}
        <CardTitle className="text-base">Today&rsquo;s plan</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {canAdd ? (
          <form action={formAction} onSubmit={handleSubmit} className="space-y-3">
            <input type="hidden" name="institute_id" value={instituteId} />
            <input type="hidden" name="purpose" value={purpose} />

            <div className="space-y-1.5">
              <Select value={instituteId} onValueChange={setInstituteId}>
                <SelectTrigger
                  className="h-11 w-full"
                  aria-label="Institute"
                  aria-invalid={fieldErrors.institute_id ? true : undefined}
                  aria-describedby={
                    fieldErrors.institute_id ? "plan-institute-error" : undefined
                  }
                >
                  <SelectValue placeholder="Institute" />
                </SelectTrigger>
                <SelectContent>
                  {institutes.map((institute) => (
                    <SelectItem key={institute.id} value={institute.id}>
                      {institutePickerLabel(catalogue, institute)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="plan-institute-error" message={fieldErrors.institute_id} />
            </div>

            {/* Re-adding a closed institute is how a new cycle of engagement
                starts. It was always allowed; this says so out loud, and says
                what it does NOT do — planning never moves a status (rule 4). */}
            {reopening && (
              <p className="bg-warning-subtle text-warning-subtle-foreground rounded-md px-3 py-2 text-xs">
                <span className="font-medium">{reopening.name}</span> is closed
                &mdash; {reopening.status}. Adding it starts a fresh cycle. Its
                status stays as it is until your next visit changes it.
              </p>
            )}

            {/*
              THE PURPOSE NOW DECIDES THE VISIT, not just labels it.
              Stage 3 derives the activity — and therefore which weekly metric
              the visit feeds, and whether the meeting gate applies — from this
              choice, through purposes.activity (0024) and purposes.lifecycle
              (0025). It used to be a subtitle on a card.

              So the option says what it will count as. A rep choosing
              "Fix a session" should be able to see that it lands in Sessions
              Set before they commit, rather than discovering it on the Targets
              screen at the end of the week.
            */}
            <div className="space-y-1.5">
              <Select value={purpose} onValueChange={setPurpose}>
                <SelectTrigger
                  className="h-11 w-full"
                  aria-label="Purpose"
                  aria-invalid={fieldErrors.purpose ? true : undefined}
                  aria-describedby={
                    fieldErrors.purpose ? "plan-purpose-error" : undefined
                  }
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
              <FieldError id="plan-purpose-error" message={fieldErrors.purpose} />
            </div>

            {/* "Other" — and anything an admin marks the same way — has to say
                what it actually is. Without it the plan reads "Other" and the
                visit is logged as a meeting with nothing to explain it. */}
            <input
              type="hidden"
              name="requires_note"
              value={chosen?.requiresNote ? "yes" : "no"}
            />
            {chosen?.requiresNote && (
              <div className="space-y-1.5">
                <Input
                  name="purpose_note"
                  className="h-11"
                  maxLength={300}
                  placeholder="What is this visit for?"
                  value={purposeNote}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPurposeNote(event.target.value)}
                  aria-label="What is this visit for?"
                  aria-invalid={fieldErrors.purpose_note ? true : undefined}
                  aria-describedby={
                    fieldErrors.purpose_note ? "plan-purpose-note-error" : undefined
                  }
                />
                <FieldError
                  id="plan-purpose-note-error"
                  message={fieldErrors.purpose_note}
                />
              </div>
            )}

            <Button type="submit" className="h-11 w-full" disabled={isPending}>
              <PlusIcon className="size-4" aria-hidden />
              {isPending ? "Adding…" : "Add to today's plan"}
            </Button>

            {error && (
              <FormNotice message={error} />
            )}
          </form>
        ) : (
          <p className="bg-warning-subtle text-warning-subtle-foreground rounded-md px-3 py-2 text-sm">
            {institutes.length === 0
              ? "Register an institute before planning a visit."
              : "No meeting purposes have been set up yet. Ask an admin to add some."}
          </p>
        )}

        {entries.length === 0 ? (
          <EmptyState
            title="Nothing planned yet today"
            description="Add the institutes you intend to visit. A meeting can only be logged for one that is on this list."
          />
        ) : (
          <ul className="space-y-2">
            {open.map((entry) => (
              <li
                key={entry.id}
                /*
                  STACKS ON A PHONE, SIDE BY SIDE FROM sm.

                  This was a single `flex ... justify-between` row whose right
                  half was `shrink-0`. That is fine while the right half is a
                  button, and it is what broke the moment the right half became
                  a sentence: CheckInButton renders a guidance box up to 256px
                  wide, which cannot fit beside anything inside a card that is
                  itself about 256px wide on a 360px phone. The rail could not
                  shrink, so the text ran off the right edge and the button
                  beside it was clipped at the card border.

                  Stacking below sm removes the competition for width entirely.
                */
                className="border-border flex flex-col items-stretch gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {entry.instituteName}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {entry.purpose}
                    <VisitSequence at={sequence.get(entry.id)} />
                  </p>
                  {entry.assignedBy && (
                    <Badge variant="neutral" className="mt-1">
                      Assigned by {entry.assignedByName ?? "an admin"}
                    </Badge>
                  )}
                </div>
                <div className="flex w-full min-w-0 flex-col items-stretch gap-1 sm:w-auto sm:shrink-0 sm:items-end">
                  {/* The presence guarantee, in the order it happens: check in,
                      then log, then check out. Log is not offered before
                      check-in because the database would refuse it anyway
                      (FO009) — better to not present a button that cannot work
                      than to explain the refusal afterwards. */}
                  {statusOf(entry) === "Scheduled" ? (
                    <CheckInButton
                      planId={entry.id}
                      instituteName={entry.instituteName}
                      blockedBy={
                        openElsewhere && openElsewhere.id !== entry.id
                          ? openElsewhere.instituteName
                          : null
                      }
                    />
                  ) : (
                    <div className="flex w-full flex-col items-stretch gap-1 sm:items-end">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="warning">In progress</Badge>
                        {/* The whole recovery path, and the reason there is no
                            "abandon" button: a rep who was interrupted comes
                            back to the same visit and finishes it. */}
                        <Button asChild className="h-11 flex-1 sm:flex-none">
                          <Link href={`/log?plan=${entry.id}`}>Continue</Link>
                        </Button>
                      </div>
                      {/* The "No location" badge used to sit here, on the
                          rep's own in-progress entry. It told them nothing they
                          could act on — they had already typed the reason
                          themselves a moment earlier — and a warning badge
                          against your own visit for the rest of the morning
                          reads as a mark against you. Admins still see it, on
                          the Still checked in panel and in the activity report,
                          where somebody can actually do something about it. */}
                    </div>
                  )}
                  {/* An assignment is not the rep's to dismiss — it came from
                      an admin, and quietly deleting it would lose the ask. */}
                  {!entry.assignedBy && (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove ${entry.instituteName} from today's plan`}
                      className="size-11 self-end"
                      disabled={removing}
                      onClick={() =>
                        startRemoving(async () => {
                          await removeFromDailyPlan(entry.id);
                        })
                      }
                    >
                      <XIcon className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            ))}

            {done.map((entry) => (
              <li
                key={entry.id}
                className="border-border bg-muted/40 flex flex-col items-stretch gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {entry.instituteName}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {entry.purpose}
                    <VisitSequence at={sequence.get(entry.id)} />
                    {entry.assignedBy
                      ? ` · assigned by ${entry.assignedByName ?? "an admin"}`
                      : ""}
                  </p>
                </div>
                {/* Logged, so the closing report is done. What remains is
                    leaving — or, on a visit left open from an earlier day,
                    admitting the check-out is not coming. */}
                <div className="flex w-full min-w-0 flex-col items-start gap-1 sm:w-auto sm:shrink-0 sm:items-end">
                  <Badge variant="success">
                    <CheckCircle2Icon className="size-3" aria-hidden />
                    {entry.meetings_actual !== null ? "Held" : "Done"}
                  </Badge>
                  {/* No check-out button. Filing the feedback checked them out
                      in the same transaction, so by the time an entry reads
                      "Held" the departure is already recorded. */}
                  {entry.checkoutAt && (
                    <span className="text-muted-foreground text-xs">
                      {formatDuration(
                        visitMinutes({
                          checkinAt: entry.checkinAt,
                          checkoutAt: entry.checkoutAt,
                          checkoutMissing: entry.checkoutMissing,
                        }),
                      )}{" "}
                      on site
                    </span>
                  )}
                  {entry.checkoutMissing && (
                    <span className="text-muted-foreground text-xs">
                      Closed, time not recorded
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "· visit 2 of 3", shown only when an institute is on today's plan more than
 * once.
 *
 * Renders nothing for the ordinary single visit, which is nearly every row —
 * a label on every entry would be noise, and the whole job here is to mark the
 * few that genuinely need telling apart.
 */
function VisitSequence({ at }: { at?: { index: number; total: number } }) {
  if (!at) return null;
  return (
    <span className="text-muted-foreground">
      {" · "}visit {at.index} of {at.total}
    </span>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-danger text-xs">
      {message}
    </p>
  );
}
