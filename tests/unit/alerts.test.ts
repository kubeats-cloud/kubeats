import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ALERT_KINDS, describeAlert, type AlertEvent } from "@/lib/alerts";
import {
  METRICS,
  METRIC_KEYS,
  targetsSchema,
  targetsFormDataToInput,
} from "@/lib/validation/weekly";
import { metricsMissingFromExport } from "@/lib/exports/activity-grid";

/**
 * Phase E1's rules, as far as they can be proven without a database.
 *
 * What this file CANNOT prove is what E1 actually rests on: that
 * materialise_daily_alerts() writes one row per rep per day, is idempotent
 * across two runs, is not callable by `authenticated`, and that a rep reads
 * only their own rows. Those are claims about a function body and four
 * policies, and only a real database answers them — the `alert_events` block in
 * tests/integration/rules.test.ts does.
 *
 * What is here: the wording, the optional calls target, and — the guard that
 * matters most — that `calls` has not quietly become a ninth metric.
 */

const alert = (over: Partial<AlertEvent> = {}): AlertEvent => ({
  id: "a1",
  kind: "follow_ups_due",
  forDate: "2026-10-07",
  count: 3,
  weekStart: null,
  seenAt: null,
  ...over,
});

describe("what each alert says", () => {
  it("has wording for all five kinds, and never an empty sentence", () => {
    for (const kind of ALERT_KINDS) {
      const described = describeAlert(alert({ kind }));
      expect(described.title, kind).toBeTruthy();
      expect(described.detail, kind).toBeTruthy();
    }
  });

  /**
   * A count of 1 must not read "1 follow-ups". The sentence is built from the
   * number, so this is a real failure mode rather than a style point — it is
   * the one thing in this module a rep reads every morning.
   */
  it("agrees in number", () => {
    expect(describeAlert(alert({ count: 1 })).title).toContain("1 follow-up due");
    expect(describeAlert(alert({ count: 1 })).title).not.toContain("follow-ups");
    expect(describeAlert(alert({ count: 4 })).title).toContain("4 follow-ups due");
  });

  /**
   * ⚠ EVERY KIND AT n = 1, and the verb as well as the noun.
   *
   * This is here because the first live render of the banner said "1 follow-up
   * WERE missed" on a rep's dashboard. The earlier test above pluralised the
   * noun correctly and only ever checked `follow_ups_due`, so a kind whose
   * sentence carries a verb went straight past it. Checking one kind is what
   * let that through; this checks all five.
   */
  it("reads as English at one, for every kind", () => {
    for (const kind of ALERT_KINDS) {
      const { title } = describeAlert(alert({ kind, count: 1, weekStart: "2026-10-12" }));
      expect(title, kind).not.toMatch(/1 follow-ups/);
      expect(title, kind).not.toMatch(/follow-up were/);
      expect(title, kind).not.toMatch(/follow-ups was/);
    }
    expect(describeAlert(alert({ kind: "follow_ups_missed", count: 1 })).title)
      .toBe("1 follow-up was missed");
    expect(describeAlert(alert({ kind: "follow_ups_missed", count: 3 })).title)
      .toBe("3 follow-ups were missed");
  });

  /**
   * Only `follow_ups_missed` is red. The 09:00 and 16:00 alerts are about work
   * in hand, not work failed, and painting them red would make an ordinary
   * morning look like a bad one.
   */
  it("reserves danger for the miss", () => {
    for (const kind of ALERT_KINDS) {
      const { tone } = describeAlert(alert({ kind }));
      expect(tone, kind).toBe(kind === "follow_ups_missed" ? "danger" : "warning");
    }
  });

  it("names the week it is warning about, when it has one", () => {
    const withWeek = describeAlert(
      alert({ kind: "weekly_plan_not_set", count: null, weekStart: "2026-10-12" }),
    );
    expect(withWeek.detail).toContain("2026-10-12");
    // And degrades rather than printing "undefined" when the payload has none.
    const without = describeAlert(
      alert({ kind: "weekly_plan_not_set", count: null, weekStart: null }),
    );
    expect(without.detail).not.toMatch(/null|undefined/);
  });
});

/* ------------------------------------------------------------------ */

describe("the optional calls target", () => {
  const week = {
    week_start: "2026-10-05",
    meetings: "5",
    sessions_set: "2",
    sessions_done: "1",
    campus_visits_set: "0",
    campus_visits_done: "0",
    olympiad: "3",
    application: "4",
    admission: "1",
  };

  it("accepts a number", () => {
    const parsed = targetsSchema.safeParse({ ...week, calls: "40" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.calls).toBe(40);
  });

  /**
   * ⚠ BLANK IS NULL, NOT ZERO, and this is the assertion the whole column
   * shape exists for. `count` maps "" to 0 because a rep answers all eight;
   * this one they may decline. If blank ever became 0 the Targets screen would
   * show a bar at 0% for a rep who declined the field, and 0040's nullable
   * column would never hold a null.
   */
  it("treats a blank as no commitment, not as a commitment to zero", () => {
    const parsed = targetsSchema.safeParse({ ...week, calls: "" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.calls).toBeNull();
  });

  it("keeps an explicit zero as a zero", () => {
    const parsed = targetsSchema.safeParse({ ...week, calls: "0" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.calls).toBe(0);
  });

  /**
   * ⚠ THE DEPLOY RULE. A Targets page cached from before this field existed
   * posts a form with no `calls` key at all. A required key would refuse that
   * rep's entire week over a control that is not on their screen — the same
   * failure the Phase A fields had before the existing suite caught it.
   */
  it("accepts a submission from a page that predates the field", () => {
    const parsed = targetsSchema.safeParse(week);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.calls).toBeNull();
  });

  it("refuses something that is not a number", () => {
    expect(targetsSchema.safeParse({ ...week, calls: "many" }).success).toBe(false);
  });

  it("reads the field off the form the component posts", () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(week)) fd.set(k, v);
    fd.set("calls", "25");
    expect(targetsFormDataToInput(fd).calls).toBe("25");
  });
});

/* ------------------------------------------------------------------ */

describe("the separation E1 rests on, at source level", () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

  /**
   * ⚠ THE GUARD THAT MATTERS MOST IN THIS FILE.
   *
   * `calls` must never join METRICS. Seven of the eight metrics are counted by
   * (activity, lifecycle_status), ACTIVITY_COLUMNS folds all eight into six
   * export columns, and metricsMissingFromExport() asserts that mapping is
   * exhaustive. A ninth entry would either fail that assertion or widen the
   * client's .xlsx template — and no activity could ever feed it, because a
   * call is not a visit. `targets.institutes_covered` is the precedent.
   */
  it("keeps calls out of METRICS", () => {
    expect(METRIC_KEYS).toHaveLength(8);
    expect(METRIC_KEYS).not.toContain("calls");
    expect(METRICS.some((m) => (m.key as string) === "calls")).toBe(false);
  });

  /** The export mapping is still exhaustive — unchanged by E1, and proven so. */
  it("leaves the eight-to-six export mapping complete", () => {
    expect(metricsMissingFromExport()).toEqual([]);
  });

  /** It is written by name, never through the loop that walks METRIC_KEYS. */
  it("writes calls outside the METRIC_KEYS loop", () => {
    const actions = read("src/lib/target-actions.ts");
    expect(actions).toContain("payload.calls = input.calls");
  });

  /**
   * The column is nullable in 0040, and the migration asserts that itself.
   * Checked here too because the schema's null is meaningless if the column
   * cannot store one.
   */
  it("declares targets.calls nullable, and covers it in the rebuilt CHECK", () => {
    const sql = read("supabase/migrations/0040_alert_events.sql");
    expect(sql).toContain("add column if not exists calls integer;");
    expect(sql).not.toMatch(/calls integer not null/);
    expect(sql).toContain("(calls is null or calls >= 0)");
    // Every original column must have survived the drop-and-re-add.
    for (const key of [...METRIC_KEYS, "institutes_covered"]) {
      expect(sql, `${key} lost from targets_non_negative`).toContain(`${key} >= 0`);
    }
  });

  /**
   * The five schedules are stated in UTC. India has no DST, so these are the
   * IST times they claim to be — and a change to one of them has to be made in
   * two places, which this pins.
   */
  it("schedules all five jobs and teaches the health monitor their names", () => {
    const sql = read("supabase/migrations/0040_alert_events.sql");
    const route = read("src/app/api/health/route.ts");
    const jobs = [
      "alerts-follow-ups-due",
      "alerts-day-plan-not-set",
      "alerts-follow-ups-pending",
      "alerts-follow-ups-missed",
      "alerts-weekly-plan-not-set",
    ];
    for (const job of jobs) {
      expect(sql, `${job} not scheduled`).toContain(`cron.schedule('${job}'`);
      expect(sql, `${job} unknown to health_cron_jobs`).toContain(`'${job}'`);
      expect(route, `${job} unknown to the health route`).toContain(`"${job}"`);
    }
    // 0031's own two must not have been dropped from the rewritten list.
    expect(route).toContain('"purge-visit-photos"');
    expect(route).toContain('"sweep-open-checkins"');
  });

  /**
   * ⚠ THE FUNCTION IS SERVICE-ROLE ONLY AND HAS NO is_admin() GUARD — both
   * halves deliberate, and both easy to "fix" wrongly. cron runs with no
   * auth.uid(), so an is_admin() guard would make the job refuse itself every
   * night, silently, for ever. The revokes are what protect it instead.
   */
  it("keeps materialise_daily_alerts service-role only", () => {
    const sql = read("supabase/migrations/0040_alert_events.sql");
    expect(sql).toContain(
      "revoke all on function public.materialise_daily_alerts(text) from authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.materialise_daily_alerts(text) to service_role;",
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
  });

  /**
   * Nobody may insert or delete an alert. The missed record counts these rows,
   * so an insert grant is a way to manufacture a miss against a colleague and a
   * delete grant is a way to erase one.
   */
  it("grants a rep nothing but select and seen_at", () => {
    const sql = read("supabase/migrations/0040_alert_events.sql");
    expect(sql).toContain("grant select on public.alert_events to authenticated;");
    expect(sql).toContain(
      "grant update (seen_at) on public.alert_events to authenticated;",
    );
    expect(sql).not.toMatch(/grant insert[^;]*on public\.alert_events/);
    expect(sql).not.toMatch(/grant delete[^;]*on public\.alert_events/);
  });

  /** Every date the function computes is the Kolkata day, never current_date. */
  it("dates every row from app_today()", () => {
    const sql = read("supabase/migrations/0040_alert_events.sql");
    const fn = sql.slice(sql.indexOf("create or replace function public.materialise_daily_alerts"));
    const body = fn.slice(0, fn.indexOf("\ncomment on function"));
    expect(body).toContain("public.app_today()");

    /*
     * Comments STRIPPED before the check, which is the difference between a
     * test and a word search. The body explains at length why it does not use
     * `current_date`, and matching that prose would fail the moment the file
     * documents its own rule — so the assertion reads the SQL, not the essay
     * around it. `--` to end of line and block comments both go; the `$$`
     * delimiters survive because nothing else here looks like a comment.
     */
    const code = body
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/--[^\n]*/g, "");
    expect(code).toContain("public.app_today()");
    expect(code).not.toContain("current_date");
    expect(code).not.toContain("now()::date");
    expect(sql).toContain("for_date    date not null default public.app_today()");
  });

  /** The app never writes an alert — only cron does. */
  it("has no insert path in src/", () => {
    const actions = read("src/lib/alert-actions.ts");
    expect(actions).not.toMatch(/\.from\("alert_events"\)[\s\S]{0,80}\.insert/);
    expect(actions).not.toMatch(/\.from\("alert_events"\)[\s\S]{0,80}\.delete/);
    // The one write it does make is seen_at and nothing else.
    expect(actions).toContain("seen_at:");
  });
});
