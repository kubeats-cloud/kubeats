import { describe, expect, it } from "vitest";

import { countHeldVisits, type HeldVisitEntry } from "@/lib/dashboard-metrics";

type VisitFixture = HeldVisitEntry & {
  activity: string;
  checkinAt: string | null;
  checkoutMissing: boolean;
  meetings_actual: number | null;
};

const visit = (overrides: Partial<VisitFixture> = {}): VisitFixture => ({
  activity: "meeting",
  cancelledAt: null,
  checkinAt: null,
  checkoutAt: null,
  checkoutMissing: false,
  meetings_actual: null,
  ...overrides,
});

describe("Dashboard Held count", () => {
  it("does not count a planned-only visit", () => {
    expect(countHeldVisits([visit()])).toBe(0);
  });

  it("does not count a checked-in visit before check-out", () => {
    expect(countHeldVisits([visit({ checkinAt: "2026-11-26T04:30:00Z" })])).toBe(0);
  });

  it("counts a checked-out non-meeting activity", () => {
    expect(
      countHeldVisits([
        visit({
          activity: "session",
          checkoutAt: "2026-11-26T06:00:00Z",
          meetings_actual: null,
        }),
      ]),
    ).toBe(1);
  });

  it("counts a checked-out meeting", () => {
    expect(
      countHeldVisits([
        visit({ checkoutAt: "2026-11-26T06:00:00Z", meetings_actual: 1 }),
      ]),
    ).toBe(1);
  });

  it("does not count a cancelled plan", () => {
    expect(
      countHeldVisits([
        visit({
          cancelledAt: "2026-11-26T03:00:00Z",
          checkoutAt: "2026-11-26T06:00:00Z",
        }),
      ]),
    ).toBe(0);
  });

  it("does not count checkout_missing without checkout_at", () => {
    expect(
      countHeldVisits([
        visit({
          checkinAt: "2026-11-26T04:30:00Z",
          checkoutAt: null,
          checkoutMissing: true,
        }),
      ]),
    ).toBe(0);
  });
});
