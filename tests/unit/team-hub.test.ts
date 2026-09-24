import { describe, expect, it } from "vitest";

import {
  NO_STATUS_LABEL,
  RETIRED_LABEL,
  pipelineOf,
} from "@/lib/team-hub";
import type { Institute } from "@/lib/institutes";
import type { StatusCatalogue, StatusRow } from "@/lib/validation/institute";

/**
 * The member hub's status pipeline, without a database.
 *
 * `pipelineOf()` is pure precisely so this is possible: it counts the very
 * array the institute list on the hub prints, rather than asking the database a
 * second, differently-shaped question. That is what guarantees the totals match
 * the list underneath them, and it is the thing worth pinning — an admin who
 * counts eight rows under a heading that says seven stops trusting the screen.
 */

function status(
  name: string,
  category: StatusRow["category"],
  sortOrder: number,
  isActive = true,
): StatusRow {
  return {
    status: name,
    category,
    tone: category === "open" ? "warning" : "success",
    sortOrder,
    isActive,
    asksExpectedDate: false,
    asksSessionDetail: false,
    asksHeadCount: false,
  };
}

const catalogue: StatusCatalogue = [
  status("First meeting done", "open", 10),
  status("Session scheduled", "open", 20),
  status("Session done", "closed", 30),
  status("Will not come", "closed", 40),
  status("Old reason", "closed", 50, false),
];

/** Only the fields `pipelineOf()` reads; the rest of an Institute is irrelevant. */
const inst = (id: string, statusValue: string | null): Institute =>
  ({ id, status: statusValue }) as Institute;

describe("pipelineOf", () => {
  it("counts each status and splits open from closed", () => {
    const pipeline = pipelineOf(
      [
        inst("a", "First meeting done"),
        inst("b", "First meeting done"),
        inst("c", "Session done"),
        inst("d", "Will not come"),
      ],
      catalogue,
    );

    expect(pipeline.total).toBe(4);
    expect(pipeline.open).toBe(2);
    expect(pipeline.closed).toBe(2);
    expect(pipeline.unset).toBe(0);
  });

  /** The rows must add up to the total, or the card contradicts itself. */
  it("keeps the rows summing to the total", () => {
    const institutes = [
      inst("a", "First meeting done"),
      inst("b", "Session done"),
      inst("c", null),
      inst("d", null),
      inst("e", "Will not come"),
    ];
    const pipeline = pipelineOf(institutes, catalogue);

    expect(pipeline.rows.reduce((sum, row) => sum + row.count, 0)).toBe(
      institutes.length,
    );
    expect(pipeline.open + pipeline.closed + pipeline.unset).toBe(institutes.length);
  });

  it("orders by the catalogue, not by count", () => {
    const pipeline = pipelineOf(
      [
        inst("a", "Will not come"),
        inst("b", "Will not come"),
        inst("c", "Will not come"),
        inst("d", "First meeting done"),
      ],
      catalogue,
    );

    // "First meeting done" sorts first despite having the smaller count.
    expect(pipeline.rows.map((row) => row.status)).toEqual([
      "First meeting done",
      "Will not come",
    ]);
  });

  it("gives a status with no institutes no row at all", () => {
    const pipeline = pipelineOf([inst("a", "Session done")], catalogue);

    expect(pipeline.rows).toHaveLength(1);
    expect(pipeline.rows[0].status).toBe("Session done");
  });

  /**
   * Null is its own bucket and is NOT closed. Folding it in would say the
   * opposite of the truth: registered and not yet reached.
   */
  it("keeps 'no status yet' separate, and sorts it last", () => {
    const pipeline = pipelineOf(
      [inst("a", null), inst("b", "Session done"), inst("c", null)],
      catalogue,
    );

    expect(pipeline.unset).toBe(2);
    expect(pipeline.closed).toBe(1);
    expect(pipeline.open).toBe(0);

    const last = pipeline.rows[pipeline.rows.length - 1];
    expect(last.status).toBeNull();
    expect(last.label).toBe(NO_STATUS_LABEL);
    expect(last.count).toBe(2);
  });

  it("marks a retired status and still counts it", () => {
    const pipeline = pipelineOf([inst("a", "Old reason")], catalogue);

    expect(pipeline.rows[0].retired).toBe(true);
    expect(pipeline.rows[0].label).toBe("Old reason" + RETIRED_LABEL);
    expect(pipeline.closed).toBe(1);
  });

  /**
   * Reachable only when `listStatusCatalogue()` has fallen back to the seeded
   * nine because its read failed, taking every admin-added status with it.
   * Printed rather than dropped: a pipeline whose rows do not add up to its own
   * total is worse than one with an unfamiliar label in it, and this is the
   * only way the reader finds out something is wrong.
   */
  it("still prints a status the catalogue does not describe", () => {
    const pipeline = pipelineOf([inst("a", "Added last week")], catalogue);

    expect(pipeline.rows).toHaveLength(1);
    expect(pipeline.rows[0].status).toBe("Added last week");
    expect(pipeline.rows[0].count).toBe(1);
    expect(pipeline.total).toBe(1);
    // Category unknown, so it is counted in neither half rather than guessed.
    expect(pipeline.open).toBe(0);
    expect(pipeline.closed).toBe(0);
  });

  it("answers an empty registry without rows", () => {
    const pipeline = pipelineOf([], catalogue);

    expect(pipeline).toEqual({
      rows: [],
      total: 0,
      open: 0,
      closed: 0,
      unset: 0,
    });
  });
});
