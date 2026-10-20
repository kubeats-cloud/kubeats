"use client";

import { useActionState, useRef } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states";
import { FormNotice } from "@/components/form-notice";
import { addTargetStatus } from "@/lib/target-status-actions";
import { EMPTY_ADMIN_STATE } from "@/lib/admin-form-state";

/**
 * Admin #8 / Rep #2 — target statuses, in the Target section/tab.
 *
 * ONE COMPONENT FOR BOTH READERS. An Admin gets the add-form and the list; a
 * Rep (or a Team Lead, who reaches this screen the same way a Rep does) gets
 * the list only — "only Admin can add" is enforced by `addTargetStatus()`
 * itself (`requireAdmin()` plus `target_statuses_insert`'s `is_admin()`), not
 * by hiding a button, but there is no reason to show a control nobody but an
 * Admin may use.
 */
export function TargetStatusesPanel({
  statuses,
  canAdd,
}: {
  statuses: string[];
  canAdd: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    addTargetStatus,
    EMPTY_ADMIN_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Target statuses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canAdd && (
          <form
            ref={formRef}
            action={(formData) => {
              formAction(formData);
              formRef.current?.reset();
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="min-w-[10rem] flex-1 space-y-1.5">
              <Label htmlFor="target-status-name">Status name</Label>
              <Input
                id="target-status-name"
                name="name"
                className="h-11"
                maxLength={80}
                required
              />
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
            {statuses.map((status) => (
              <Badge key={status} variant="secondary">
                {status}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
