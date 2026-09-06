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
 * Optional on purpose, and this is the escape valve rather than an oversight: a
 * denied permission, a basement staff room or a dead GPS must not stop a rep
 * recording that they arrived. The timestamp is what the presence guarantee
 * rests on; the coordinates corroborate it. Rule 12 makes the same call for the
 * visit photo, where the photo blocks and the geo-tag does not.
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

export const checkPointSchema = z.object({
  plan_id: z.uuid("That planned visit could not be identified."),
  latitude: optionalCoord(90),
  longitude: optionalCoord(180),
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
  };
}
