"use client";

import { useState } from "react";
import { ImageOffIcon, MaximizeIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VisitPhoto } from "@/lib/photos";

/**
 * The proof photo, shown whole.
 *
 * `object-contain` on a neutral ground rather than `object-cover`: a cropped
 * proof photo is a broken proof photo. The stamp with the coordinates and the
 * time is burnt along the bottom edge of the image, so a fill-crop cuts off the
 * exact part that makes it evidence. Letterboxing is the right trade — the
 * grey around a portrait shot costs nothing, and the whole frame is legible.
 *
 * Click opens it at full size, which is the only way to read a school's
 * signage from a photo taken across a car park.
 */
export function VisitProof({
  photo,
  caption,
}: {
  photo: VisitPhoto;
  caption: string;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (photo.status === "expired" || failed) {
    return (
      <div className="border-border text-muted-foreground flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
        <ImageOffIcon className="size-5" aria-hidden />
        <p className="text-sm font-medium">Photo expired</p>
        <p className="max-w-[36ch] text-xs">
          Photos are deleted once they pass the retention window. The visit, its
          coordinates and its time are kept.
        </p>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group focus-visible:ring-ring relative block w-full overflow-hidden rounded-lg bg-neutral-subtle focus-visible:ring-2 focus-visible:outline-none"
        aria-label={`Open the full-size photo from ${caption}`}
      >
        {/* A short-lived signed URL on the storage origin — next/image would
            only add an optimiser hop for an image that expires in minutes. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.url}
          alt={`Photo from ${caption}`}
          onError={() => setFailed(true)}
          className="mx-auto max-h-[60vh] w-full object-contain"
        />
        <span className="bg-foreground/70 pointer-events-none absolute right-2 bottom-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
          <MaximizeIcon className="size-3.5" aria-hidden />
          Full size
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-base">Photo</DialogTitle>
            <DialogDescription>{caption}</DialogDescription>
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.url}
            alt={`Photo from ${caption}`}
            onError={() => {
              setFailed(true);
              setOpen(false);
            }}
            className="max-h-[80vh] w-full rounded-md object-contain"
          />
          <p className="text-muted-foreground text-xs">
            The location and time are stamped into the picture itself, which is
            what keeps it evidence once it is separated from its row.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
