"use client";

import { useActionState, useState } from "react";
import { Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeEntry } from "@/lib/admin-actions";
import { EMPTY_ADMIN_STATE } from "@/lib/admin-form-state";
import type { RemovableKind } from "@/lib/validation/admin";

/**
 * Remove, with the consequence stated before it happens.
 *
 * States and cities cascade in the database, so the warning has to carry the
 * count of what goes with them — "Remove Karnataka" is a very different action
 * from "remove one row" when eleven cities hang off it.
 */
export function RemoveButton({
  kind,
  id,
  name,
  warning,
}: {
  kind: RemovableKind;
  id: string;
  name: string;
  /** Extra sentence about what else disappears, when anything does. */
  warning?: string;
}) {
  const [state, formAction, isPending] = useActionState(
    removeEntry,
    EMPTY_ADMIN_STATE,
  );
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        aria-label={`Remove ${name}`}
        className="size-11 shrink-0"
        onClick={() => setConfirming(true)}
      >
        <Trash2Icon className="text-danger size-4" aria-hidden />
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <div className="bg-danger-subtle text-danger-subtle-foreground space-y-2 rounded-md px-3 py-2 text-sm">
        <p className="flex items-start gap-2">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Remove {name}?{warning ? ` Its ${warning}` : ""}
          </span>
        </p>
        {state.error && <p role="alert">{state.error}</p>}
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="destructive"
            className="h-11 flex-1"
            disabled={isPending}
          >
            {isPending ? "Removing…" : "Yes, remove"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => setConfirming(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
