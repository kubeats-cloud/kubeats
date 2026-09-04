"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraIcon, Loader2Icon, SwitchCameraIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The in-app camera.
 *
 * A rep photographs the school gate from inside KUbeats rather than handing off
 * to the phone's camera app, so the picture never exists as a file they could
 * substitute: the frame goes straight from the live stream into the stamping
 * canvas.
 *
 * getUserMedia is not everywhere, and permission can be refused. Both cases
 * report upwards through `onUnavailable` so the caller can fall back to the
 * native input rather than leaving the rep with a dead button — a rep at a gate
 * must always have some way to attach a photo.
 *
 * The stream is stopped on every exit path. A camera light left on after the
 * sheet closes reads as spyware, and on a phone it drains the battery.
 */

type State =
  | { status: "starting" }
  | { status: "live" }
  | { status: "captured" }
  | { status: "failed"; message: string };

const DENIED = ["NotAllowedError", "SecurityError", "PermissionDeniedError"];

export function CameraCapture({
  onCapture,
  onClose,
  onUnavailable,
}: {
  /** Handed the raw frame; the caller stamps, compresses and uploads it. */
  onCapture: (frame: Blob) => void;
  onClose: () => void;
  /** Called when this device cannot do it at all, so the caller can fall back. */
  onUnavailable: (reason: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [state, setState] = useState<State>({ status: "starting" });

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (mode: "environment" | "user", cancelled: () => boolean) => {
      stop();
      // "starting" is the initial state, and the switch button sets it again —
      // doing it here would be a synchronous setState inside the mount effect.
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        onUnavailable("This browser cannot open the camera.");
        return;
      }

      try {
        // `ideal` rather than `exact`: a laptop has only one camera, and asking
        // for a rear one it does not have would fail outright.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: mode }, width: { ideal: 1920 } },
          audio: false,
        });
        // React mounts effects twice in development, and a rep can close the
        // panel while the permission prompt is still up. Either way this
        // resolves after the cleanup has run, and the stream it hands back
        // would never be stopped — a camera light left on with nothing on
        // screen. Stop it here instead.
        if (cancelled()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {
            /* Autoplay can be refused; the poster frame still shows. */
          });
        }
        setState({ status: "live" });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        if (DENIED.includes(name)) {
          setState({
            status: "failed",
            message:
              "KUbeats needs permission to use the camera. Allow it in your browser, or upload a photo instead.",
          });
          return;
        }
        onUnavailable("No camera is available on this device.");
      }
    },
    [onUnavailable, stop],
  );

  useEffect(() => {
    let cancelled = false;
    // Deferred by a tick for the same reason as the location above: the
    // "this browser has no camera API" path reports upwards synchronously.
    const timer = setTimeout(() => void start(facing, () => cancelled), 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop();
    };
  }, [facing, start, stop]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // A front camera previews mirrored, which is what people expect of a
    // mirror. The saved frame must not be, or text in the shot reads backwards.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setState({ status: "captured" });

    canvas.toBlob(
      (blob) => {
        stop();
        if (blob) onCapture(blob);
        else setState({ status: "failed", message: "That frame could not be saved. Try again." });
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <div className="bg-card border-border space-y-3 rounded-md border p-3">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-black sm:aspect-video">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-label="Live camera preview"
          className={`size-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`}
        />

        {state.status === "starting" && (
          <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
            Opening the camera…
          </p>
        )}
        {state.status === "captured" && (
          <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
            Stamping…
          </p>
        )}
        {state.status === "failed" && (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white"
          >
            {state.message}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={capture}
          disabled={state.status !== "live"}
          className="h-12 flex-1"
        >
          <CameraIcon className="size-5" aria-hidden />
          Capture
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setState({ status: "starting" });
            setFacing((f) => (f === "environment" ? "user" : "environment"));
          }}
          disabled={state.status === "starting" || state.status === "captured"}
          className="size-12"
          aria-label={facing === "environment" ? "Switch to the front camera" : "Switch to the rear camera"}
          title="Switch camera"
        >
          <SwitchCameraIcon className="size-5" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            stop();
            onClose();
          }}
          className="size-12"
          aria-label="Close the camera"
        >
          <XIcon className="size-5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
