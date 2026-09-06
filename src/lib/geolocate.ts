"use client";

import {
  GOOD_ACCURACY_M,
  type LocationFix,
} from "@/lib/validation/location";

/**
 * Getting the BEST fix the device can manage, rather than the first one it says.
 *
 * THE BUG THIS REPLACES
 *
 * `getCurrentPosition` resolves with the first reading that satisfies the
 * options, and `enableHighAccuracy: true` does not change that — it is a
 * preference, not an instruction to wait. On Android the fused location
 * provider typically produces a Wi-Fi/cell fix within a second while a GPS lock
 * takes five to thirty, so a single call with a 7-second timeout very often
 * returns the coarse one. That is how a visit in Ahmedabad was recorded in
 * Gandhinagar.
 *
 * WHAT THIS DOES INSTEAD
 *
 * `watchPosition` keeps delivering readings as the device refines them. This
 * holds the best one seen — lowest accuracy number wins — and:
 *
 *   * resolves EARLY the moment a reading is good enough, so a rep outdoors
 *     with a clear sky waits a second or two, not the full window;
 *   * otherwise waits out the window and returns the best it saw, flagged for
 *     what it is;
 *   * returns null only when the device produced nothing at all.
 *
 * It never rejects and never throws. A location is best-effort by design (see
 * validation/location.ts): the visit must still save.
 */

/**
 * How long to keep improving before settling. Long enough for a cold GPS lock
 * outdoors, short enough that a rep at a gate is not left waiting — they are
 * standing in front of somebody.
 */
export const FIX_WINDOW_MS = 12_000;

/** Good enough to stop early rather than spend the rest of the window. */
const RESOLVE_EARLY_AT_M = GOOD_ACCURACY_M;

export interface FixResult {
  fix: LocationFix | null;
  /** True when the device has no geolocation at all — a desktop, usually. */
  unsupported: boolean;
  /** Set when every reading failed: permission denied, position unavailable. */
  errorCode: number | null;
}

/**
 * Watches for up to `windowMs`, keeping the most accurate reading seen.
 *
 * `maximumAge: 0` throughout: a cached position is exactly what we are trying
 * to stop trusting.
 */
export function bestFix(windowMs: number = FIX_WINDOW_MS): Promise<FixResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ fix: null, unsupported: true, errorCode: null });
  }

  return new Promise<FixResult>((resolve) => {
    let best: LocationFix | null = null;
    let lastError: number | null = null;
    let settled = false;
    let watchId: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      resolve({
        fix: best,
        unsupported: false,
        errorCode: best ? null : lastError,
      });
    };

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const accuracy = Number.isFinite(position.coords.accuracy)
          ? position.coords.accuracy
          : null;

        // Lowest accuracy number wins. A reading with no accuracy at all is
        // only kept when nothing better has arrived, because it cannot be
        // compared and must not displace something that can.
        const better =
          best === null ||
          (accuracy !== null &&
            (best.accuracy === null || accuracy < best.accuracy));

        if (better) {
          best = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy,
            stale: false,
          };
        }

        if (accuracy !== null && accuracy <= RESOLVE_EARLY_AT_M) finish();
      },
      (error) => {
        lastError = error.code;
        // A permission refusal will never improve, so stop rather than sit
        // there for the whole window achieving nothing.
        if (error.code === 1) finish();
      },
      { enableHighAccuracy: true, timeout: windowMs, maximumAge: 0 },
    );

    timer = setTimeout(finish, windowMs);
  });
}

/**
 * Marks a remembered fix as remembered.
 *
 * The old code fell back to the last known position on timeout and returned it
 * as though it were live, which meant a reading from wherever the phone had
 * been earlier was indistinguishable from one taken at the gate. Anything
 * reused now says so, and the UI shows it.
 */
export function asStale(fix: LocationFix | null): LocationFix | null {
  return fix ? { ...fix, stale: true } : null;
}

/**
 * How long to wait for an area name before giving up on it.
 *
 * Short on purpose. The route has its own 3.5s budget; this guards against the
 * route itself hanging. A rep at a gate waits for a photo, never for a label.
 */
export const PLACE_TIMEOUT_MS = 4000;

/**
 * An approximate area name for a position — "Satellite, Ahmedabad" — or null.
 *
 * Never throws, never waits long, and is never a reason anything fails. The
 * lookup is free OpenStreetMap by way of /api/place, which is server-side so
 * the User-Agent their policy asks for can be set and the answer shared through
 * `place_cache`.
 *
 * Null means "no name", and every caller renders that as "Area unavailable".
 * None of them substitutes anything else for it; see location-display.ts.
 */
export async function nameArea(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLACE_TIMEOUT_MS);
  try {
    const response = await fetch("/api/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude, longitude }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok: boolean; label?: string | null };
    return body.ok ? (body.label ?? null) : null;
  } catch {
    // Aborted, offline, or the route is unhappy. All the same to us.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
