"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states";
import { FormNotice } from "@/components/form-notice";
import { addTargetStatus, setTargetStatusCampus } from "@/lib/target-status-actions";
import { EMPTY_ADMIN_STATE, type AdminState } from "@/lib/admin-form-state";
import { campusLabel, type Campus } from "@/lib/campus-display";
import type { TargetStatusRow } from "@/lib/target-statuses";

/** Not "" — same sentinel statuses-panel.tsx and material-upload-form.tsx
 *  use for the same reason: a Radix Select needs a real string value for its
 *  "every campus" option, and this field is required with that as its
 *  intended default. */
const ALL_CAMPUSES = "__all__";

/**
 * Admin #8 / Rep #2 — target statuses, in the Target section/tab.
 *
 * ONE COMPONENT FOR BOTH READERS. An Admin gets the add-form, the campus
 * badge and the per-row campus picker; a Rep (or a Team Lead, who reaches
 * this screen the same way a Rep does) gets the plain name list only —
 * "only Admin can add or re-scope" is enforced by `addTargetStatus()` and
 * `setTargetStatusCampus()` themselves (`requireAdmin()` plus
 * `target_statuses_insert`/`target_statuses_update`'s `is_admin()`,
 * migrations 0047 and 0066), not by hiding a control, but there is no
 * reason to show one nobody but an Admin may use.
 *
 * WHICH ROWS EITHER READER SEES IS target_statuses_select's job (0066), not
 * this component's or its caller's: a rep's own request already came back
 * campus-scoped, so `statuses` here is already the right list.
 */
export function TargetStatusesPanel({
  statuses,
  canAdd,
  campuses = [],
}: {
  statuses: TargetStatusRow[];
  canAdd: boolean;
  campuses?: Campus[];
}) {
  const [state, formAction, isPending] = useActionState(
    addTargetStatus,
    EMPTY_ADMIN_STATE,
  );
  const [name, setName] = useState("");
  const [campusId, setCampusId] = useState<string>(ALL_CAMPUSES);
  const formRef = useRef<HTMLFormElement>(null);
  const [campusEditing, startCampusEditing] = useTransition();
  const [campusEditState, setCampusEditState] = useState<
    (AdminState & { name?: string }) | null
  >(null);

  /** The label an admin already knows: the campus's own, or "All campuses". */
  function campusLabelFor(id: string | null): string {
    if (id === null) return "All campuses";
    const campus = campuses.find((c) => c.id === id);
    return campus ? campusLabel(campus) : "Unknown campus";
  }

  /*
   * DISPATCHED BY HAND, for the reason statuses-panel.tsx's own comment
   * gives at length and material-upload-form.tsx's confirms: campusId is a
   * controlled Radix Select behind a hidden input, and React fires a native
   * `reset` on this form after the action completes (success OR failure),
   * which would restore a mounted-but-stale Select to its MOUNT value while
   * leaving the hidden input's DOM value exactly where the reset left it —
   * not necessarily where the visible control now reads. Reading the
   * FormData from the live DOM, dispatching, THEN clearing React state
   * ourselves avoids relying on that native reset at all for this field.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formAction(formData);
    setName("");
    setCampusId(ALL_CAMPUSES);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Target statuses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canAdd && (
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[10rem] flex-1 space-y-1.5">
                <Label htmlFor="target-status-name">Status name</Label>
                <Input
                  id="target-status-name"
                  name="name"
                  className="h-11"
                  maxLength={80}
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Campus</Label>
              {/* Defaults to "All campuses" rather than mounting empty: a
                  target status scoped to one campus by accident would
                  silently empty every other campus's list. */}
              <input
                type="hidden"
                name="campus_id"
                value={campusId === ALL_CAMPUSES ? "" : campusId}
              />
              <Select value={campusId} onValueChange={setCampusId}>
                <SelectTrigger className="h-11 w-full" aria-label="Campus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CAMPUSES}>All campuses</SelectItem>
                  {campuses.map((campus) => (
                    <SelectItem key={campus.id} value={campus.id}>
                      {campusLabel(campus)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" className="h-11" disabled={isPending}>
              <PlusIcon className="size-4" aria-hidden />
              {isPending ? "Adding…" : "Add"}
            </Button>
          </form>
        )}

        {state.error && <FormNotice message={state.error} fieldErrors={state.fieldErrors} />}
        {state.ok && state.message && (
          <p className="text-success text-sm">{state.message}</p>
        )}

        {statuses.length === 0 ? (
          <EmptyState
            title="No target statuses yet"
            description={
              canAdd
                ? "Add one above to make it available in the weekly target workflow."
                : "An admin has not added any target statuses yet."
            }
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {statuses.map((row) => (
              <div
                key={row.name}
                className="flex flex-wrap items-center gap-1.5"
              >
                <Badge variant="secondary">{row.name}</Badge>
                {canAdd ? (
                  // Re-scope this one row — the edit half. Changes campus_id
                  // alone; the name is never sent.
                  <Select
                    value={row.campusId ?? ALL_CAMPUSES}
                    disabled={campusEditing}
                    onValueChange={(value) => {
                      const nextCampusId = value === ALL_CAMPUSES ? null : value;
                      startCampusEditing(async () => {
                        const result = await setTargetStatusCampus(row.name, nextCampusId);
                        setCampusEditState({ ...result, name: row.name });
                      });
                    }}
                  >
                    <SelectTrigger
                      className="h-7 w-auto min-w-[8rem] text-xs"
                      aria-label={`Campus for ${row.name}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_CAMPUSES}>All campuses</SelectItem>
                      {campuses.map((campus) => (
                        <SelectItem key={campus.id} value={campus.id}>
                          {campusLabel(campus)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  // A rep has no control to change this, so a plain label is
                  // enough — "a column or label" either way.
                  <Badge variant="neutral">{campusLabelFor(row.campusId)}</Badge>
                )}
              </div>
            ))}
          </div>
        )}

        {campusEditState?.error && (
          <FormNotice message={campusEditState.error} />
        )}
        {campusEditState?.ok && campusEditState.message && (
          <p
            role="status"
            className="bg-success-subtle text-success-subtle-foreground rounded-md px-3 py-2 text-sm"
          >
            {campusEditState.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
