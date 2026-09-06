"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraIcon,
  ImageIcon,
  Loader2Icon,
  MapPinIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { asStale, bestFix, nameArea } from "@/lib/geolocate";
import { formatArea } from "@/lib/location-display";
import {
  ACCURACY_BADGE,
  accuracyBand,
  describeAccuracy,
  shouldRetryLocation,
  type LocationFix,
} from "@/lib/validation/location";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CameraCapture } from "@/components/visits/camera-capture";
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
 * Two ways to provide the photo, and only these two:
 *
 *   Take photo    the in-app camera, rear-facing by default. The frame goes
 *                 from the live stream straight into the stamping canvas and
 *                 never exists as a file the rep could substitute.
 *   Upload photo  an existing picture from the device.
 *
 * Both end up in the same place. Whichever route the image arrives by, the
 * coordinates burned into it are read from this device at the moment of
 * attaching, never from the file: browsers strip EXIF geotags, and a reading
 * taken now is harder to fake than one taken from metadata.
 *
 * The photo can only be attached here, while the visit is being logged. There
 * is no path anywhere that edits it afterwards, and the database refuses one.
 */

type GeoState =
  | { status: "idle" }
  | { status: "locating" }
  | {
      status: "ready";
      latitude: number;
      longitude: number;
      /** Metres. Null only when the browser declined to say. */
      accuracy: number | null;
      /** True when this is a remembered reading rather than a fresh one. */
      stale: boolean;
    }
  | { status: "failed"; message: string };

type PhotoState =
  | { status: "idle" }
  | { status: "working"; step: string }
  | { status: "ready"; path: string; previewUrl: string; bytes: number }
  | { status: "failed"; message: string };

/**
 * The client-side guard on the area-name lookup. The route already gives up
 * after 3.5s; this is a hair longer, and only exists so a route that never
 * answers at all cannot hold a photo hostage.
 */

const GEO_MESSAGES: Record<number, string> = {
  1: "Location permission was denied. You can still save the visit.",
  2: "Your location is not available right now. You can still save the visit.",
  3: "Finding your location took too long. You can still save the visit.",
};

export function CaptureFields({ userId }: { userId: string }) {
  // Starts as "locating" because the mount effect asks immediately; setting
  // it there instead would be a synchronous setState inside an effect.
  const [geo, setGeo] = useState<GeoState>({ status: "locating" });
  const [photo, setPhoto] = useState<PhotoState>({ status: "idle" });
  const [cameraOpen, setCameraOpen] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  /** Set once this device has proved it cannot open a camera in the page. */
  const [cameraUnavailable, setCameraUnavailable] = useState<string | null>(null);

  const uploadRef = useRef<HTMLInputElement>(null);
  const nativeCameraRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);
  /** The last good fix, used only when a fresh read fails at capture time. */
  const lastFix = useRef<LocationFix | null>(null);

  const applyFix = useCallback((fix: LocationFix): LocationFix => {
    // Only a LIVE reading is worth remembering as the fallback. Remembering a
    // stale one would let it be handed on again later, one step further from
    // the truth each time.
    if (!fix.stale) lastFix.current = fix;
    setGeo({ status: "ready", ...fix });
    return fix;
  }, []);

  /**
   * Asks the device for its BEST reading, not its first.
   *
   * bestFix watches for a few seconds and keeps the most accurate fix it sees,
   * resolving early once one is good enough. A single getCurrentPosition
   * returned whatever arrived first, which on a phone is usually the Wi-Fi or
   * cell fix rather than the satellite one — and that is how a visit in
   * Ahmedabad came to be recorded in Gandhinagar.
   */
  const requestPosition = useCallback(async () => {
    const result = await bestFix();

    if (result.unsupported) {
      setGeo({
        status: "failed",
        message:
          "This device cannot share a location — it may have no GPS. You can still save the visit.",
      });
      return;
    }
    if (!result.fix) {
      setGeo({
        status: "failed",
        message: GEO_MESSAGES[result.errorCode ?? 2] ?? GEO_MESSAGES[2],
      });
      return;
    }
    applyFix(result.fix);
  }, [applyFix]);

  /** The button: says what it is doing, then asks. */
  const captureLocation = useCallback(() => {
    setGeo({ status: "locating" });
    requestPosition();
  }, [requestPosition]);

  // Ask on mount: the location is most accurate at the moment of the visit, and
  // one less tap matters when this is used one-handed at a school gate.
  useEffect(() => {
    // Deferred by a tick: asking synchronously would set state from inside the
    // effect on the one path that fails immediately (a device with no
    // geolocation at all). Everything else here is already async.
    const timer = setTimeout(requestPosition, 0);
    return () => {
      clearTimeout(timer);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, [requestPosition]);

  /**
   * The coordinates to burn into this photo, read now rather than reused from
   * page load — a rep may have walked from the gate to the office since.
   * maximumAge 0 forces a real reading; a remembered fix is the fallback and is
   * flagged as one, and no coordinates at all is still allowed.
   */
  const freshFix = useCallback(async (): Promise<LocationFix | null> => {
    const result = await bestFix();
    if (result.fix) return applyFix(result.fix);

    // Nothing live. The remembered reading is still better than nothing, but it
    // is handed back MARKED — this used to fall through silently, so a fix from
    // wherever the phone had been earlier was indistinguishable from one taken
    // at the gate.
    const remembered = asStale(lastFix.current);
    if (remembered) applyFix(remembered);
    return remembered;
  }, [applyFix]);

  /**
   * The area the current fix falls in, shown under the coordinates.
   *
   * Held together with the position it describes rather than on its own, so a
   * name can never be left sitting under coordinates it does not belong to —
   * the moment the fix moves, the label stops matching and reads as pending
   * again. Two outcomes worth telling apart: still looking, and looked and
   * found nothing. Neither is ever filled in with the institute's name; the
   * location is what the phone reports, not what was selected above.
   */
  const [namedArea, setNamedArea] = useState<{
    key: string;
    label: string | null;
  } | null>(null);

  /** The area name for the stamp. Shared with check-in/out so both word it the same. */
  const namePlace = useCallback(
    async (fix: LocationFix | null): Promise<string | null> =>
      fix ? nameArea(fix.latitude, fix.longitude) : null,
    [],
  );

  /**
   * Name the area whenever the position changes, so a rep can see where the app
   * thinks they are BEFORE they take the photo — not only afterwards, burned
   * into an image. Coordinates alone are not something a person can check.
   *
   * Depends on the coordinates rather than the whole fix, so re-reading the same
   * spot at a better accuracy does not re-ask for a name it already has.
   */
  const lat = geo.status === "ready" ? geo.latitude : null;
  const lng = geo.status === "ready" ? geo.longitude : null;
  const areaKey = lat !== null && lng !== null ? `${lat},${lng}` : null;

  useEffect(() => {
    if (lat === null || lng === null || areaKey === null) return;
    let cancelled = false;
    nameArea(lat, lng).then((label) => {
      if (!cancelled) setNamedArea({ key: areaKey, label });
    });
    return () => {
      cancelled = true;
    };
  }, [areaKey, lat, lng]);

  /** The single path every photo takes, from either button. */
  const processAndUpload = useCallback(
    async (image: Blob) => {
      try {
        setPhoto({ status: "working", step: "Reading your location…" });
        const fix = await freshFix();

        setPhoto({ status: "working", step: "Naming the area…" });
        const place = await namePlace(fix);

        setPhoto({ status: "working", step: "Stamping…" });
        const prepared = await preparePhoto(image, {
          latitude: fix?.latitude ?? null,
          longitude: fix?.longitude ?? null,
          takenAt: new Date(),
          place,
        });

        setPhoto({ status: "working", step: "Uploading…" });
        const path = `${userId}/${crypto.randomUUID()}.jpg`;
        const supabase = createClient();
        const { error } = await supabase.storage
          .from("visit-photos")
          .upload(path, prepared.blob, { contentType: "image/jpeg", upsert: false });

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
      }
    },
    [freshFix, namePlace, userId],
  );

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be chosen again after a failure.
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setPhoto({ status: "failed", message: "That file is not an image." });
      return;
    }
    await processAndUpload(file);
  }

  function takePhoto() {
    if (cameraUnavailable) {
      // This device has already told us it cannot; go straight to its own app.
      nativeCameraRef.current?.click();
      return;
    }
    setCameraOpen(true);
  }

  function clearPhoto() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setPhoto({ status: "idle" });
  }

  const busy = photo.status === "working";

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
        name="accuracy"
        value={
          geo.status === "ready" && geo.accuracy !== null
            ? String(geo.accuracy)
            : ""
        }
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
          <div className="space-y-1">
            {/* The area those coordinates fall in. Approximate by nature and
                labelled as such; when the free lookup finds nothing it says so
                rather than borrowing a name from anywhere else. */}
            <p className="text-muted-foreground text-xs">
              {namedArea?.key === areaKey
                ? formatArea(namedArea.label)
                : "Naming the area…"}
            </p>

            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              <Badge variant={ACCURACY_BADGE[accuracyBand(geo.accuracy)]}>
                {describeAccuracy(geo.accuracy)}
              </Badge>
              {geo.stale && <Badge variant="danger">Remembered, not live</Badge>}
            </p>

            {/* Warn, never block. Rule 12 makes the photo mandatory and leaves
                the location best-effort on purpose: a rep with no signal must
                still be able to finish their work. */}
            {(shouldRetryLocation(geo.accuracy) || geo.stale) && (
              <p
                role="status"
                className="bg-warning-subtle text-warning-subtle-foreground rounded-md px-3 py-2 text-xs"
              >
                {geo.stale
                  ? "This is an earlier reading, not a live one."
                  : accuracyBand(geo.accuracy) === "network"
                    ? "That looks like a network location rather than GPS, so it may be a long way off. If you are indoors, stepping outside usually fixes it."
                    : "That is only approximate. Tap to try again if you can."}{" "}
                You can still save either way.
              </p>
            )}

            <p className="text-muted-foreground text-xs">Tap to refresh.</p>
          </div>
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
        <Label htmlFor="visit-photo-upload">
          Photo
          <span className="text-danger" aria-hidden>
            *
          </span>
          <span className="sr-only">(required)</span>
        </Label>

        {/* Both inputs stay mounted and hidden; the buttons above drive them. */}
        <input
          ref={uploadRef}
          id="visit-photo-upload"
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="sr-only"
        />
        <input
          ref={nativeCameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
          className="sr-only"
          aria-hidden
          tabIndex={-1}
        />

        {photo.status !== "ready" && !cameraOpen && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={takePhoto}
                disabled={busy}
                className="h-14 flex-col gap-1"
              >
                <CameraIcon className="size-5" aria-hidden />
                Take photo
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => uploadRef.current?.click()}
                disabled={busy}
                className="h-14 flex-col gap-1"
              >
                <ImageIcon className="size-5" aria-hidden />
                Upload photo
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Required. Your location and the time are stamped onto the picture
              before it is uploaded — read from this device now, whichever way
              you add it.
            </p>
          </>
        )}

        {cameraOpen && (
          <CameraCapture
            onCapture={(frame) => {
              setCameraOpen(false);
              void processAndUpload(frame);
            }}
            onClose={() => setCameraOpen(false)}
            onUnavailable={(reason) => {
              setCameraUnavailable(reason);
              setCameraOpen(false);
              // Hand straight over rather than making them press twice.
              nativeCameraRef.current?.click();
            }}
          />
        )}

        {busy && (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
            {photo.step}
          </p>
        )}

        {photo.status === "ready" && (
          <div className="space-y-2">
            {/*
              object-contain, not object-cover. The stamp with the coordinates
              and the time is burnt along the bottom edge, so a fill-crop cuts
              off the part that makes the picture evidence — and a rep checking
              their own photo could not see whether it had worked. Letterboxing
              on a neutral ground costs nothing and shows the whole frame.
            */}
            <button
              type="button"
              onClick={() => setEnlarged(true)}
              className="border-border bg-neutral-subtle focus-visible:ring-ring block w-full overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none"
              aria-label="Open the photo at full size"
            >
              {/* Object URL of a canvas blob — next/image cannot optimise it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.previewUrl}
                alt="Stamped photo for this visit"
                className="mx-auto max-h-72 w-full object-contain"
              />
            </button>

            <Dialog open={enlarged} onOpenChange={setEnlarged}>
              <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle className="text-base">Your photo</DialogTitle>
                  <DialogDescription>
                    Check the stamp along the bottom edge reads correctly before
                    you save.
                  </DialogDescription>
                </DialogHeader>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.previewUrl}
                  alt="Stamped photo for this visit, full size"
                  className="max-h-[80vh] w-full rounded-md object-contain"
                />
              </DialogContent>
            </Dialog>
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                Stamped and uploaded · {Math.round(photo.bytes / 1024)} KB
              </p>
              <Button type="button" variant="ghost" onClick={clearPhoto} className="h-9">
                <XIcon className="size-4" aria-hidden />
                Replace
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
              Try again
            </Button>
          </div>
        )}

        {cameraUnavailable && photo.status !== "ready" && (
          <p className="text-muted-foreground text-xs">
            {cameraUnavailable} Your device&rsquo;s own camera app will open instead.
          </p>
        )}
      </div>
    </div>
  );
}
