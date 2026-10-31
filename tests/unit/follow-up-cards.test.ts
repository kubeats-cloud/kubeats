import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyFollowUpTask,
  followUpCardItemsFor,
  type FollowUpCardItem,
} from "@/lib/follow-up-cards";

/**
 * Admin #4 / Rep #6's one classifier, and the one place "Missed" is defined:
 * due date has passed AND it has not been completed or closed. Proven here
 * without a database; RLS scoping is the integration suite's job.
 */

const TODAY = "2026-10-20";

describe("classifyFollowUpTask", () => {
  it("is closed whenever done_at is set, regardless of the due date", () => {
    expect(
      classifyFollowUpTask({ dueDate: "2026-10-01", doneAt: "2026-10-05T00:00:00Z" }, TODAY),
    ).toBe("closed");
    expect(
      classifyFollowUpTask({ dueDate: "2026-12-01", doneAt: "2026-10-05T00:00:00Z" }, TODAY),
    ).toBe("closed");
  });

  it("is missed when the due date has passed and nothing has closed it", () => {
    expect(classifyFollowUpTask({ dueDate: "2026-10-19", doneAt: null }, TODAY)).toBe(
      "missed",
    );
    expect(classifyFollowUpTask({ dueDate: "2026-01-01", doneAt: null }, TODAY)).toBe(
      "missed",
    );
  });

  it("is owned, not missed, when due today — today has not yet passed", () => {
    expect(classifyFollowUpTask({ dueDate: TODAY, doneAt: null }, TODAY)).toBe("owned");
  });

  it("is owned when the due date is still in the future", () => {
    expect(classifyFollowUpTask({ dueDate: "2026-11-01", doneAt: null }, TODAY)).toBe(
      "owned",
    );
  });
});

describe("followUpCardItemsFor", () => {
  const items: FollowUpCardItem[] = [
    { id: "1", repName: "A", instituteName: "X", dueDate: "2026-10-01", status: "Owned" },
    { id: "2", repName: "A", instituteName: "Y", dueDate: "2026-09-01", status: "Missed" },
    { id: "3", repName: "B", instituteName: "Z", dueDate: "2026-08-01", status: "Closed" },
  ];

  it("owned's list includes both Owned- and Missed-labelled rows", () => {
    // "Owned" is every unclosed row (the client's own "currently assigned"),
    // and Missed is a subset of it, not a disjoint third bucket.
    const owned = followUpCardItemsFor(items, "owned");
    expect(owned.map((i) => i.id).sort()).toEqual(["1", "2"]);
  });

  it("missed's list is exactly the Missed-labelled rows", () => {
    const missed = followUpCardItemsFor(items, "missed");
    expect(missed.map((i) => i.id)).toEqual(["2"]);
  });

  it("closed's list is exactly the Closed-labelled rows", () => {
    const closed = followUpCardItemsFor(items, "closed");
    expect(closed.map((i) => i.id)).toEqual(["3"]);
  });
});

/**
 * Admin #4 names /pending as the screen with the three cards. The counts and
 * the lists are the SAME model, so this pins the wiring rather than recounts
 * anything: `getFollowUpCardModel()` is called once, its `counts` are what the
 * cards print, and `/pending/follow-ups` filters its `items` with
 * `followUpCardItemsFor()`.
 */
describe("the cards are on Pending, and the lists read the same model", () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(`../../src/app/(app)/${path}`, import.meta.url)), "utf8");

  const pending = () => read("pending/page.tsx");
  const lists = () => read("pending/follow-ups/page.tsx");

  it("gives staff (admin or team lead) the three cards at the top", () => {
    const page = pending();
    expect(page).toContain("AdminFollowUpCards");
    // The staff branch is the one that renders it; a rep keeps the two cards.
    // `follow_up_tasks` is `supervises()`-scoped since 0042, so a team lead
    // reaches the same branch as an admin and gets exactly their own reps.
    expect(page).toContain("isStaff");
    expect(page).toMatch(/staff \? \(\s*<AdminFollowUpCards/);
    expect(page).toContain("RepFollowUpCards");
  });

  it("says one matching task, not one matching tasks", () => {
    expect(lists()).toContain(
      'result.model.counts[status] === 1 ? "task" : "tasks"',
    );
  });

  it("prints the counts from the one model the lists filter", () => {
    expect(pending()).toContain("getFollowUpCardModel()");
    expect(pending()).toContain("counts={followUpCards.model.counts}");
    expect(lists()).toContain("getFollowUpCardModel()");
    expect(lists()).toContain("followUpCardItemsFor(result.model.items, status)");
  });

  it("links each card at its own filtered list", () => {
    const cards = readFileSync(
      fileURLToPath(
        new URL("../../src/components/visits/follow-up-cards.tsx", import.meta.url),
      ),
      "utf8",
    );
    for (const status of ["owned", "missed", "closed"]) {
      expect(cards).toContain(`href="/pending/follow-ups?status=${status}"`);
    }
  });
});
