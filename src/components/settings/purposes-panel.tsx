"use client";

import { useActionState, useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/states";
import { RemoveButton } from "@/components/settings/remove-button";
import { addPurpose } from "@/lib/admin-actions";
import { EMPTY_ADMIN_STATE, type AdminState } from "@/lib/admin-form-state";
import { fieldErrorsFrom, purposeSchema } from "@/lib/validation/admin";
import type { PurposeRow } from "@/lib/admin";
import { CHECK_FIELD, FormNotice } from "@/components/form-notice";

/**
 * The meeting purposes a rep picks from when planning today's visits.
 *
 * Removing one does not touch the daily_plans that already used it — purpose is
 * stored on the plan as text, so history keeps the wording it was recorded
 * under even after the option is retired.
 */
export function PurposesPanel({ purposes }: { purposes: PurposeRow[] }) {
  const [serverState, formAction, isPending] = useActionState(
    addPurpose,
    EMPTY_ADMIN_STATE,
  );
  const [clientState, setClientState] = useState<AdminState>(EMPTY_ADMIN_STATE);
  const [label, setLabel] = useState("");

  const error = serverState.error ?? clientState.error;
  const fieldError = (serverState.error ? serverState : clientState).fieldErrors
    .label;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const parsed = purposeSchema.safeParse({ label });
    if (!parsed.success) {
      event.preventDefault();
      setClientState({
        error: CHECK_FIELD,
        fieldErrors: fieldErrorsFrom(parsed.error),
      });
      return;
    }
    setClientState(EMPTY_ADMIN_STATE);
    setLabel("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Meeting purposes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {purposes.length === 0 ? (
          <EmptyState
            title="No purposes yet"
            description="Reps choose from this list when they plan a visit, so add at least one."
          />
        ) : (
          <ul className="space-y-2">
            {purposes.map((purpose) => (
              <li
                key={purpose.id}
                className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {purpose.label}
                </span>
                <RemoveButton kind="purpose" id={purpose.id} name={purpose.label} />
              </li>
            ))}
          </ul>
        )}

        <form action={formAction} onSubmit={handleSubmit} className="space-y-2">
          <Label htmlFor="purpose-label">Add a purpose</Label>
          <div className="flex gap-2">
            <Input
              id="purpose-label"
              name="label"
              className="h-11"
              maxLength={120}
              placeholder="e.g. Follow up on proposal"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              aria-invalid={fieldError ? true : undefined}
            />
            <Button type="submit" className="h-11" disabled={isPending}>
              <PlusIcon className="size-4" aria-hidden />
              Add
            </Button>
          </div>
          {fieldError && <p className="text-danger text-xs">{fieldError}</p>}
          {error && <FormNotice message={error} />}
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
