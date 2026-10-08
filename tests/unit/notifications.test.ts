import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ALERT_KINDS, describeAlert } from "@/lib/alert-kinds";
import { PHASE_A_DAILY_PLAN } from "@/lib/features";
import {
  PHASE_A_KINDS,
  VISIBLE_FROM_IST_HOUR,
  VISIBLE_ON_ISO_DOW,
  hrefFor,
  isoDayOfWeek,
  kindIsEnabled,
  nextMonday,
  visibleNow,
} from "@/lib/notification-kinds";

/**
 * The notification bell's pure half.
 *
 * Everything here is reachable without a database because the logic that
 * DECIDES what the bell shows is split from the queries that fetch it — the
 * same split `alert-kinds.ts` made from `alerts.ts`, and the reason this file
 * can import the module at all.
 *
 * The scoping half — a rep seeing only their own, a lead only their own reps'
 * — is NOT here and cannot be: it is enforced by RLS, so only a real database
 * can tell you whether it still works. That lives in the integration suite.
 */

const ORIGINAL_TZ = process.env.TZ;

/** 0040, read once, for the assertions that check this code against it. */
const sqlForDow = readFileSync(
  "supabase/migrations/0040_alert_events.sql",
  "utf8",
);

async function datesModuleIn(tz: string) {
  process.env.TZ = tz;
  vi.resetModules();
  return import("@/lib/dates");
}

const ZONES = [
  "UTC",
  "Asia/Kolkata",
  "America/Los_Angeles",
  "Pacific/Kiritimati",
];

describe("istHour reads the Indian clock wherever the code runs", () => {
  /*
   * ⚠ THIS IS THE TEST THE 16:00 NUDGE DEPENDS ON. The server runs in UTC, so
   * `new Date().getHours()` would answer 10 for an Indian 16:00 and every
   * threshold would fire five and a half hours late. Each instant below is
   * chosen so UTC and IST disagree about the hour, and often about the day.
   */
  const CASES: [string, number][] = [
    // 10:30 UTC is 16:00 IST — the afternoon nudge, exactly on its threshold.
    ["2026-10-08T10:30:00Z", 16],
    // 13:30 UTC is 19:00 IST — the missed threshold, exactly.
    ["2026-10-08T13:30:00Z", 19],
    // 04:30 UTC is 10:00 IST — the plan-not-set threshold.
    ["2026-10-08T04:30:00Z", 10],
    // 18:30 UTC is 00:00 IST the NEXT day: the hour must be 0, not 24.
    ["2026-10-08T18:30:00Z", 0],
    // 20:00 UTC is 01:30 IST tomorrow — still the small hours, not the evening.
    ["2026-10-08T20:00:00Z", 1],
  ];

  for (const tz of ZONES) {
    it(`is the Kolkata hour under TZ=${tz}`, async () => {
      const { istHour } = await datesModuleIn(tz);
      for (const [instant, expected] of CASES) {
        expect(istHour(new Date(instant)), `${instant} under ${tz}`).toBe(
          expected,
        );
      }
    });
  }

  it("restores the timezone", async () => {
    process.env.TZ = ORIGINAL_TZ;
    vi.resetModules();
    expect(true).toBe(true);
  });
});

describe("the thresholds match migration 0040's schedule", () => {
  /*
   * ⚠ THE GUARD THAT STOPS THE TWO DRIFTING. `VISIBLE_FROM_IST_HOUR` is a COPY
   * of 0040's cron times — pg_cron's schedule is not queryable through
   * PostgREST, so the bell cannot read it and has to restate it. This reads the
   * migration FILE and fails if those times move, which is the only way a copy
   * stays honest.
   *
   * The cron lines are UTC (India has no DST, so +05:30 is permanently
   * correct): 03:30 UTC = 09:00 IST, 10:30 = 16:00, 13:30 = 19:00, 04:30 =
   * 10:00.
   */
  const sql = readFileSync("supabase/migrations/0040_alert_events.sql", "utf8");

  /*
   * Every schedule parsed in ONE pass, keyed by the kind its $job$ body calls.
   *
   * ⚠ BUILT AS A MAP RATHER THAN SEARCHED PER KIND, and the first version of
   * this got it wrong in the way that matters: a regex that searched forward
   * from `cron.schedule` for a kind name matched the FIRST statement every
   * time, so all five kinds "agreed" at 09:00 and three assertions failed for
   * one reason. A guard that returns the same answer whatever you ask it is
   * worse than no guard — so the kind is captured from the SAME match as its
   * time, and the test below asserts all five were actually found.
   */
  const SCHEDULE = new Map<string, number>();
  const STATEMENT =
    /cron\.schedule\(\s*'[^']*',\s*'(\d{1,2}) (\d{1,2}) [^']*',\s*\$job\$[\s\S]*?materialise_daily_alerts\('(\w+)'\)/g;

  for (const m of sql.matchAll(STATEMENT)) {
    const minute = Number(m[1]);
    const hourUtc = Number(m[2]);
    // UTC -> IST, +5:30. Every job is on the half hour, so +5h30m lands on the
    // hour exactly; the modulo covers a job ever scheduled past 18:30 UTC.
    SCHEDULE.set(m[3], (hourUtc + 5 + Math.floor((minute + 30) / 60)) % 24);
  }

  const scheduleFor = (kind: string): number | null =>
    SCHEDULE.get(kind) ?? null;

  it("found a cron schedule for all five kinds", () => {
    // The guard on the guard: if 0040's schedule block is ever reformatted so
    // the pattern stops matching, every assertion below would compare null to
    // null and pass. This is what fails instead.
    expect([...SCHEDULE.keys()].sort()).toEqual([...ALERT_KINDS].sort());
  });

  it("fires the afternoon nudge at 16:00 IST", () => {
    expect(scheduleFor("follow_ups_pending")).toBe(
      VISIBLE_FROM_IST_HOUR.follow_ups_pending,
    );
  });

  it("fires the missed check at 19:00 IST", () => {
    expect(scheduleFor("follow_ups_missed")).toBe(
      VISIBLE_FROM_IST_HOUR.follow_ups_missed,
    );
  });

  it("fires the plan-not-set check at 10:00 IST", () => {
    expect(scheduleFor("day_plan_not_set")).toBe(
      VISIBLE_FROM_IST_HOUR.day_plan_not_set,
    );
  });

  /*
   * `follow_ups_due` is deliberately NOT asserted against the cron time. 0040
   * writes that row at 09:00, but the bell shows it from midnight: a follow-up
   * due today is owed from the start of the day, and a bell that stayed empty
   * until 09:00 would be wrong for the rep who opens the app at 08:00. Stated
   * here so the omission reads as a decision rather than a gap.
   */
  it("shows a due follow-up from the start of the Indian day", () => {
    expect(VISIBLE_FROM_IST_HOUR.follow_ups_due).toBe(0);
    expect(scheduleFor("follow_ups_due")).toBe(9);
  });
});

/*
 * Two reference days, so a day-of-week gate can be tested without the answer
 * depending on when the suite is run. 0040's weekly job fires on a SUNDAY, and
 * 2026-10-11 is one; 2026-10-08 is the Thursday before it.
 */
const THURSDAY = "2026-10-08";
const SUNDAY = "2026-10-11";

describe("the clock gates each kind", () => {
  it("is Thursday and Sunday as the names claim", () => {
    // The fixtures themselves, asserted — a wrong assumption here would make
    // every day-gate test below pass for the wrong reason.
    expect(isoDayOfWeek(THURSDAY)).toBe(4);
    expect(isoDayOfWeek(SUNDAY)).toBe(7);
  });

  /** ⚠ THE AFTERNOON NUDGE: absent before 16:00 IST, present from 16:00. */
  it("holds the afternoon nudge until 16:00", () => {
    expect(visibleNow("follow_ups_pending", 0, THURSDAY)).toBe(false);
    expect(visibleNow("follow_ups_pending", 9, THURSDAY)).toBe(false);
    expect(visibleNow("follow_ups_pending", 15, THURSDAY)).toBe(false);
    // The boundary itself, from both sides.
    expect(visibleNow("follow_ups_pending", 16, THURSDAY)).toBe(true);
    expect(visibleNow("follow_ups_pending", 18, THURSDAY)).toBe(true);
    expect(visibleNow("follow_ups_pending", 23, THURSDAY)).toBe(true);
  });

  /** ⚠ THE MISSED LINE: absent before 19:00 IST, present from 19:00. */
  it("holds the missed line until 19:00", () => {
    expect(visibleNow("follow_ups_missed", 0, THURSDAY)).toBe(false);
    expect(visibleNow("follow_ups_missed", 16, THURSDAY)).toBe(false);
    expect(visibleNow("follow_ups_missed", 18, THURSDAY)).toBe(false);
    expect(visibleNow("follow_ups_missed", 19, THURSDAY)).toBe(true);
    expect(visibleNow("follow_ups_missed", 23, THURSDAY)).toBe(true);
  });

  it("shows a due follow-up at any hour", () => {
    expect(visibleNow("follow_ups_due", 0, THURSDAY)).toBe(true);
    expect(visibleNow("follow_ups_due", 8, THURSDAY)).toBe(true);
    expect(visibleNow("follow_ups_due", 23, THURSDAY)).toBe(true);
  });

  it("never fires a threshold at midnight by reading the hour as 24", () => {
    // The h23 hourCycle in dates.ts is what makes this true; if an engine
    // returned "24" for midnight, every evening threshold would be live at
    // 00:00 and a rep would get the missed line as the day began.
    for (const kind of ALERT_KINDS) {
      if (VISIBLE_FROM_IST_HOUR[kind] > 0) {
        expect(visibleNow(kind, 0, SUNDAY), `${kind} at midnight`).toBe(false);
      }
    }
  });
});

describe("the weekly nudge is live, and only on a Sunday evening", () => {
  it("is not a Phase A kind any more", () => {
    expect(PHASE_A_KINDS.has("weekly_plan_not_set")).toBe(false);
    // And is therefore enabled whatever the flag says.
    expect(kindIsEnabled("weekly_plan_not_set")).toBe(true);
  });

  /*
   * ⚠ THE GATE THAT REPLACED THE FLAG. The predicate asks about NEXT week, and
   * 0040 fires it once, on Sunday evening. Without a day gate a rep who has not
   * set next week's targets would carry a badge every evening from Monday —
   * a permanent nag about a week six days away, which is how a bell gets
   * ignored. The hour gate alone is not enough and this is the proof.
   */
  it("stays silent all day on a day that is not Sunday", () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(
        visibleNow("weekly_plan_not_set", hour, THURSDAY),
        `Thursday ${hour}:00`,
      ).toBe(false);
    }
  });

  it("appears on Sunday from 19:00 and not before", () => {
    expect(visibleNow("weekly_plan_not_set", 18, SUNDAY)).toBe(false);
    expect(visibleNow("weekly_plan_not_set", 19, SUNDAY)).toBe(true);
    expect(visibleNow("weekly_plan_not_set", 23, SUNDAY)).toBe(true);
  });

  it("matches the day 0040 schedules it for", () => {
    // Read out of the migration rather than restated, so moving the cron line
    // fails here. dow 0 in cron is Sunday, which is 7 in ISO.
    const m = sqlForDow.match(
      /cron\.schedule\(\s*'alerts-weekly-plan-not-set',\s*'\d{1,2} \d{1,2} \* \* (\d)'/,
    );
    expect(m, "0040's weekly cron line was not found").not.toBeNull();
    const cronDow = Number(m![1]);
    expect(cronDow).toBe(0); // cron Sunday
    expect(VISIBLE_ON_ISO_DOW.weekly_plan_not_set).toBe(7); // ISO Sunday
  });
});

describe("only the daily plan stays dark behind the flag", () => {
  it("matches the flag", () => {
    // Written against the flag rather than against `false`, so this keeps
    // asserting the right thing on the day the redo ships and it flips.
    for (const kind of ALERT_KINDS) {
      const expected = PHASE_A_DAILY_PLAN || !PHASE_A_KINDS.has(kind);
      expect(kindIsEnabled(kind), kind).toBe(expected);
    }
  });

  it("gates the daily plan and nothing else", () => {
    expect([...PHASE_A_KINDS]).toEqual(["day_plan_not_set"]);
  });

  it("shows no daily-plan item at any hour while the flag is off", () => {
    if (PHASE_A_DAILY_PLAN) return;
    for (let hour = 0; hour < 24; hour++) {
      expect(
        visibleNow("day_plan_not_set", hour, THURSDAY),
        `hour ${hour}`,
      ).toBe(false);
    }
  });
});

describe("every line goes somewhere a rep can act", () => {
  it("has a destination for every kind", () => {
    for (const kind of ALERT_KINDS) {
      expect(hrefFor(kind), kind).toMatch(/^\//);
    }
  });

  /*
   * ⚠ FOLLOW-UPS MUST NOT POINT AT THE DASHBOARD. `describeAlert()`'s detail
   * copy still says "They are on your dashboard under Follow-up calls", which
   * is behind PHASE_A_DAILY_PLAN and therefore not there. Pending's "Due today"
   * block is deliberately ungated and is the only place a rep can close one.
   */
  it("sends follow-ups to Pending, not the dashboard", () => {
    expect(hrefFor("follow_ups_due")).toBe("/pending");
    expect(hrefFor("follow_ups_pending")).toBe("/pending");
  });

  it("sends the missed line to the record", () => {
    expect(hrefFor("follow_ups_missed")).toBe("/missed");
  });
});

describe("next week's Monday agrees with 0040", () => {
  // 0040 uses date_trunc('week', today) + 7, which is ISO — Monday-based.
  it("picks the following Monday from any day of the week", () => {
    expect(nextMonday("2026-10-05")).toBe("2026-10-12"); // a Monday
    expect(nextMonday("2026-10-08")).toBe("2026-10-12"); // a Thursday
    expect(nextMonday("2026-10-10")).toBe("2026-10-12"); // a Saturday
    expect(nextMonday("2026-10-11")).toBe("2026-10-12"); // a SUNDAY — the day
    // the job actually runs, and the one an off-by-one would break
  });

  it("is stable under every timezone", async () => {
    for (const tz of ZONES) {
      process.env.TZ = tz;
      expect(nextMonday("2026-10-11"), tz).toBe("2026-10-12");
    }
    process.env.TZ = ORIGINAL_TZ;
  });
});

describe("the bell reuses the alert vocabulary", () => {
  it("renders a sentence for every kind", () => {
    for (const kind of ALERT_KINDS) {
      const { title, detail } = describeAlert({
        id: "x",
        kind,
        forDate: "2026-10-08",
        count: 1,
        weekStart: "2026-10-12",
        seenAt: null,
      });
      expect(title.length, kind).toBeGreaterThan(0);
      expect(detail.length, kind).toBeGreaterThan(0);
      // The singular case: the pluralisation bug this guards against shipped
      // once as "1 follow-up were missed".
      expect(title, kind).not.toMatch(/\bwere\b/);
    }
  });
});
