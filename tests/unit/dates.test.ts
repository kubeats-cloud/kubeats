import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatTime,
  todayInAppZone,
} from "@/lib/dates";
import { formatWeekRange } from "@/lib/weeks";
import { dailyPlanSchema, dailyPlanSummary } from "@/lib/validation/visit";

/**
 * The regression this file exists for.
 *
 * A live run froze the whole app for Indian users between 00:00 and 05:30 IST.
 * The server formatted a date in UTC, the browser formatted the same date in
 * UTC+5:30, the two disagreed about which day it was once local midnight had
 * passed but UTC midnight had not, the rendered text differed, and React
 * refused to hydrate the page (#418). Not a wrong-looking date — a nightly
 * outage.
 *
 * So the property under test is not "dates look nice". It is "the same input
 * produces the same output no matter where the code runs", which is the
 * property that was missing.
 */

const ORIGINAL_TZ = process.env.TZ;

/**
 * Loads a fresh copy of the module with the process pretending to be in `tz`.
 *
 * This is the part that actually catches the bug. Node re-reads the default
 * timezone when TZ changes, so a formatter that does not name its own zone
 * picks up whatever is set here — and the assertions below stop matching. Drop
 * `timeZone: APP_TIME_ZONE` from dates.ts and these tests go red.
 */
async function datesModuleIn(tz: string) {
  process.env.TZ = tz;
  vi.resetModules();
  return import("@/lib/dates");
}

/** Zones chosen to sit either side of UTC and off the hour. */
const ZONES = [
  "UTC",
  "Asia/Kolkata", // +5:30 — the users
  "America/Los_Angeles", // -8, and a whole day behind India
  "Pacific/Kiritimati", // +14, the far edge
  "Australia/Adelaide", // +9:30, another half-hour offset
];

/**
 * Instants inside and around the window that broke. 18:30 UTC is exactly
 * midnight in India, so anything between 18:30 and 24:00 UTC is "tomorrow"
 * for a rep and "today" for the server.
 */
const INSTANTS = [
  "2026-09-04T20:45:00.000Z", // 02:15 IST on the 5th — what the outage looked like
  "2026-09-04T18:30:01.000Z", // one second into the danger window
  "2026-09-04T18:29:59.000Z", // one second before it
  "2026-09-04T09:00:00.000Z", // the middle of a working day, when all is well
  "2026-12-31T19:30:00.000Z", // across a year boundary
];

beforeEach(() => {
  process.env.TZ = ORIGINAL_TZ;
  vi.resetModules();
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
  vi.resetModules();
});

describe("dates are formatted the same wherever the code runs", () => {
  it("gives every timezone the same answer for the same instant", async () => {
    for (const instant of INSTANTS) {
      const rendered = new Set<string>();
      for (const tz of ZONES) {
        const dates = await datesModuleIn(tz);
        rendered.add(
          [
            dates.formatDate(instant),
            dates.formatDateTime(instant),
            dates.formatTime(instant),
          ].join(" | "),
        );
      }
      // One distinct rendering across five wildly different runtimes.
      expect(rendered.size, `${instant} rendered differently per timezone`).toBe(
        1,
      );
    }
  });

  it("gives every timezone the same answer for a date-only value", async () => {
    // The other half of the trap: "2026-09-04" read as local midnight in a zone
    // behind UTC is the 3rd. It has to stay the day that is in the database.
    const rendered = new Set<string>();
    for (const tz of ZONES) {
      const dates = await datesModuleIn(tz);
      rendered.add(dates.formatDate("2026-09-04"));
    }
    expect(rendered.size).toBe(1);
    expect([...rendered][0]).toBe("4 Sep 2026");
  });

  it("agrees on today's calendar day whatever the runtime clock says", async () => {
    // Fixed instant: 02:15 IST on the 5th, still the 4th in UTC. A server and a
    // browser looking at this moment must name the same day.
    const midnightWindow = new Date("2026-09-04T20:45:00.000Z");
    const answers = new Set<string>();
    for (const tz of ZONES) {
      const dates = await datesModuleIn(tz);
      answers.add(dates.todayInAppZone(midnightWindow));
    }
    expect(answers.size).toBe(1);
    expect([...answers][0]).toBe("2026-09-05");
  });
});

describe("dates are read in India", () => {
  it("pins the zone to Asia/Kolkata", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Kolkata");
  });

  /*
   * The wording half of the guard, and the reason dates.ts carries its own
   * month names. Pinning the zone is not enough: month abbreviations come from
   * CLDR and CLDR revises them — en-GB's September became "Sept" in 2022 — so
   * a formatter that asks a locale for the word will print one thing on a
   * current Worker and another on an older Android browser, which is the
   * hydration mismatch again. Hand these back to Intl and this test goes red.
   */
  it("spells every month the same way on every runtime", () => {
    expect(formatDate("2026-09-04")).toBe("4 Sep 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDate("2026-12-31")).toBe("31 Dec 2026");

    const spelled = Array.from({ length: 12 }, (_, i) =>
      formatDate(`2026-${String(i + 1).padStart(2, "0")}-15`),
    );
    expect(spelled).toEqual([
      "15 Jan 2026",
      "15 Feb 2026",
      "15 Mar 2026",
      "15 Apr 2026",
      "15 May 2026",
      "15 Jun 2026",
      "15 Jul 2026",
      "15 Aug 2026",
      "15 Sep 2026",
      "15 Oct 2026",
      "15 Nov 2026",
      "15 Dec 2026",
    ]);
  });

  it("reads a timestamp as the Indian day, not the UTC one", () => {
    const midnightWindow = "2026-09-04T20:45:00.000Z";
    expect(formatDate(midnightWindow)).toBe("5 Sep 2026");
    expect(formatDateTime(midnightWindow)).toBe("5 Sep 2026, 02:15");
    expect(formatTime(midnightWindow)).toBe("02:15");
  });

  it("crosses the day at midnight IST, not midnight UTC", () => {
    expect(formatDate("2026-09-04T18:29:59.000Z")).toBe("4 Sep 2026");
    expect(formatDate("2026-09-04T18:30:01.000Z")).toBe("5 Sep 2026");
  });

  it("names today in Asia/Kolkata", () => {
    expect(todayInAppZone(new Date("2026-09-04T18:29:59.000Z"))).toBe("2026-09-04");
    expect(todayInAppZone(new Date("2026-09-04T18:30:01.000Z"))).toBe("2026-09-05");
  });
});

describe("unusable values", () => {
  it("returns an empty string rather than 'Invalid Date'", () => {
    for (const bad of [null, undefined, "", "not-a-date"]) {
      expect(formatDate(bad)).toBe("");
      expect(formatDateTime(bad)).toBe("");
      expect(formatTime(bad)).toBe("");
    }
  });

  it("takes a Date as readily as a string, and agrees with itself", () => {
    const iso = "2026-09-04T20:45:00.000Z";
    expect(formatDate(new Date(iso))).toBe(formatDate(iso));
    expect(formatDateTime(new Date(iso))).toBe(formatDateTime(iso));
  });
});

describe("the week range is pinned the same way", () => {
  it("prints the stored week wherever it runs", async () => {
    const rendered = new Set<string>();
    for (const tz of ZONES) {
      process.env.TZ = tz;
      vi.resetModules();
      const weeks = await import("@/lib/weeks");
      rendered.add(weeks.formatWeekRange("2026-08-31"));
    }
    expect(rendered.size).toBe(1);
    // Monday 31 August to Saturday 5 September 2026.
    expect([...rendered][0]).toBe("31 Aug – 5 Sep 2026");
  });

  it("does not drift across a year boundary", () => {
    expect(formatWeekRange("2026-12-28")).toBe("28 Dec – 2 Jan 2027");
  });
});

/*
 * Scenario 8 of the client test plan: adding to today's plan with nothing
 * selected added nothing and said nothing. The schema was already rejecting it;
 * what was missing was a sentence a rep could read.
 */
describe("adding to today's plan explains what is missing", () => {
  it("rejects an empty institute with a message worth reading", () => {
    const parsed = dailyPlanSchema.safeParse({ institute_id: "", purpose: "Demo" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const messages = parsed.error.issues.map((issue) => issue.message);
    expect(messages).toContain("Pick a registered institute for this planned visit.");
  });

  it("rejects an empty purpose too", () => {
    const parsed = dailyPlanSchema.safeParse({
      institute_id: "3f1d4f4e-2b6a-4f1a-9f4e-9d2c1b0a7e55",
      purpose: "   ",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((i) => i.message)).toContain(
      "Choose what this visit is for.",
    );
  });

  it("accepts a real pair", () => {
    expect(
      dailyPlanSchema.safeParse({
        institute_id: "3f1d4f4e-2b6a-4f1a-9f4e-9d2c1b0a7e55",
        purpose: "Book display",
      }).success,
    ).toBe(true);
  });

  it("repeats the one problem, and generalises two", () => {
    expect(dailyPlanSummary({ institute_id: "Pick a registered institute." })).toBe(
      "Pick a registered institute.",
    );
    expect(
      dailyPlanSummary({ institute_id: "one", purpose: "two" }),
    ).toBe("Pick an institute and a purpose before adding this to today's plan.");
  });
});
