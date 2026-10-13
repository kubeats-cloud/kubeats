"use client";

import { useActionState, useMemo, useState } from "react";
import { ListChecksIcon, SearchIcon } from "lucide-react";
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
import { FormNotice } from "@/components/form-notice";
import { addManyFollowUpCalls, addManyToDailyPlan } from "@/lib/visit-actions";
import { EMPTY_STATE } from "@/lib/visit-form-state";
import { batchCallSchema, batchPlanSchema } from "@/lib/validation/visit";
import { institutePickerLabel, type StatusCatalogue } from "@/lib/validation/institute";
import type { PickerInstitute, PurposeOption } from "@/lib/visits";
import { cn } from "@/lib/utils";

/**
 * The morning tick-list (A2): plan a day in one pass — of either kind.
 *
 * TWO MODES, TWO ACTIONS, ONE PANEL. Meeting mode writes ORDINARY
 * `daily_plans` ROWS, which is the point of A2: not a new concept, the add
 * form with checkboxes, so every row lands in the Meeting section, satisfies
 * the meeting gate, counts toward Rule 7 exactly as before, and goes through
 * the same check-in chain. That is why A2 needed no migration: 0033 made the
 * add an INSERT rather than an upsert, so several rows a day is what the
 * table already permits. Call mode writes `follow_up_tasks` rows the
 * identical way the single call always has — see `addManyFollowUpCalls`.
 *
 * ONE PURPOSE FOR THE WHOLE BATCH, and the picker mounts EMPTY — Meeting mode
 * only. `daily_plans.purpose_id` is what derives each visit's activity
 * (0024/0025), and therefore which of Rule 7's eight metrics the work lands
 * in. A tick-list that collected institutes and no purpose would write rows
 * that can never be logged — the rep would reach /log and meet the "this
 * visit needs its purpose set again" dead end. And a picker PRE-SET to
 * anything would let the wrong metric be chosen silently for ever, which is
 * the rule `PurposesPanel` states for its own. Call mode asks no purpose at
 * all: a call carries none (`follow_up_tasks_purpose_for_meetings`, 0038).
 *
 * SEARCH RUNS IN THE BROWSER over the list the server already sent — the same
 * reasoning `institutes-browser.tsx` gives at length: a round trip per
 * keystroke is the thing to avoid on a phone. Its code is not reused, only its
 * argument; this list is small and has no URL state to mirror.
 */
export function MorningPlan({
  institutes,
  purposes,
  catalogue,
  plannedIds,
}: {
  institutes: PickerInstitute[];
  purposes: PurposeOption[];
  catalogue: StatusCatalogue;
  /** Already on today's plan and not yet started — shown ticked and disabled. */
  plannedIds: string[];
}) {
  const [meetingState, meetingFormAction, meetingIsPending] = useActionState(
    addManyToDailyPlan,
    EMPTY_STATE,
  );
  const [callState, callFormAction, callIsPending] = useActionState(
    addManyFollowUpCalls,
    EMPTY_STATE,
  );
  // Which batch this submit is: ordinary planned visits, or follow-up calls.
  // Two actions rather than one that branches internally, because the two
  // write different tables with different shapes — a call carries no
  // purpose at all (follow_up_tasks_purpose_for_meetings, 0038).
  const [kind, setKind] = useState<"meeting" | "call">("meeting");
  const state = kind === "meeting" ? meetingState : callState;
  const formAction = kind === "meeting" ? meetingFormAction : callFormAction;
  const isPending = kind === "meeting" ? meetingIsPending : callIsPending;
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);

  const alreadyPlanned = useMemo(() => new Set(plannedIds), [plannedIds]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return institutes;
    return institutes.filter((institute) =>
      `${institute.name} ${institute.city ?? ""}`.toLowerCase().includes(term),
    );
  }, [institutes, search]);

  function toggle(id: string) {
    setPicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const parsed =
      kind === "meeting"
        ? batchPlanSchema.safeParse({ purpose, institute_ids: picked })
        : batchCallSchema.safeParse({ institute_ids: picked });
    if (!parsed.success) {
      // Stops the server action too: React skips a form action when the submit
      // event has been prevented. Nothing is sent, and the rep is told why.
      event.preventDefault();
      setClientError(
        parsed.error.issues[0]?.message ??
          (kind === "meeting"
            ? "Pick a purpose and tick at least one."
            : "Tick at least one institute."),
      );
      return;
    }
    setClientError(null);
    setPicked([]);
    setSearch("");
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full"
        onClick={() => setOpen(true)}
        // Not `|| purposes.length === 0` any more: Call mode needs none, and
        // gating the whole panel on a purpose list would make it unreachable
        // for exactly the batch that does not use one.
        disabled={institutes.length === 0}
      >
        <ListChecksIcon className="size-4" aria-hidden />
        Plan the morning
      </Button>
    );
  }

  return (
    <Card className="gap-0 p-4">
      <form action={formAction} onSubmit={handleSubmit} className="space-y-3">
        {kind === "meeting" && <input type="hidden" name="purpose" value={purpose} />}
        {picked.map((id) => (
          <input key={id} type="hidden" name="institute_ids" value={id} />
        ))}

        {/* Meeting plans ordinary visits; Call raises follow-up calls instead
            — two different tables, so the purpose question below only
            applies to one of them. */}
        <div className="flex gap-2">
          {(["meeting", "call"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
              className={cn(
                "focus-visible:ring-ring inline-flex h-11 flex-1 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                kind === option
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-accent",
              )}
            >
              {option === "meeting" ? "Meeting" : "Call"}
            </button>
          ))}
        </div>

        {kind === "meeting" && (
          <div className="space-y-1.5">
            <Label>What are these visits for?</Label>
            {/* Empty and required — see the note at the head of this file. */}
            <Select value={purpose} onValueChange={setPurpose}>
              <SelectTrigger className="h-11 w-full" aria-label="Purpose for the batch">
                <SelectValue placeholder="Purpose of these visits" />
              </SelectTrigger>
              <SelectContent>
                {purposes.map((option) => (
                  <SelectItem key={option.id} value={option.label}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="relative">
          <SearchIcon
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            className="h-11 pl-9"
            placeholder="Search your institutes"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search institutes"
          />
        </div>

        <ul className="border-border max-h-64 space-y-1 overflow-y-auto rounded-md border p-1">
          {filtered.length === 0 && (
            <li className="text-muted-foreground px-2 py-3 text-sm">
              Nothing matches that search.
            </li>
          )}
          {filtered.map((institute) => {
            const on = picked.includes(institute.id);
            // "Already on today's plan" is a fact about Meeting mode only —
            // an institute due a call is not blocked by an unrelated visit
            // already planned for it today.
            const planned = kind === "meeting" && alreadyPlanned.has(institute.id);
            return (
              <li key={institute.id}>
                <button
                  type="button"
                  onClick={() => !planned && toggle(institute.id)}
                  aria-pressed={on}
                  disabled={planned}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm transition-colors",
                    planned
                      ? "text-muted-foreground cursor-default"
                      : on
                        ? "bg-primary/10 text-foreground"
                        : "hover:bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded border text-[11px]",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                    aria-hidden
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate py-2">
                    {institutePickerLabel(catalogue, institute)}
                  </span>
                  {planned && (
                    <span className="shrink-0 text-xs">already planned</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            {picked.length} selected
          </p>
          <div className="flex gap-2">
            <Button type="submit" className="h-11" disabled={isPending}>
              {isPending
                ? "Adding…"
                : kind === "meeting"
                  ? "Add to today's plan"
                  : "Add follow-up calls"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => {
                setOpen(false);
                setClientError(null);
              }}
            >
              Close
            </Button>
          </div>
        </div>

        {(clientError || state.error) && (
          <FormNotice message={clientError ?? state.error ?? ""} />
        )}
        {/* Said rather than swallowed: a rep who ticked six and got four needs
            the other two accounted for. */}
        {!state.error && state.ok && state.message && (
          <p className="text-muted-foreground text-xs">{state.message}</p>
        )}
      </form>
    </Card>
  );
}
