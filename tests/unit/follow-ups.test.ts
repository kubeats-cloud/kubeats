import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { attributeToCurrentStatus } from "@/lib/visits";
import {
  SEED_STATUS_CATALOGUE,
  isOpenStatus,
  statusRow,
} from "@/lib/validation/institute";

/**
 * Stage 5 — Pending means "still owed", and asks the managed vocabulary.
 *
 * The query itself needs a database, so these cover the two halves that do not:
 * WHICH statuses belong on the screen (a pure question of the catalogue), and
 * the source-level guarantees that the launch flow is the ordinary chain rather
 * than a second one.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

describe("only OPEN statuses are owed", () => {
  it("puts exactly the five open statuses on Pending", () => {
    const open = SEED_STATUS_CATALOGUE.filter((r) => r.category === "open").map(
      (r) => r.status,
    );
    expect(open).toEqual([
      "First meeting done",
      "Session scheduled",
      "Campus visit scheduled",
      "Pending for management approval",
      "Invited principal for event",
    ]);
  });

  it("keeps the four closed ones off it", () => {
    // A finished loop is not owed. "Will not come" in particular: a firm no is
    // an answer, and a screen that kept asking about it would be a to-do list
    // nobody could ever empty.
    for (const status of [
      "Session done",
      "Campus visit done",
      "RSVP received",
      "Will not come",
    ]) {
      expect(isOpenStatus(SEED_STATUS_CATALOGUE, status), status).toBe(false);
    }
  });

  it("would carry a status an ADMIN adds, with no code change", () => {
    // The point of stages 4a and 4b arriving before this one. Pending asks the
    // catalogue for its open statuses; it holds no list of its own, so a status
    // added yesterday is on the screen today.
    const withAdded = [
      ...SEED_STATUS_CATALOGUE,
      {
        status: "Awaiting trustee sign-off",
        category: "open" as const,
        tone: "danger" as const,
        sortOrder: 100,
        isActive: true,
        asksExpectedDate: false,
        asksSessionDetail: false,
        asksHeadCount: false,
      },
    ];
    expect(isOpenStatus(withAdded, "Awaiting trustee sign-off")).toBe(true);
    expect(
      withAdded.filter((r) => r.category === "open").map((r) => r.status),
    ).toContain("Awaiting trustee sign-off");
  });

  it("gives every open status a badge tone to render with", () => {
    // Pending colours each row by the status's own tone. A missing one would be
    // an unstyled badge on the screen a rep works from most.
    for (const row of SEED_STATUS_CATALOGUE.filter((r) => r.category === "open")) {
      expect(statusRow(SEED_STATUS_CATALOGUE, row.status)?.tone, row.status).toBeTruthy();
    }
  });
});

describe("the launch is the ordinary chain, not a parallel one", () => {
  const action = read("src/lib/visit-actions.ts");

  it("seeds a plan row and hands back to the Dashboard", () => {
    // CLAUDE.md: the Dashboard owns the daily-plan create-and-track flow, and a
    // second writer in front of the row Rule 2 checks is what screen ownership
    // exists to prevent. Seeding and handing over is what keeps that true —
    // there is still exactly one screen where a visit is tracked.
    expect(action).toContain("export async function startFollowUp");
    expect(action).toContain('redirect("/?followup=1")');
  });

  it("never checks in, logs or reports on the rep's behalf", () => {
    // If this ever grew any of those it would be a second flow, and the photo,
    // the presence guarantee and the meeting gate would all need re-proving on
    // it. The whole design is that they do not.
    const follow = action.slice(action.indexOf("export async function startFollowUp"));
    const body = follow.slice(0, follow.indexOf("export async function removeFromDailyPlan"));
    expect(body).not.toContain("checkin_at:");
    expect(body).not.toContain("log_visit");
    expect(body).not.toContain("close_visit");
  });

  it("refuses an admin in the ACTION, not only in the view", () => {
    // D10. The read-only prop decides what is rendered; this decides what can
    // happen. A prop is not a permission.
    const follow = action.slice(action.indexOf("export async function startFollowUp"));
    expect(follow.slice(0, 3000)).toMatch(/isAdmin\(/);
  });

  it("resolves the purpose server-side and re-checks its note rule", () => {
    // The purpose decides the activity and therefore the weekly metric, so a
    // tampered form must not be able to choose one. Same reasoning as
    // addToDailyPlan.
    const follow = action.slice(action.indexOf("export async function startFollowUp"));
    const body = follow.slice(0, follow.indexOf("export async function removeFromDailyPlan"));
    expect(body).toContain('.eq("is_active", true)');
    expect(body).toContain("purposeRow.requires_note");
  });

  it("does not overwrite the purpose of a visit already in progress", () => {
    // guard_checkin_cycle_final (FO014) guards the DELETE path; nothing in the
    // database guards this one. Overwriting would change what a visit counts as
    // mid-visit, from a screen the rep is not looking at.
    //
    // THE SPELLING MOVED WITH MIGRATION 0033, the invariant did not. This read
    // `existing?.checkin_at`, off a `.maybeSingle()` that was correct only
    // while `daily_plans_unique_per_day` guaranteed one row per institute per
    // day. Once a day can hold several, that call throws PGRST116 rather than
    // returning the second row — so the action reads the LIST and asks whether
    // any entry is still live. The guarantee is the same one: a row that is
    // unstarted or in progress is handed back untouched, and only its absence
    // lets a new row be written.
    const follow = action.slice(action.indexOf("export async function startFollowUp"));
    const body = follow.slice(0, follow.indexOf("export async function removeFromDailyPlan"));

    // The live-row test, and the insert guarded by its absence.
    expect(body).toContain("const live = rows.find(");
    expect(body).toContain("row.checkin_at === null");
    expect(body).toContain("if (!live) {");

    /*
     * ...and the ONE call that would throw is gone.
     *
     * Asserted against this query rather than against the whole action, because
     * two other `.maybeSingle()` calls live in it and both are safe: the FO013
     * "are you open elsewhere" check is `.limit(1)`-bounded, and the purpose
     * lookup reads `purposes.label`, which is UNIQUE. A blanket ban would fail
     * on those and teach the next reader that maybeSingle is the problem. It is
     * not — matching on something that stopped being unique is.
     */
    const existing = body.slice(body.indexOf("const { data: existingRows"));
    const query = existing.slice(0, existing.indexOf(";"));
    expect(query).toContain('.eq("institute_id", parsed.data.institute_id)');
    expect(query).not.toContain("maybeSingle");
    expect(query).toContain('.order("created_at"');
  });

  /**
   * THE FEATURE HALF of the same branch, asserted so it cannot quietly revert.
   *
   * A rep who held a meeting at a school this morning and is sent back there by
   * Pending in the afternoon gets a NEW plan row — a fresh check-in, a fresh
   * visit. Before 0033 the upsert folded that onto the morning's row and the
   * afternoon visit could not exist.
   */
  it("starts a new visit when today's earlier one is already finished", () => {
    const follow = action.slice(action.indexOf("export async function startFollowUp"));
    const body = follow.slice(0, follow.indexOf("export async function removeFromDailyPlan"));

    // An insert, not an upsert onto a constraint 0033 removes.
    expect(body).toContain('.from("daily_plans").insert(');
    expect(body).not.toContain("onConflict");
    // "Finished" is what stops a row counting as live: checked in, and either
    // checked out or closed by the sweep.
    expect(body).toContain("row.checkout_at === null");
    expect(body).toContain("row.checkout_missing !== true");
  });
});

describe("the interrupted-visit recovery path survives", () => {
  const page = read("src/app/(app)/pending/page.tsx");

  /**
   * THE ONE THING STAGE 5 MUST NOT DELETE.
   *
   * Logging and filing are one submit but two RPCs. If the second fails the
   * visit exists unreported; overnight the sweep closes the check-in with
   * `checkout_missing = true`, `visitStatusOf()` then calls the plan entry
   * "Completed", and the Dashboard — which only shows today anyway — stops
   * offering "Continue".
   *
   * `getUnreportedVisits()` is then the only thing in the app that produces a
   * `/log?plan=` link for that visit. Removing it strands the rep with a report
   * owed for ever and nothing on screen to say so.
   */
  it("still lists unreported visits and links them to the report", () => {
    expect(page).toContain("getUnreportedVisits");
    expect(page).toContain("/log?plan=");
  });

  it("says why it cannot be deleted, for whoever tries next", () => {
    expect(page).toMatch(/ONLY thing in the app that produces/i);
  });
});

/**
 * The attribution rule, now that two screens share it.
 *
 * `attributeToCurrentStatus()` was the loop inside `getOpenFollowUps()` until
 * Review needed the same per-institute follow-up date for its register. Both
 * read it through this one function so the two screens cannot disagree about a
 * school — which is precisely why it is worth testing directly: a change made
 * for one caller now lands on the other.
 *
 * It is pure, so unlike the queries around it this needs no database.
 */
describe("which visit left an institute at the status it holds now", () => {
  const visit = (
    institute_id: string,
    status_set_to: string | null,
    follow_up_date: string | null = null,
  ) => ({ institute_id, status_set_to, follow_up_date });

  it("takes the visit that set the CURRENT status, not the newest visit", () => {
    // The case the rule exists for: a session was scheduled in March, a first
    // meeting logged in April. The institute is at "First meeting done", so the
    // date that means anything is April's — even though March's visit is the
    // one that carries the more urgent-looking promise.
    const found = attributeToCurrentStatus(
      [
        visit("i1", "First meeting done", "2026-05-01"),
        visit("i1", "Session scheduled", "2026-03-20"),
      ],
      new Map([["i1", "First meeting done"]]),
    );
    expect(found.get("i1")?.follow_up_date).toBe("2026-05-01");
  });

  it("ignores a visit that set no status at all", () => {
    const found = attributeToCurrentStatus(
      [visit("i1", null, "2026-05-01"), visit("i1", "Session done", "2026-04-01")],
      new Map([["i1", "Session done"]]),
    );
    expect(found.get("i1")?.follow_up_date).toBe("2026-04-01");
  });

  it("takes the FIRST match, which is why the caller must order newest-first", () => {
    /*
     * THE PRECONDITION, PINNED. Both callers order by date then created_at, and
     * a reversal here does not throw or return nothing — it returns the OLDEST
     * qualifying visit, a wrong answer shaped exactly like a right one. Since
     * 0033 a rep can visit one institute twice in a day, so `created_at`
     * breaking a same-day tie is reachable rather than theoretical.
     */
    const newestFirst = [
      visit("i1", "Session done", "2026-06-01"),
      visit("i1", "Session done", "2026-01-01"),
    ];
    const current = new Map([["i1", "Session done"]]);

    expect(attributeToCurrentStatus(newestFirst, current).get("i1")?.follow_up_date)
      .toBe("2026-06-01");
    // Reversed, it answers with the oldest. Asserted so the precondition is a
    // documented property rather than an assumption nobody wrote down.
    expect(
      attributeToCurrentStatus(newestFirst.toReversed(), current).get("i1")
        ?.follow_up_date,
    ).toBe("2026-01-01");
  });

  it("skips an institute it was not asked about, rather than matching null", () => {
    // "Not on this page" and "has no status" are different questions, and only
    // the second is a null. A visit that set no status at an institute nobody
    // asked about must not be attributed to it.
    const found = attributeToCurrentStatus(
      [visit("other", null, "2026-05-01")],
      new Map([["i1", "Session done"]]),
    );
    expect(found.has("other")).toBe(false);
    expect(found.size).toBe(0);
  });

  it("keeps institutes apart, and answers for each on its own status", () => {
    const found = attributeToCurrentStatus(
      [
        visit("i1", "Session done", "2026-06-01"),
        visit("i2", "Session done", "2026-06-02"),
        visit("i2", "First meeting done", "2026-02-02"),
      ],
      new Map([
        ["i1", "Session done"],
        ["i2", "First meeting done"],
      ]),
    );
    expect(found.get("i1")?.follow_up_date).toBe("2026-06-01");
    expect(found.get("i2")?.follow_up_date).toBe("2026-02-02");
  });

  it("answers for nobody when no visit explains the status", () => {
    // Real and ordinary: an admin set the status directly, or the only visit
    // that did is one this caller cannot read. The screens render a dash.
    const found = attributeToCurrentStatus(
      [visit("i1", "First meeting done", "2026-05-01")],
      new Map([["i1", "Session done"]]),
    );
    expect(found.size).toBe(0);
  });
});
