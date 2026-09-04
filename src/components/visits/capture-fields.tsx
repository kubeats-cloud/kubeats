"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2Icon,
  MapPinIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { preparePhoto } from "@/lib/photo";
import { cn } from "@/lib/utils";

/**
 * Rule 12 — geo-tag and photo, on every visit.
 *
 * The two are deliberately not equal. The photograph is the evidence the visit
 * happened, so it blocks: no photo, no save, enforced again in the shared
 * schema and once more in the database. The location does not block — a denied
 * permission leaves a message and an empty hidden field, because a rep standing
 * in a basement staff room with no GPS lock must not be stuck.
 *
 * Capture stays as it is: `capture="environment"` hands a phone straight to its
 * rear camera, and a desktop browser falls back to the file picker. There is no
 * webcam path and there should not be one; this is a phone-first tool.
 */

type GeoState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ready"; latitude: number; longitude: number; accuracy: number }
  | { status: "failed"; message: string };

type PhotoState =
  | { status: "idle" }
  | { status: "working"; step: string }
  | { status: "ready"; path: string; previewUrl: string; bytes: number }
  | { status: "failed"; message: string };

const GEO_MESSAGES: Record<number, string> = {
  1: "Location permission was denied. You can still save the visit.",
  2: "Your location is not available right now. You can still save the visit.",
  3: "Finding your location took too long. You can still save the visit.",
};

export function CaptureFields({ userId }: { userId: string }) {
  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const [photo, setPhoto] = useState<PhotoState>({ status: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);

  // Ask on mount: the location is most accurate at the moment of the visit,
  // and one less tap matters when this is used one-handed at a school gate.
  useEffect(() => {
    captureLocation();
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  function captureLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeo({
        status: "failed",
        message: "This device cannot share a location. You can still save the visit.",
      });
      return;
    }

    setGeo({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setGeo({
          status: "ready",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) =>
        setGeo({
          status: "failed",
          message: GEO_MESSAGES[error.code] ?? GEO_MESSAGES[2],
        }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setPhoto({ status: "failed", message: "That file is not an image." });
      return;
    }

    try {
      setPhoto({ status: "working", step: "Preparing…" });
      const prepared = await preparePhoto(file, {
        latitude: geo.status === "ready" ? geo.latitude : null,
        longitude: geo.status === "ready" ? geo.longitude : null,
        takenAt: new Date(),
      });

      setPhoto({ status: "working", step: "Uploading…" });
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const supabase = createClient();
      const { error } = await supabase.storage
        .from("visit-photos")
        .upload(path, prepared.blob, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (error) {
        URL.revokeObjectURL(prepared.previewUrl);
        console.error("[photo] upload failed", error.message);
        setPhoto({
          status: "failed",
          message:
            "We could not upload that photo, and a photo is required. Please try again.",
        });
        return;
      }

      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = prepared.previewUrl;
      setPhoto({
        status: "ready",
        path,
        previewUrl: prepared.previewUrl,
        bytes: prepared.bytes,
      });
    } catch (error) {
      console.error("[photo] preparation failed", error);
      setPhoto({
        status: "failed",
        message:
          "We could not process that photo, and a photo is required. Please try another.",
      });
    } finally {
      // Let the same file be chosen again after a failure.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function clearPhoto() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPhoto({ status: "idle" });
  }

  return (
    <div className="space-y-4">
      <input
        type="hidden"
        name="latitude"
        value={geo.status === "ready" ? String(geo.latitude) : ""}
      />
      <input
        type="hidden"
        name="longitude"
        value={geo.status === "ready" ? String(geo.longitude) : ""}
      />
      <input
        type="hidden"
        name="photo_path"
        value={photo.status === "ready" ? photo.path : ""}
      />

      {/* Location ---------------------------------------------------------- */}
      <div className="space-y-2">
        <Label>Location</Label>
        <Button
          type="button"
          variant="outline"
          onClick={captureLocation}
          disabled={geo.status === "locating"}
          className={cn(
            "h-11 w-full justify-start",
            geo.status === "ready" && "border-success text-success-subtle-foreground",
          )}
        >
          {geo.status === "locating" ? (
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
          ) : (
            <MapPinIcon className="size-4" aria-hidden />
          )}
          {geo.status === "ready"
            ? `Captured · ${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)}`
            : geo.status === "locating"
              ? "Finding your location…"
              : "Capture location"}
        </Button>

        {geo.status === "ready" && (
          <p className="text-muted-foreground text-xs">
            Accurate to about {Math.round(geo.accuracy)} m. Tap to refresh.
          </p>
        )}
        {geo.status === "failed" && (
          <p
            role="status"
            className="bg-warning-subtle text-warning-subtle-foreground rounded-md px-3 py-2 text-xs"
          >
            {geo.message}
          </p>
        )}
      </div>

      {/* Photo ------------------------------------------------------------- */}
      <div className="space-y-2">
        <Label htmlFor="visit-photo">
          Photo
          <span className="text-danger" aria-hidden>
            *
          </span>
          <span className="sr-only">(required)</span>
        </Label>

        {photo.status !== "ready" && (
          <>
            <input
              ref={fileRef}
              id="visit-photo"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFile}
              disabled={photo.status === "working"}
              className="border-input file:bg-secondary file:text-secondary-foreground h-11 w-full rounded-md border px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:px-3 file:py-1 file:text-sm"
            />
            <p className="text-muted-foreground text-xs">
              Required. The location and time are stamped onto the picture
              before it is uploaded.
            </p>
          </>
        )}

        {photo.status === "working" && (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
            {photo.step}
          </p>
        )}

        {photo.status === "ready" && (
          <div className="space-y-2">
            <div className="border-border relative overflow-hidden rounded-md border">
              {/* Object URL of a canvas blob — next/image cannot optimise it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.previewUrl}
                alt="Stamped photo for this visit"
                className="max-h-56 w-full object-cover"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                Stamped and uploaded · {Math.round(photo.bytes / 1024)} KB
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={clearPhoto}
                className="h-9"
              >
                <XIcon className="size-4" aria-hidden />
                Remove
              </Button>
            </div>
          </div>
        )}

        {photo.status === "failed" && (
          <div className="space-y-2">
            <p
              role="status"
              className="bg-warning-subtle text-warning-subtle-foreground rounded-md px-3 py-2 text-xs"
            >
              {photo.message}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPhoto({ status: "idle" })}
              className="h-11"
            >
              <RotateCcwIcon className="size-4" aria-hidden />
              Try another photo
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
