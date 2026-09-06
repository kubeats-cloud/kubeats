import { describe, expect, it } from "vitest";
import {
  VISIT_STATUSES,
  checkPointSchema,
  formatCoords,
  formatDuration,
  visitMinutes,
  visitStatusOf,
} from "@/lib/validation/checkin";

/**
 * Check-in / check-out, the browser's half.
 *
 * Neither the status nor the duration is stored: both are functions of the
 * three timestamps, and migration 0014 derives them in SQL the same way. The
 * plan_visit_status suite in tests/integration/rules.test.ts asserts the two
 * halves agree; these cover the rules themselves.
 */

const state = (
  checkinAt: string | null,
  checkoutAt: string | null,
  checkoutMissing = false,
) => ({ checkinAt, checkoutAt, checkoutMissing });

describe("visitStatusOf", () => {
  it("walks the three states in the order they happen", () => {
    expect(visitStatusOf(state(null, null))).toBe("Scheduled");
    expect(visitStatusOf(state("2026-09-06T09:00:00Z", null))).toBe("In Progress");
    expect(
      visitStatusOf(state("2026-09-06T09:00:00Z", "2026-09-06T10:00:00Z")),
    ).toBe("Completed");
  });

  it("calls a visit closed without a check-out Completed, not stuck", () => {
    // The escape valve. Without checkoutMissing this row is indistinguishable
    // from one still in progress, and a rep who drove off would sit In Progress
    // for ever.
    expect(visitStatusOf(state("2026-09-06T09:00:00Z", null, true))).toBe(
      "Completed",
    );
  });

  it("only ever returns one of the three", () => {
    const cases = [
      state(null, null),
      state(null, null, true),
      state("2026-09-06T09:00:00Z", null),
      state("2026-09-06T09:00:00Z", null, true),
      state("2026-09-06T09:00:00Z", "2026-09-06T09:30:00Z"),
    ];
    for (const c of cases) {
      expect(VISIT_STATUSES, JSON.stringify(c)).toContain(visitStatusOf(c));
    }
  });

  it("ignores checkoutMissing when nobody ever checked in", () => {
    // A flag on a visit that never started means nothing; the status must not
    // claim it was completed.
    expect(visitStatusOf(state(null, null, true))).toBe("Scheduled");
  });
});

describe("visitMinutes", () => {
  it("measures the time on site", () => {
    expect(
      visitMinutes(state("2026-09-06T09:00:00Z", "2026-09-06T10:25:00Z")),
    ).toBe(85);
    expect(
      visitMinutes(state("2026-09-06T09:00:00Z", "2026-09-06T09:00:00Z")),
    ).toBe(0);
  });

  it("is null when either end is missing", () => {
    expect(visitMinutes(state(null, null))).toBeNull();
    expect(visitMinutes(state("2026-09-06T09:00:00Z", null))).toBeNull();
    expect(visitMinutes(state("2026-09-06T09:00:00Z", null, true))).toBeNull();
  });

  it("never returns a negative duration", () => {
    // The database constrains checkout >= checkin, but a duration that renders
    // as "-20m" would be worse than useless if a row ever slipped through.
    expect(
      visitMinutes(state("2026-09-06T10:00:00Z", "2026-09-06T09:40:00Z")),
    ).toBe(0);
  });

  it("survives an unparseable timestamp", () => {
    expect(visitMinutes(state("not a date", "2026-09-06T10:00:00Z"))).toBeNull();
  });
});

describe("formatDuration", () => {
  it("reads the way a person would say it", () => {
    expect(formatDuration(40)).toBe("40m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(85)).toBe("1h 25m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("says so plainly when there is nothing to report", () => {
    expect(formatDuration(null)).toBe("Not recorded");
  });
});

describe("formatCoords", () => {
  it("prints a readable fix", () => {
    expect(formatCoords(23.02251, 72.57136)).toBe("23.0225, 72.5714");
  });

  it("returns null when the device could not say", () => {
    expect(formatCoords(null, null)).toBeNull();
    expect(formatCoords(23.02, null)).toBeNull();
    expect(formatCoords(null, 72.57)).toBeNull();
  });
});

describe("checkPointSchema — the escape valve", () => {
  const plan = { plan_id: "8b1a9953-4c22-4d1f-9b1a-99534c224d1f" };

  it("accepts a check-in with coordinates", () => {
    const result = checkPointSchema.safeParse({
      ...plan,
      latitude: "23.0225",
      longitude: "72.5714",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.latitude).toBeCloseTo(23.0225);
  });

  it("ACCEPTS a check-in with no coordinates at all", () => {
    // This is the rule the whole escape valve rests on: a denied permission or
    // no signal must never stop a rep recording that they arrived.
    const result = checkPointSchema.safeParse({
      ...plan,
      latitude: "",
      longitude: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latitude).toBeNull();
      expect(result.data.longitude).toBeNull();
    }
  });

  it("records the accuracy when the device reported one", () => {
    const result = checkPointSchema.safeParse({
      ...plan,
      latitude: "23.0225",
      longitude: "72.5714",
      accuracy: "12.5",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.accuracy).toBe(12.5);
  });

  it("accepts a check-in whose form carries no accuracy field at all", () => {
    // Mid-deploy, a rep's cached page posts the old form. Accuracy is a
    // diagnostic, so its absence must cost nothing.
    const result = checkPointSchema.safeParse({
      ...plan,
      latitude: "23.0225",
      longitude: "72.5714",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.accuracy).toBeNull();
  });

  it("still refuses coordinates that are not on the globe", () => {
    expect(
      checkPointSchema.safeParse({ ...plan, latitude: "91", longitude: "0" })
        .success,
    ).toBe(false);
    expect(
      checkPointSchema.safeParse({ ...plan, latitude: "0", longitude: "-181" })
        .success,
    ).toBe(false);
    expect(
      checkPointSchema.safeParse({ ...plan, latitude: "north", longitude: "0" })
        .success,
    ).toBe(false);
  });

  it("insists on knowing which planned visit it is", () => {
    expect(
      checkPointSchema.safeParse({ plan_id: "", latitude: "", longitude: "" })
        .success,
    ).toBe(false);
  });
});
