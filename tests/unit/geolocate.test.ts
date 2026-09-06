import { afterEach, describe, expect, it, vi } from "vitest";
import { asStale, bestFix } from "@/lib/geolocate";

/**
 * bestFix() is the actual repair for the Gandhinagar error.
 *
 * getCurrentPosition resolves with the FIRST reading that satisfies the
 * options, and enableHighAccuracy is a preference rather than an instruction to
 * wait — so on a phone it usually hands back the Wi-Fi/cell fix that arrives in
 * a second, not the satellite fix that takes ten. These tests drive a fake
 * geolocation through exactly that sequence.
 */

type Watcher = (position: unknown) => void;
type Failer = (error: { code: number }) => void;

/** A geolocation that emits the readings a real device would, on demand. */
function fakeGeolocation() {
  let onPosition: Watcher | null = null;
  let onError: Failer | null = null;
  let cleared = 0;

  const geolocation = {
    watchPosition(success: Watcher, failure: Failer) {
      onPosition = success;
      onError = failure;
      return 1;
    },
    clearWatch() {
      cleared += 1;
    },
    getCurrentPosition() {
      throw new Error("bestFix must use watchPosition, not getCurrentPosition");
    },
  };

  vi.stubGlobal("navigator", { geolocation });

  return {
    emit(latitude: number, longitude: number, accuracy: number | undefined) {
      onPosition?.({ coords: { latitude, longitude, accuracy } });
    },
    fail(code: number) {
      onError?.({ code });
    },
    get cleared() {
      return cleared;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bestFix", () => {
  it("keeps the most accurate reading, not the first", async () => {
    // The exact shape of the bug: a coarse network fix arrives first, the
    // satellite fix follows. The old code took the first one.
    const device = fakeGeolocation();
    const pending = bestFix(80);

    device.emit(23.2578, 72.6712, 3000); // Gandhinagar, network
    device.emit(23.0225, 72.5714, 12); // Ahmedabad, GPS

    const result = await pending;
    expect(result.fix?.accuracy).toBe(12);
    expect(result.fix?.latitude).toBeCloseTo(23.0225);
  });

  it("resolves early once a reading is good enough", async () => {
    const device = fakeGeolocation();
    const started = Date.now();
    const pending = bestFix(5000); // a long window it should not wait out

    device.emit(23.0225, 72.5714, 10);

    const result = await pending;
    expect(result.fix?.accuracy).toBe(10);
    // Comfortably inside the window: it stopped as soon as it had what it came
    // for, rather than making a rep at a gate wait five seconds.
    expect(Date.now() - started).toBeLessThan(3000);
    expect(device.cleared).toBe(1);
  });

  it("returns the best it saw when nothing good arrives in the window", async () => {
    const device = fakeGeolocation();
    const pending = bestFix(60);

    device.emit(23.25, 72.67, 5000);
    device.emit(23.24, 72.66, 900); // better, still not good

    const result = await pending;
    expect(result.fix?.accuracy).toBe(900);
    expect(result.unsupported).toBe(false);
  });

  it("does not let a reading with no accuracy displace a measured one", async () => {
    const device = fakeGeolocation();
    const pending = bestFix(60);

    device.emit(23.02, 72.57, 40);
    device.emit(23.90, 72.90, undefined); // unrankable — must not win

    const result = await pending;
    expect(result.fix?.accuracy).toBe(40);
    expect(result.fix?.latitude).toBeCloseTo(23.02);
  });

  it("takes an unmeasured reading when it is all there is", async () => {
    const device = fakeGeolocation();
    const pending = bestFix(60);

    device.emit(23.02, 72.57, undefined);

    const result = await pending;
    expect(result.fix).not.toBeNull();
    expect(result.fix?.accuracy).toBeNull();
  });

  it("gives up immediately when permission is refused", async () => {
    const device = fakeGeolocation();
    const started = Date.now();
    const pending = bestFix(5000);

    device.fail(1); // PERMISSION_DENIED — waiting cannot help

    const result = await pending;
    expect(result.fix).toBeNull();
    expect(result.errorCode).toBe(1);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("reports a device with no geolocation at all", async () => {
    vi.stubGlobal("navigator", {});
    const result = await bestFix(50);
    expect(result.unsupported).toBe(true);
    expect(result.fix).toBeNull();
  });

  it("never returns a stale flag on a live reading", async () => {
    const device = fakeGeolocation();
    const pending = bestFix(60);
    device.emit(23.02, 72.57, 10);
    const result = await pending;
    expect(result.fix?.stale).toBe(false);
  });
});

describe("asStale", () => {
  it("marks a remembered fix as remembered", () => {
    const live = { latitude: 23.02, longitude: 72.57, accuracy: 10, stale: false };
    expect(asStale(live)).toEqual({ ...live, stale: true });
  });

  it("does not invent a fix out of nothing", () => {
    expect(asStale(null)).toBeNull();
  });

  it("does not mutate the reading it was given", () => {
    // The remembered fix is held in a ref and reused; mutating it would poison
    // the fallback for every later read.
    const live = { latitude: 23.02, longitude: 72.57, accuracy: 10, stale: false };
    asStale(live);
    expect(live.stale).toBe(false);
  });
});
