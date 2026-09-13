"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraIcon,
  ImageIcon,
  Loader2Icon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { asStale, bestFix, nameArea } from "@/lib/geolocate";
import { type LocationFix } from "@/lib/validation/location";
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

/**
 * Rule 12 — geo-tag and photo, on every visit.
 *
 * The two are deliberately not equal. The photograph is the evidence the visit
 * happened, so it blocks: no photo, no save, enforced again in the shared
 * schema and once more in the database. The location does not block — a denied
 * permission leaves an empty hidden field, because a rep standing in a basement
 * staff room with no GPS lock must not be stuck.
 *
 * THE LOCATION IS CAPTURED SILENTLY, AND HAS NO UI HERE.
 *
 * It used to have a "Capture location" button, a coordinate readout, an area
 * name, an accuracy badge and a retry link. The client asked for that step to
 * go: a rep does not choose to share a location, so a control that looks like a
 * choice was one more thing to tap and one more thing to get wrong. What it
 * reported is not lost — the coordinates, the time and the area name are burnt
 * into the photograph itself by preparePhoto(), which is the copy that actually
 * has to stand up later.
 *
 * The state machine underneath is UNCHANGED and still has a `failed` case
 * carrying a message nothing currently renders. That is deliberate rather than
 * an oversight: making a missing location BLOCK the check-in, and showing that
 * message when it does, is stage 3 of the redesign (docs/flow-redesign-plan.md,
 * change 6). Gutting the state now would only mean rebuilding it then.
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

/** What the rep reads while the photo is being made ready. */
const PREPARING = "Preparing your photo…";

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
          "This device cannot share a location. You can still save the visit.",
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

  // Ask on mount: the location is most accurate at the moment of the visit, and
  // with no button to press this is now the ONLY thing that starts a reading
  // before the photo is taken.
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
   * The area name for the stamp. Shared with check-in/out so both word it the
   * same.
   *
   * This is now the ONLY place an area is looked up. There used to be a second
   * lookup driven by an effect, purely so the name could be shown on screen
   * beside the coordinates before the photo was taken; with that readout gone
   * it named an area nobody was going to read, once per position change. The
   * stamp's own lookup below is unaffected, so the photograph still carries its
   * area line.
   */
  const namePlace = useCallback(
    async (fix: LocationFix | null): Promise<string | null> =>
      fix ? nameArea(fix.latitude, fix.longitude) : null,
    [],
  );

  /** The single path every photo takes, from either button. */
  const processAndUpload = useCallback(
    async (image: Blob) => {
      try {
        // ONE WORDING FOR THE THREE PREPARATION STEPS, deliberately. They used
        // to read "Reading your location…", "Naming the area…", "Stamping…",
        // which narrated the location capture to the rep a step at a time. The
        // steps themselves are unchanged and still run in this order; only what
        // is printed while they run has changed.
        setPhoto({ status: "working", step: PREPARING });
        const fix = await freshFix();

        setPhoto({ status: "working", step: PREPARING });
        const place = await namePlace(fix);

        setPhoto({ status: "working", step: PREPARING });
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
              Required. The date, time and place are added to the picture
              automatically when you attach it.
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
                    Have a look before you save.
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
