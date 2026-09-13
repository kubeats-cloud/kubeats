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
