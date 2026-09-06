/**
 * The one place that turns a position into the words a person reads.
 *
 * THE RULE, and it is the whole reason this file exists: a location is the
 * coordinates, plus an approximate area name when one is known. It is never the
 * institute's name and never the institute's registered address.
 *
 * Which school a visit was for is on the visit record, where it belongs and
 * where it stays. Where the phone actually was is this. Substituting one for
 * the other turns "the rep was here" into "the rep said they were here", which
 * would quietly undo the only thing capturing a position is for — a visit
 * logged from home against the right institute would read exactly like a visit
 * logged at the gate. So no caller may pass an institute into any of these,
 * and none of them will accept one: they take numbers and a cached area label.
 *
 * The pairing is deliberate and is stated the same way everywhere. The
 * coordinates are exact and are the record; the area name is approximate, free,
 * best-effort, and decoration. When the area is missing it says so rather than
 * going quiet, because a reader who sees only coordinates cannot tell whether
 * nobody looked or the lookup came back empty.
 *
 * Formatting lives here and nowhere else, in the same spirit as dates.ts: there
 * were four copies of "round the coordinates and join them with a comma" before
 * this, in photo.ts, validation/checkin.ts, report-view.tsx and
 * capture-fields.tsx, which is three too many for a string that is evidence.
 */

/** Shown when the OpenStreetMap lookup found nothing, or was never made. */
export const AREA_UNAVAILABLE = "Area unavailable";

/** Shown when the device gave no position at all. */
export const LOCATION_UNAVAILABLE = "Location unavailable";

/**
 * On a screen: about 11 m, which matches the place cache's cell size, so the
 * numbers on screen and the area name beside them describe the same square.
 */
export const SCREEN_PRECISION = 4;

/**
 * On the photograph: about 1 m. The stamp is the copy that outlives the
 * database row, so it carries the finer figure.
 */
export const STAMP_PRECISION = 5;

/**
 * "23.0225, 72.5714", or null when there is no position.
 *
 * Null rather than a placeholder so each caller can say the thing that suits
 * its layout — a table cell, a stamp line and a button all word it differently.
 */
export function formatCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  precision: number = SCREEN_PRECISION,
): string | null {
  if (
    latitude === null ||
    latitude === undefined ||
    longitude === null ||
    longitude === undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }
  return `${latitude.toFixed(precision)}, ${longitude.toFixed(precision)}`;
}

/**
 * The area name, or a plain statement that there isn't one.
 *
 * Never falls back to anything else. There is no second-best source for this:
 * an institute's registered address describes a building on a form, not the
 * ground the phone was standing on, and printing it here would make a guess
 * look like a measurement.
 */
export function formatArea(area: string | null | undefined): string {
  const trimmed = area?.trim();
  return trimmed ? trimmed : AREA_UNAVAILABLE;
}

/** True when there is a real area name rather than the "unavailable" wording. */
export function hasArea(area: string | null | undefined): boolean {
  return Boolean(area?.trim());
}
