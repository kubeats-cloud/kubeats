/**
 * How good is a location, and how do we say so.
 *
 * WHY THIS FILE EXISTS
 *
 * A rep in Ahmedabad had a visit recorded ~25 km away in Gandhinagar. The
 * geolocation options were already right — enableHighAccuracy true, maximumAge
 * zero — so the cause was not a coarse *request*. It was a coarse *answer*
 * accepted as though it were a good one: a Wi-Fi/network fix, which a browser
 * will happily return alongside a small-sounding accuracy figure.
 *
 * That number is a claim about PRECISION, not about CORRECTNESS. "±137 m" means
 * "I am confident to within 137 m of where I think you are", not "I am within
 * 137 m of where you actually are". When the Wi-Fi access-point database has a
 * stale entry — a router that moved, a mobile hotspot, a carrier box registered
 * at the ISP's address — you get a confidently wrong fix, and until now nothing
 * recorded or showed it.
 *
 * So accuracy is now stored beside every latitude and longitude, and warned
 * about when it is poor. It is NEVER a reason to refuse a save: Rule 12 makes
 * the photo mandatory and deliberately leaves the location best-effort, because
 * a rep in a basement staff room with no signal must still be able to finish
 * their work. Honest and imperfect beats blocked.
 *
 * WHERE IT IS SHOWN, which is narrower than it was. The band and the figure
 * appear on the FINISHED record - the closing report and the admin's activity
 * report - and nowhere in the flow a rep is in the middle of. While a visit is
 * running they get one sentence, and only when the fix is poor enough to be
 * worth another go; describeAccuracy() is not called at all on that path. The
 * reading, the storing and the warning are all unchanged. What went is the
 * readout.
 */

/**
 * The line between "this is where they were" and "this is roughly the
 * neighbourhood". 150 m is generous for a phone GPS lock outdoors (typically
 * 5-20 m) and tight enough to catch a Wi-Fi fix, which is usually 50-5000 m.
 *
 * One constant, deliberately easy to move: if the field team turns out to work
 * somewhere this is wrong for, this is the number to change.
 */
export const GOOD_ACCURACY_M = 150;

/**
 * Past this, a fix is almost certainly network-derived rather than satellite —
 * a whole-neighbourhood or whole-city answer. Worth saying out loud, because
 * this is the band the Gandhinagar error lived in.
 */
export const NETWORK_ACCURACY_M = 1000;

export type AccuracyBand = "good" | "approximate" | "network" | "unknown";

export function accuracyBand(accuracy: number | null): AccuracyBand {
  if (accuracy === null || !Number.isFinite(accuracy) || accuracy < 0) {
    return "unknown";
  }
  if (accuracy <= GOOD_ACCURACY_M) return "good";
  if (accuracy < NETWORK_ACCURACY_M) return "approximate";
  return "network";
}

export const ACCURACY_BADGE: Record<
  AccuracyBand,
  "success" | "warning" | "danger" | "neutral"
> = {
  good: "success",
  approximate: "warning",
  network: "danger",
  unknown: "neutral",
};

/** "±12 m", "±3.2 km" — the number on its own, for tight spaces. */
export function formatAccuracy(accuracy: number | null): string {
  if (accuracy === null || !Number.isFinite(accuracy) || accuracy < 0) {
    return "accuracy unknown";
  }
  return accuracy >= 1000
    ? `±${(accuracy / 1000).toFixed(1)} km`
    : `±${Math.round(accuracy)} m`;
}

/**
 * The number and what it means, which is the part that was missing. A rep
 * reading "±3.2 km (network location — likely not your real spot)" knows to
 * retry; one reading "±3200" does not.
 */
export function describeAccuracy(accuracy: number | null): string {
  const band = accuracyBand(accuracy);
  const value = formatAccuracy(accuracy);
  switch (band) {
    case "good":
      return `${value} (good)`;
    case "approximate":
      return `${value} (approximate)`;
    case "network":
      return `${value} (network location, so it may be well off)`;
    case "unknown":
      return "Accuracy unknown";
  }
}

/** True when the rep should be nudged to try again before saving. */
export function shouldRetryLocation(accuracy: number | null): boolean {
  const band = accuracyBand(accuracy);
  return band === "approximate" || band === "network";
}

/**
 * A location reading, with everything needed to judge it later.
 *
 * `stale` marks a fix that came from an earlier read rather than this one —
 * previously that fallback was silent, so a fix from wherever the phone had
 * been was indistinguishable from a live one.
 */
export interface LocationFix {
  latitude: number;
  longitude: number;
  /** Metres, as the browser reported. Null only if the browser omitted it. */
  accuracy: number | null;
  /** True when this is a remembered reading, not a fresh one. */
  stale: boolean;
}

/** Coordinates as they arrive from a form: all three optional, all validated. */
export function parseAccuracy(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
