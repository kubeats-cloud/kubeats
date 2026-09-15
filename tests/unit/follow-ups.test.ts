import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
    const follow = action.slice(action.indexOf("export async function startFollowUp"));
    const body = follow.slice(0, follow.indexOf("export async function removeFromDailyPlan"));
    expect(body).toContain("existing?.checkin_at");
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
