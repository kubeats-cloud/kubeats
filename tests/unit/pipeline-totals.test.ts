import { describe, expect, it } from "vitest";
import { pipelineTotals } from "@/lib/pipeline-totals";
import { ZERO_COUNTS } from "@/lib/validation/weekly";
import type { RepRow } from "@/lib/exports/activity-grid";

const columns = {
  closed: [{ status: "Not interested", label: "Not interested", retired: false }],
  open: [
    { status: "Session scheduled", label: "Session scheduled", retired: false },
    { status: "Old open", label: "Old open (retired)", retired: true },
  ],
};
const unsetColumn = { status: "__none__", label: "No status yet", retired: false };

const rep = (name: string, statuses: Record<string, number>): RepRow => ({
  name,
  activities: { ...ZERO_COUNTS },
  statuses,
});

const reps = [
  rep("A", { "Not interested": 2, "Session scheduled": 3, __none__: 1 }),
  rep("B", { "Old open": 4 }),
];

describe("pipelineTotals", () => {
  it("splits by the column bands and reconciles Overall = Open + Closed + No status yet", () => {
    const t = pipelineTotals({ reps, columns, unsetColumn });
    expect(t).toEqual({ overall: 10, open: 7, closed: 2, noStatus: 1 });
    expect(t.overall).toBe(t.open + t.closed + (t.noStatus ?? 0));
  });

  it("leaves No status yet out when the column is not drawn (a range is active)", () => {
    const t = pipelineTotals({ reps, columns, unsetColumn: null });
    expect(t).toEqual({ overall: 9, open: 7, closed: 2, noStatus: null });
  });
});
