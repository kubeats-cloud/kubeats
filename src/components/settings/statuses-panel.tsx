"use client";

import { useActionState, useState, useTransition } from "react";
import { PlusIcon, RotateCcwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { addStatus, setStatusActive } from "@/lib/admin-actions";
import { EMPTY_ADMIN_STATE, type AdminState } from "@/lib/admin-form-state";
import { fieldErrorsFrom, statusSchema } from "@/lib/validation/admin";
import {
  CATEGORY_LABELS,
  STATUS_CATEGORIES,
  STATUS_TONES,
  type StatusTone,
} from "@/lib/validation/institute";
import type { StatusAdminRow } from "@/lib/admin";
import { CHECK_FIELDS, FormNotice } from "@/components/form-notice";

/**
 * The status vocabulary, which an admin maintains from here.
 *
 * THIS PANEL ONLY BECAME POSSIBLE IN MIGRATION 0026. Until then the nine
 * statuses were written into two CHECK constraints as literals, so a row added
 * to `institute_statuses` would have inserted happily and then been refused by
 * every institute and visit — a status that exists and can never be used. The
 * columns are foreign keys to that table now, so the table IS the vocabulary.
 *
 * WHAT AN ADMIN IS ACTUALLY DECIDING, and why nothing here has a default:
 *
 *   open / closed  drives Rule 5 — an OPEN status makes a follow-up date
 *                  compulsory, enforced from the database by FO016 — and, from
 *                  stage 5, whether the institute sits in Pending. Guessing it
 *                  would be guessing whether somebody gets chased.
 *   colour         tracks the OUTCOME, not the category, so nothing can compute
 *                  it: "First meeting done" is green and still open.
 *   extra questions  each maps to a real column on `public.visits`. A closed
 *                  vocabulary of groups, never free-form fields.
 *
 * REMOVAL IS RETIREMENT, and there is no second way. Deleting a status would
 * erase what a past visit said, so three foreign keys refuse it and 0027 grants
 * no DELETE at all — not even for a status nothing has used. Retiring takes it
 * out of the rep's picker and leaves every existing visit readable.
 */
export function StatusesPanel({ statuses }: { statuses: StatusAdminRow[] }) {
  const [serverState, formAction, isPending] = useActionState(
    addStatus,
    EMPTY_ADMIN_STATE,
  );
  const [clientState, setClientState] = useState<AdminState>(EMPTY_ADMIN_STATE);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const [tone, setTone] = useState("");
  const [asksDate, setAsksDate] = useState(false);
  const [asksSession, setAsksSession] = useState(false);
  const [asksCount, setAsksCount] = useState(false);
  const [retiring, startRetiring] = useTransition();
  /*
   * WHAT RETIRE AND RESTORE SAID, WHICH USED TO BE NOTHING AT ALL.
   *
   * `setStatusActive` returns an AdminState and the click handler below awaited
   * it and dropped it. On any database missing 0026 the UPDATE names a column
   * that is not there, the action returns that as a sentence, and the sentence
   * went nowhere: the badge did not change, no message appeared, and the only
   * evidence left was a row that had not moved. Holding the result is what
   * turns a button that appears dead into one that explains itself.
   */
  const [retireState, setRetireState] = useState<AdminState | null>(null);

  const shown = serverState.error ? serverState : clientState;
  const fieldError = (key: string) =>
    shown.fieldErrors[key] ? (
      <p className="text-danger text-xs">{shown.fieldErrors[key]}</p>
    ) : null;

  /*
   * DISPATCHED BY HAND, for the same reason purposes-panel.tsx is.
   *
   * WHAT IT USED TO DO. `action={formAction}` plus an onSubmit that reset all
   * six controls on the SUCCESS path and then let the submit through. Five of
   * them are carried by HIDDEN INPUTS — category, tone and the three asks_*
   * flags — so blanking their state queued a re-render that React flushed
   * while it was still processing the submit, and what went up was a status
   * with no category and no colour. Two controlled Radix Selects were driven
   * back to empty inside the dispatch they were part of at the same time.
   *
   * Building the FormData ourselves fixes the order; dispatching ourselves
   * means React never resets the form afterwards either. log-visit-form.tsx
   * carries the reset half of the chain in full.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = statusSchema.safeParse({
      status: label,
      category,
      tone,
      asks_expected_date: asksDate,
      asks_session_detail: asksSession,
      asks_head_count: asksCount,
    });
    if (!parsed.success) {
      setClientState({
        error: CHECK_FIELDS,
        fieldErrors: fieldErrorsFrom(parsed.error),
      });
      return;
    }

    // Read, send, THEN clear. The snapshot is taken before any setter runs.
    const formData = new FormData(event.currentTarget);
    setClientState(EMPTY_ADMIN_STATE);
    setRetireState(null);
    formAction(formData);

    setLabel("");
    setCategory("");
    setTone("");
    setAsksDate(false);
    setAsksSession(false);
    setAsksCount(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Institute statuses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {statuses.length === 0 ? (
          <EmptyState
            title="No statuses yet"
            description="A rep has to say where every visit leaves the institute, so add at least one."
          />
        ) : (
          <ul className="space-y-2">
            {statuses.map((row) => (
              <li
                key={row.status}
                className="border-border space-y-2 rounded-md border px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {row.status}
                  </span>
                  <Badge variant={row.tone as StatusTone}>
                    {row.category === "open" ? "Open" : "Closed"}
                  </Badge>
                  {!row.isActive && <Badge variant="neutral">Retired</Badge>}
                </div>

                <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {row.asksExpectedDate && <span>asks the date</span>}
                  {row.asksSessionDetail && <span>asks the session detail</span>}
                  {row.asksHeadCount && <span>asks the student count</span>}
                  {/* What decides whether this status can ever be renamed or
                      removed. Shown rather than left for an admin to discover
                      by being refused. */}
                  <span>
                    {row.usedBy === 0
                      ? "not used yet"
                      : `on ${row.usedBy} record${row.usedBy === 1 ? "" : "s"}`}
                  </span>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  className="h-9"
                  disabled={retiring}
                  onClick={() =>
                    startRetiring(async () => {
                      setRetireState(
                        await setStatusActive(row.status, !row.isActive),
                      );
                    })
                  }
                >
                  {row.isActive ? (
                    "Retire"
                  ) : (
                    <>
                      <RotateCcwIcon className="size-4" aria-hidden />
                      Restore
                    </>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* Retire and restore answer here rather than inside a row: the list is
            ordered by sort_order, so a message pinned to the row it came from
            would be easy to miss and easy to mistake for another status's. */}
        {retireState?.error && <FormNotice message={retireState.error} />}
        {retireState?.ok && retireState.message && (
          <p
            role="status"
            className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
          >
            {retireState.message}
          </p>
        )}

        {/*
          NO `action` PROP. It had one, DELIBERATELY, on the reasoning that both
          Selects mount EMPTY so a Radix revert lands on nothing and
          `statusSchema` refuses it with a sentence. That reasoning was sound
          and is now beside the point: the danger here was this form's own
          onSubmit clearing controlled state that five hidden fields depend on,
          WHILE React was submitting. handleSubmit above carries the chain.

          Mounting EMPTY is still right on its own merits. A category pre-set to
          "open" would silently decide that a status makes a follow-up
          compulsory; a colour pre-set to neutral would make every new status
          look finished.
        */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="status-label">Add a status</Label>
            <Input
              id="status-label"
              name="status"
              className="h-11"
              maxLength={80}
              placeholder="e.g. Awaiting trustee sign-off"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              aria-invalid={shown.fieldErrors.status ? true : undefined}
            />
            {fieldError("status")}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Does it leave the institute open?</Label>
              <input type="hidden" name="category" value={category} />
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger
                  className="h-11 w-full"
                  aria-label="Open or closed"
                  aria-invalid={shown.fieldErrors.category ? true : undefined}
                >
                  <SelectValue placeholder="Open or closed" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_CATEGORIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {CATEGORY_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldError("category")}
            </div>

            <div className="space-y-2">
              <Label>Badge colour</Label>
              <input type="hidden" name="tone" value={tone} />
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger
                  className="h-11 w-full"
                  aria-label="Badge colour"
                  aria-invalid={shown.fieldErrors.tone ? true : undefined}
                >
                  <SelectValue placeholder="Choose a colour" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_TONES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {TONE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldError("tone")}
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium">
              What else should the report ask for?
            </legend>
            <p className="text-muted-foreground text-xs">
              A follow-up date is not here: an open status always requires one,
              and the database enforces it.
            </p>
            <input
              type="hidden"
              name="asks_expected_date"
              value={asksDate ? "yes" : "no"}
            />
            <input
              type="hidden"
              name="asks_session_detail"
              value={asksSession ? "yes" : "no"}
            />
            <input
              type="hidden"
              name="asks_head_count"
              value={asksCount ? "yes" : "no"}
            />
            <Ask
              id="asks-date"
              label="The session or campus-visit date"
              checked={asksDate}
              onChange={setAsksDate}
            />
            <Ask
              id="asks-session"
              label="The session topic and who took it"
              checked={asksSession}
              onChange={setAsksSession}
            />
            <Ask
              id="asks-count"
              label="The number of students"
              checked={asksCount}
              onChange={setAsksCount}
            />
          </fieldset>

          <Button type="submit" className="h-11 w-full" disabled={isPending}>
            <PlusIcon className="size-4" aria-hidden />
            Add
          </Button>

          {shown.error && <FormNotice message={shown.error} />}
          {serverState.ok && serverState.message && (
            <p
              role="status"
              className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
            >
              {serverState.message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/** What each colour is for, in the words the palette uses elsewhere. */
const TONE_LABELS: Record<StatusTone, string> = {
  success: "Green: done or achieved",
  warning: "Amber: scheduled or in progress",
  danger: "Red: waiting on someone else",
  neutral: "Slate: finished, no further action",
};

function Ask({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}
