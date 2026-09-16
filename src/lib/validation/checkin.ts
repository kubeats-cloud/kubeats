import { z } from "zod";
import { formatCoordinates } from "@/lib/location-display";

/**
 * Check-in / check-out: what the state means, and how long someone was there.
 *
 * These two rules are the browser's half of migration 0014's
 * public.plan_visit_status() and public.plan_visit_minutes(). Neither value is
 * stored anywhere — both are pure functions of the three timestamps — and the
 * plan_visit_status suite in tests/integration/rules.test.ts fails if this file
 * and the database ever disagree, the same arrangement app_today() and the
 * institute status categories already have.
 */

export const VISIT_STATUSES = ["Scheduled", "In Progress", "Completed"] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_STATUS_BADGE: Record<
  VisitStatus,
  "neutral" | "warning" | "success"
> = {
  Scheduled: "neutral",
  "In Progress": "warning",
  Completed: "success",
};

export interface CheckState {
  checkinAt: string | null;
  checkoutAt: string | null;
  /** Closed without a check-out: completed, duration unknown. */
  checkoutMissing: boolean;
}

/**
 * The three states, in the order they actually happen.
 *
 * `checkoutMissing` is what separates "completed, we do not know how long" from
 * "still in progress". Without it a rep who walked away without tapping the
 * button would sit In Progress for ever, which is the failure the escape valve
 * exists to prevent.
 */
export function visitStatusOf(state: CheckState): VisitStatus {
  if (!state.checkinAt) return "Scheduled";
  if (state.checkoutAt || state.checkoutMissing) return "Completed";
  return "In Progress";
}

/** Minutes on site, or null when either end is missing. Never negative. */
export function visitMinutes(state: CheckState): number | null {
  if (!state.checkinAt || !state.checkoutAt) return null;
  const from = Date.parse(state.checkinAt);
  const to = Date.parse(state.checkoutAt);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / 60_000));
}

/** "1h 25m", "40m", or the honest "Not recorded". */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "Not recorded";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * "23.0225, 72.5714", or null when the device could not say.
 *
 * Kept as a named re-export because this is where check-in code looks for it;
 * the formatting itself lives in location-display.ts with every other location
 * string, so there is one definition of what a location looks like.
 */
export const formatCoords = formatCoordinates;

/**
 * Coordinates as they arrive from a form.
 *
 * STILL OPTIONAL AT THE FIELD LEVEL, BUT NO LONGER FREELY SO.
 *
 * Through stage 2 a check-in with no location simply saved: "the timestamp is
 * what the presence guarantee rests on; the coordinates corroborate it".
 * Stage 3 reverses that (docs/stage3-plan.md, #6). A check-in now needs a
 * position — or the rep's own account of why there is not one.
 *
 * The field stays nullable because the ESCAPE is real: `manual_reason` carries
 * it, the schema below insists on one or the other, and
 * `enforce_checkin_located()` (FO012) says the same thing in the database. What
 * is gone is the silent version, where a missing location looked identical to
 * a recorded one.
 */
const optionalCoord = (limit: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine(
      (v) => v === null || (Number.isFinite(Number(v)) && Math.abs(Number(v)) <= limit),
      { message: "That location could not be read." },
    )
    .transform((v) => (v === null ? null : Number(v)));

/**
 * The rep's reason for checking in without a position.
 *
 * Free text on purpose. A dropdown would have been tidier to report on and
 * would have taught everyone to pick the first option; a sentence they had to
 * type is the thing an admin can actually read.
 */
const manualReason = z
  .string()
  .trim()
  .max(300, "Keep it short. A line is plenty.")
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const checkPointSchema = z.object({
  plan_id: z.uuid("That planned visit could not be identified."),
  latitude: optionalCoord(90),
  longitude: optionalCoord(180),
  manual_reason: manualReason,
  /**
   * Metres. Optional, and never a reason to refuse a check-in — including when
   * the key is missing altogether, which is what a page cached from before this
   * shipped will post.
   */
  accuracy: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || (Number.isFinite(Number(v)) && Number(v) >= 0), {
      message: "That accuracy could not be read.",
    })
    .transform((v) => (v === null ? null : Number(v))),
});

export type CheckPointInput = z.infer<typeof checkPointSchema>;

/**
 * #6 — a check-in is located, or it says why not.
 *
 * The one place the browser and the server agree on what "located" means, so a
 * rep is told before the database tells them. `enforce_checkin_located()` in
 * migration 0018 is the backstop that holds against a tampered form.
 *
 * A location is EITHER coordinate being present rather than both: 0016's
 * daily_plans_checkin_coords_paired already guarantees a pair arrives whole, so
 * a half pair cannot reach here, and asking for both would only invite the two
 * rules to disagree about a row neither can produce.
 */
export function checkInBlocked(input: {
  latitude: number | null;
  manual_reason: string | null;
}): boolean {
  return input.latitude === null && !input.manual_reason;
}

/**
 * The departure's own position, travelling on the form that files the report.
 *
 * SEPARATE FROM THE ARRIVAL, in the record and here. The check-out is stamped
 * by `close_visit()`, which has carried `p_checkout_lat` / `p_checkout_lng` /
 * `p_checkout_accuracy` since migration 0018 and writes them onto the plan row;
 * the columns go back to 0014 and 0015. What was missing was anything asking
 * the device, so every departure was recorded as a bare timestamp.
 *
 * It is its own three fields rather than a reuse of `latitude`/`longitude`,
 * because those belong to the VISIT — where the photo was taken — and a rep who
 * walked from the gate to the principal's office and back has genuinely been in
 * three places. Copying one into another is the specific failure the admin view
 * must never show.
 *
 * Nothing here can refuse a submission. A departure with no position saves with
 * nulls, exactly as it always did.
 */
export const CHECKOUT_LAT_FIELD = "checkout_lat";
export const CHECKOUT_LNG_FIELD = "checkout_lng";
export const CHECKOUT_ACCURACY_FIELD = "checkout_accuracy";

export interface CheckoutFix {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
}

/** Nothing recorded — what every failure path here returns. */
const NO_CHECKOUT_FIX: CheckoutFix = {
  latitude: null,
  longitude: null,
  accuracy: null,
};

const checkoutFixSchema = z.object({
  [CHECKOUT_LAT_FIELD]: optionalCoord(90),
  [CHECKOUT_LNG_FIELD]: optionalCoord(180),
  [CHECKOUT_ACCURACY_FIELD]: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || (Number.isFinite(Number(v)) && Number(v) >= 0))
    .transform((v) => (v === null ? null : Number(v))),
});

/**
 * Puts a departure reading onto the form that is about to be submitted.
 *
 * A NULL FIX WRITES NOTHING, which is the whole rule. The three fields stay
 * absent, `close_visit()` stores nulls, and the admin's Field presence view
 * says "Location unavailable" against that check-out. What it must never do —
 * and the reason this is a function rather than three hidden inputs bound to
 * whatever state happens to be around — is reach for the arrival's position,
 * or the institute's address, or the last fix this device happened to take.
 * An unlocated departure is a fact worth recording as one.
 */
export function appendCheckoutFix(
  formData: FormData,
  fix: { latitude: number; longitude: number; accuracy: number | null } | null,
): void {
  if (!fix) return;
  formData.set(CHECKOUT_LAT_FIELD, String(fix.latitude));
  formData.set(CHECKOUT_LNG_FIELD, String(fix.longitude));
  if (fix.accuracy !== null) {
    formData.set(CHECKOUT_ACCURACY_FIELD, String(fix.accuracy));
  }
}

/**
 * Reads the three fields off a submitted form, or gives back nothing.
 *
 * DELIBERATELY UNABLE TO FAIL. Every other schema in this file reports what is
 * wrong so a rep can fix it; this one falls back to nulls in silence, because
 * the alternative is refusing to file a closing report over a coordinate nobody
 * asked the rep for. A departure position is corroboration. A report that
 * cannot be filed is a visit that never happened.
 *
 * The pair is kept whole or dropped whole, which is what
 * `daily_plans_checkout_coords_paired` (0016) insists on: half a position would
 * be refused by the database on a submit the rep would have no way to correct.
 */
export function checkoutFixFromFormData(formData: FormData): CheckoutFix {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };

  const parsed = checkoutFixSchema.safeParse({
    [CHECKOUT_LAT_FIELD]: text(CHECKOUT_LAT_FIELD),
    [CHECKOUT_LNG_FIELD]: text(CHECKOUT_LNG_FIELD),
    [CHECKOUT_ACCURACY_FIELD]: text(CHECKOUT_ACCURACY_FIELD),
  });
  if (!parsed.success) return NO_CHECKOUT_FIX;

  const latitude = parsed.data[CHECKOUT_LAT_FIELD];
  const longitude = parsed.data[CHECKOUT_LNG_FIELD];
  if (latitude === null || longitude === null) return NO_CHECKOUT_FIX;

  return {
    latitude,
    longitude,
    // Only ever recorded beside a position. An accuracy on its own describes
    // nothing, and would render as a confident-looking badge over no place.
    accuracy: parsed.data[CHECKOUT_ACCURACY_FIELD],
  };
}

/** What a rep sees when the device could not place them. */
export const NO_LOCATION_GUIDANCE =
  "Turn location on, then try again. If you are indoors, moving near a window or stepping outside usually fixes it.";

/** Shared so the browser and the server action read the form identically. */
export function checkPointFormDataToInput(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    plan_id: text("plan_id"),
    latitude: text("latitude"),
    longitude: text("longitude"),
    accuracy: text("accuracy"),
    manual_reason: text("manual_reason"),
  };
}
