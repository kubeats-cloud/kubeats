"use client";

import { useActionState, useState } from "react";
import { FileTextIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { formatDate } from "@/lib/dates";
import { deleteMaterial } from "@/lib/material-actions";
import type { ManagedMaterial } from "@/lib/materials";
import { EMPTY_STATE } from "@/lib/visit-form-state";
import { formatFileSize, isImage } from "@/lib/validation/material";

/**
 * The library, from the admin side: what is in it, and how to take something
 * out.
 *
 * Removal is a two-step press rather than a browser confirm(). A native dialog
 * blocks the page and looks nothing like the rest of the app; asking in place
 * costs one extra tap and is reversible until the second one.
 */
export function MaterialManageList({
  materials,
}: {
  materials: ManagedMaterial[];
}) {
  const [state, formAction, isPending] = useActionState(
    deleteMaterial,
    EMPTY_STATE,
  );
  const [confirming, setConfirming] = useState<string | null>(null);

  if (materials.length === 0) {
    return (
      <EmptyState
        icon={FileTextIcon}
        title="The library is empty"
        description="Upload a poster, brochure or announcement above and it appears here for every rep."
      />
    );
  }

  return (
    <div className="space-y-2">
      {state.error && (
        <p
          role="alert"
          className="bg-danger-subtle text-danger-subtle-foreground rounded-md px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      )}

      <ul className="space-y-2">
        {materials.map((material) => (
          <li
            key={material.id}
            className="bg-card border-border flex items-start gap-3 rounded-md border p-3"
          >
            <span
              aria-hidden
              className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md"
            >
              {isImage(material.fileType) && material.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={material.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover"
                />
              ) : (
                <FileTextIcon className="size-5" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium break-words">{material.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{material.category}</Badge>
                <span className="text-muted-foreground text-xs">
                  {material.fileName} · {formatFileSize(material.fileSize)} ·{" "}
                  {formatDate(material.createdAt)}
                </span>
              </div>
              {!material.url && (
                <p className="text-muted-foreground mt-1 text-xs">
                  The stored file is missing. Removing this clears the record.
                </p>
              )}
            </div>

            {confirming === material.id ? (
              <form action={formAction} className="flex shrink-0 items-center gap-1">
                <input type="hidden" name="id" value={material.id} />
                <Button
                  type="submit"
                  variant="destructive"
                  className="h-9"
                  disabled={isPending}
                >
                  {isPending ? "Removing…" : "Remove"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9"
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="h-9 shrink-0"
                onClick={() => setConfirming(material.id)}
                aria-label={`Remove ${material.title}`}
              >
                <Trash2Icon className="size-4" aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
