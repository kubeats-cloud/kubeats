"use client";

import { useActionState, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormNotice } from "@/components/form-notice";
import { saveSlabs, decideSlabs } from "@/lib/slab-actions";
import { EMPTY_ADMIN_STATE } from "@/lib/admin-form-state";
import {
  SLAB_STATUS_LABEL,
  SLAB_STATUS_TONE,
  nextSlabStart,
  slabsEditable,
  validateSlabSet,
  type SlabScope,
} from "@/lib/validation/slabs";
import type { SlabSet } from "@/lib/slabs";

/**
 * Admission slabs for one institute.
 *
 * ⚠ THE SET IS THE UNIT, and the form shape follows from that. A contiguous
 * cover cannot be edited a row at a time — close one slab without opening the
 * next and there is a gap; open the next without closing the first and there
 * are two open-ended slabs — so the whole set is submitted together and
 * `save_slabs()` replaces it in one transaction. There is deliberately no
 * per-row save.
 *
 * ⚠ THE LAST SLAB'S END IS BLANK, ALWAYS. "1200 and above" is how the client's
 * own sheet reads, and blank is that, not a field somebody forgot. The input is
 * disabled on the last row so it cannot be filled by accident, and the rule is
 * stated under the table rather than only enforced.
 *
 * APPROVED IS FROZEN. The rep sees the ranges and no controls; an admin sees
 * Revoke, which is a REJECT — a revoked set is one the rep edits and resubmits,
 * which is what rejected already means, so there is no fourth status anywhere.
 *
 * THE ADMISSION-COUNT NUMBER HAS NO SOURCE YET and nothing here shows one. No
 * "you are in slab 3", no current count: these are ranges, and anything else
 * would be invented.
 */
export function SlabsPanel({
  instituteId,
  sets,
  canEdit,
  canDecide,
}: {
  instituteId: string;
  sets: SlabSet[];
  /** A rep for their own institute, a team lead for their reps', an admin. */
  canEdit: boolean;
  /** Admin only — see slab-actions.ts for why this is not the team lead. */
  canDecide: boolean;
}) {
  const [adding, setAdding] = useState<SlabScope | null>(null);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Admission slabs</CardTitle>
        {canEdit && adding === null && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setAdding("total")}
            >
              <PlusIcon className="size-4" aria-hidden />
              Total
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setAdding("program")}
            >
              <PlusIcon className="size-4" aria-hidden />
              Program-wise
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-5">
        {sets.length === 0 && adding === null && (
          <p className="text-muted-foreground text-sm">
            No slabs yet.{" "}
            {canEdit
              ? "Add a total set for the whole institute, or one per college and programme."
              : "The rep has not submitted any."}
          </p>
        )}

        {sets.map((set) => (
          <SlabSetForm
            key={set.key}
            instituteId={instituteId}
            set={set}
            canEdit={canEdit}
            canDecide={canDecide}
          />
        ))}

        {adding && (
          <SlabSetForm
            instituteId={instituteId}
            scope={adding}
            canEdit
            canDecide={false}
            onCancel={() => setAdding(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function SlabSetForm({
  instituteId,
  set,
  scope,
  canEdit,
  canDecide,
  onCancel,
}: {
  instituteId: string;
  set?: SlabSet;
  scope?: SlabScope;
  canEdit: boolean;
  canDecide: boolean;
  onCancel?: () => void;
}) {
  const theScope: SlabScope = set?.scope ?? scope ?? "total";
  const status = set?.status ?? null;
  const editable = canEdit && slabsEditable(status);

  const [state, formAction, isPending] = useActionState(saveSlabs, EMPTY_ADMIN_STATE);
  const [decision, decideAction, isDeciding] = useActionState(
    decideSlabs,
    EMPTY_ADMIN_STATE,
  );

  const [college, setCollege] = useState(set?.college ?? "");
  const [program, setProgram] = useState(set?.program ?? "");
  const [rows, setRows] = useState<{ start: string; end: string }[]>(
    set?.slabs.map((s) => ({
      start: String(s.start),
      end: s.end === null ? "" : String(s.end),
    })) ?? [{ start: "0", end: "" }],
  );
  const [clientError, setClientError] = useState<string | null>(null);

  /**
   * AUTO-SUGGEST THE NEXT START — one past the previous End.
   *
   * The new row is the open-ended one, so the row BEFORE it has to gain an end
   * if it does not have one. Suggesting a start without closing the previous
   * slab would create exactly the gap the rules forbid, and leave the rep to
   * discover it at submit.
   */
  function addRow() {
    setRows((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last && last.end === "") {
        // Nothing to suggest from yet: close it at its own start so the pair is
        // contiguous, which the rep can then widen.
        last.end = last.start === "" ? "" : last.start;
      }
      const suggestion = nextSlabStart(
        next.map((r) => ({
          start: Number(r.start),
          end: r.end === "" ? null : Number(r.end),
        })),
      );
      next.push({ start: suggestion === null ? "" : String(suggestion), end: "" });
      return next;
    });
  }

  function removeRow(index: number) {
    setRows((current) => {
      const next = current.filter((_, i) => i !== index);
      // The last slab is always open-ended; dropping the old one leaves its
      // predecessor closed, which would be a set with no open end.
      if (next.length > 0) next[next.length - 1] = { ...next[next.length - 1], end: "" };
      return next.length > 0 ? next : [{ start: "0", end: "" }];
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const problems = validateSlabSet({
      institute_id: instituteId,
      scope: theScope,
      college: theScope === "total" ? "" : college.trim(),
      program: theScope === "total" ? "" : program.trim(),
      slabs: rows,
    });
    if (problems.length > 0) {
      // Stops the server action too: React skips a form action when the submit
      // event has been prevented.
      event.preventDefault();
      setClientError(problems.map((p) => p.message).join(" "));
      return;
    }
    setClientError(null);
  }

  const title =
    theScope === "total"
      ? "Total — all programmes"
      : `${(set?.college ?? college) || "College"} · ${(set?.program ?? program) || "Programme"}`;

  return (
    <div className="border-border rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        {status && (
          <Badge variant={SLAB_STATUS_TONE[status]}>{SLAB_STATUS_LABEL[status]}</Badge>
        )}
      </div>

      {/* The approver's reason, which is the first thing a rep needs on a set
          that came back. */}
      {status === "rejected" && set?.note && (
        <p className="bg-danger-subtle text-danger-subtle-foreground mb-3 rounded-md px-3 py-2 text-xs">
          {set.note}
        </p>
      )}

      {editable ? (
        <form action={formAction} onSubmit={handleSubmit} className="space-y-3">
          <input type="hidden" name="institute_id" value={instituteId} />
          <input type="hidden" name="scope" value={theScope} />

          {theScope === "program" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`college-${theScope}`}>College</Label>
                <Input
                  id={`college-${theScope}`}
                  name="college"
                  className="h-11"
                  value={college}
                  onChange={(e) => setCollege(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`program-${theScope}`}>Programme</Label>
                <Input
                  id={`program-${theScope}`}
                  name="program"
                  className="h-11"
                  value={program}
                  onChange={(e) => setProgram(e.target.value)}
                />
              </div>
            </div>
          )}
          {theScope === "total" && (
            <>
              <input type="hidden" name="college" value="" />
              <input type="hidden" name="program" value="" />
            </>
          )}

          <ul className="space-y-2">
            {rows.map((row, i) => {
              const isLast = i === rows.length - 1;
              return (
                <li key={i} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    {i === 0 && <Label className="text-xs">From</Label>}
                    <Input
                      name="start"
                      inputMode="numeric"
                      className="h-11"
                      aria-label={`Slab ${i + 1} start`}
                      value={row.start}
                      onChange={(e) =>
                        setRows((c) =>
                          c.map((r, j) =>
                            j === i ? { ...r, start: e.target.value.replace(/\D/g, "") } : r,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    {i === 0 && <Label className="text-xs">To</Label>}
                    {/* DISABLED ON THE LAST ROW. Blank is the open end, and a
                        field that can be filled by accident is a rule the rep
                        discovers at submit instead of on screen. */}
                    <Input
                      name="end"
                      inputMode="numeric"
                      className="h-11"
                      aria-label={
                        isLast ? `Slab ${i + 1} is open-ended` : `Slab ${i + 1} end`
                      }
                      placeholder={isLast ? "and above" : ""}
                      disabled={isLast}
                      value={isLast ? "" : row.end}
                      onChange={(e) =>
                        setRows((c) =>
                          c.map((r, j) =>
                            j === i ? { ...r, end: e.target.value.replace(/\D/g, "") } : r,
                          ),
                        )
                      }
                    />
                    {/* A disabled input posts nothing, so the open end is sent
                        explicitly — the server zips `start` and `end` by
                        position and a short list would shift every row. */}
                    {isLast && <input type="hidden" name="end" value="" />}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={`Remove slab ${i + 1}`}
                    onClick={() => removeRow(i)}
                    disabled={rows.length === 1}
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>

          <p className="text-muted-foreground text-xs">
            Each slab starts where the last one ended. The final slab is open —
            leave its “To” blank for “and above”.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={addRow}>
              <PlusIcon className="size-4" aria-hidden />
              Add slab
            </Button>
            <Button type="submit" className="h-11" disabled={isPending}>
              {isPending ? "Submitting…" : "Submit for approval"}
            </Button>
            {onCancel && (
              <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>

          {(clientError || state.error) && (
            <FormNotice message={clientError ?? state.error ?? ""} />
          )}
          {!state.error && state.ok && state.message && (
            <p className="text-muted-foreground text-xs" role="status">
              {state.message}
            </p>
          )}
        </form>
      ) : (
        <ul className="divide-border divide-y text-sm">
          {set?.slabs.map((slab) => (
            <li key={slab.id} className="flex justify-between py-1.5">
              <span className="tabular-nums">
                {slab.start}
                {slab.end === null ? " and above" : `–${slab.end}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canDecide && set && (
        <form action={decideAction} className="border-border mt-3 space-y-2 border-t pt-3">
          <input type="hidden" name="institute_id" value={instituteId} />
          <input type="hidden" name="scope" value={set.scope} />
          <input type="hidden" name="college" value={set.college ?? ""} />
          <input type="hidden" name="program" value={set.program ?? ""} />

          {set.status !== "approved" && (
            <Textarea
              name="note"
              rows={2}
              placeholder="Why it is going back (optional)"
              aria-label="Reason"
            />
          )}

          <div className="flex flex-wrap gap-2">
            {set.status === "pending" && (
              <Button
                type="submit"
                name="status"
                value="approved"
                className="h-11"
                disabled={isDeciding}
              >
                Approve
              </Button>
            )}
            {/* REVOKE IS A REJECT. Offered only on an approved set, which is
                also the only transition decide_slabs() will accept from here —
                rejecting a rejected set is refused as a no-op. */}
            <Button
              type="submit"
              name="status"
              value="rejected"
              variant="outline"
              className="h-11"
              disabled={isDeciding || set.status === "rejected"}
            >
              {set.status === "approved" ? "Revoke" : "Send back"}
            </Button>
          </div>

          {decision.error && <FormNotice message={decision.error} />}
          {!decision.error && decision.ok && decision.message && (
            <p className="text-muted-foreground text-xs" role="status">
              {decision.message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
