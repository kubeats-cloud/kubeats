"use client";

import { useState } from "react";
import { ImageOffIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VisitPhoto } from "@/lib/photos";

/**
 * The proof photo on a visit: a thumbnail that opens larger on tap.
 *
 * Two ways a photo can be gone, and both land on the same quiet placeholder
 * rather than an error. The server may already know the file is missing — the
 * purge or an admin flush cleared it — and even when a URL signs successfully
 * the object can disappear before the browser fetches it, so `onError` falls
 * back too. A visit whose photo has expired is normal, not broken: the row
 * still carries its coordinates and its timestamp.
 *
 * No caption is drawn over the image. The coordinates and time were burnt into
 * the pixels when it was taken, which is what makes the picture evidence even
 * once it is separated from its row.
 */
export function VisitPhotoThumb({
  photo,
  caption,
}: {
  photo: VisitPhoto;
  /** Describes the visit, for the dialog title and the alt text. */
  caption: string;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (photo.status === "expired" || failed) {
    return <ExpiredPlaceholder />;
  }

  return (
    <>
      {/* Contain rather than cover: the stamp along the bottom edge is the
          point of the photo, and a 64px square crop is exactly what removes it. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border bg-neutral-subtle focus-visible:ring-ring mt-2 block size-16 shrink-0 overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none"
        aria-label={`Open the photo from ${caption}`}
      >
        {/* A short-lived signed URL on the storage origin — next/image would
            only add an optimiser hop for an image that expires in minutes. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.url}
          alt={`Proof photo from ${caption}`}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-contain"
        />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">Proof photo</DialogTitle>
            <DialogDescription>{caption}</DialogDescription>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.url}
            alt={`Proof photo from ${caption}`}
            onError={() => {
              setFailed(true);
              setOpen(false);
            }}
            className="max-h-[80vh] w-full rounded-md object-contain"
          />
          <p className="text-muted-foreground text-xs">
            The location and time are stamped into the picture. Photos are
            deleted automatically once they pass the retention window.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ExpiredPlaceholder() {
  return (
    <div
      className="border-border text-muted-foreground mt-2 flex size-16 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-center"
      title="This photo has passed its retention window and been deleted."
    >
      <ImageOffIcon className="size-4" aria-hidden />
      <span className="text-[10px] leading-tight">Photo expired</span>
    </div>
  );
}
