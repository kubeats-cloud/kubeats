"use client";

import { useActionState, useMemo, useState } from "react";
import { ListChecksIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormNotice } from "@/components/form-notice";
import { addManyFollowUpCalls } from "@/lib/visit-actions";
import { EMPTY_STATE } from "@/lib/visit-form-state";
import { batchCallSchema } from "@/lib/validation/visit";
import { institutePickerLabel, type StatusCatalogue } from "@/lib/validation/institute";
import type { PickerInstitute } from "@/lib/visits";
import { cn } from "@/lib/utils";

/**
 * The tick-list (A2): raise several follow-up calls in one pass. CALLS ONLY.
 *
 * It had a Meeting mode that batch-wrote `daily_plans` rows under one purpose.
 * The client asked for no meeting surface on the Dashboard, so that mode is
 * gone; the single add form in Today's plan is the one way a visit is planned
 * there. `addManyToDailyPlan` and `batchPlanSchema` are left in place, unused.
 *
 * NO PURPOSE, NO NOTE, NO DUE DATE. A call carries no purpose
 * (`follow_up_tasks_purpose_for_meetings`, 0038), and `due_date` defaults to
 * `app_today()`, so the institutes ticked are the whole of what is sent — see
 * `addManyFollowUpCalls`.
 *
 * SEARCH RUNS IN THE BROWSER over the list the server already sent — the same
 * reasoning `institutes-browser.tsx` gives at length: a round trip per
 * keystroke is the thing to avoid on a phone. Its code is not reused, only its
 * argument; this list is small and has no URL state to mirror.
 */
export function MorningPlan({
  institutes,
  catalogue,
}: {
  institutes: PickerInstitute[];
  catalogue: StatusCatalogue;
}) {
  const [state, formAction, isPending] = useActionState(
    addManyFollowUpCalls,
    EMPTY_STATE,
  );
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);

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
    const parsed = batchCallSchema.safeParse({ institute_ids: picked });
    if (!parsed.success) {
      // Stops the server action too: React skips a form action when the submit
      // event has been prevented. Nothing is sent, and the rep is told why.
      event.preventDefault();
      setClientError(parsed.error.issues[0]?.message ?? "Tick at least one institute.");
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
        disabled={institutes.length === 0}
      >
        <ListChecksIcon className="size-4" aria-hidden />
        Select institutes to call
      </Button>
    );
  }

  return (
    <Card className="gap-0 p-4">
      <form action={formAction} onSubmit={handleSubmit} className="space-y-3">
        {picked.map((id) => (
          <input key={id} type="hidden" name="institute_ids" value={id} />
        ))}

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
            return (
              <li key={institute.id}>
                <button
                  type="button"
                  onClick={() => toggle(institute.id)}
                  aria-pressed={on}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm transition-colors",
                    on ? "bg-primary/10 text-foreground" : "hover:bg-accent",
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
              {isPending ? "Adding…" : "Add follow-up calls"}
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
