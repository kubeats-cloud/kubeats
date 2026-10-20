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
