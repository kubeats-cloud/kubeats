import { describe, expect, it } from "vitest";
import {
  mapStatusTargetFormValues,
  parseVisibleStatusTargets,
  statusTargetFieldName,
} from "@/lib/validation/target-status-targets";

describe("target-status numeric target parsing", () => {
  it("accepts whole numbers from zero through 999", () => {
    const form = new FormData();
    form.set(statusTargetFieldName("New Coaching Meeting"), "999");

    expect(parseVisibleStatusTargets(form, ["New Coaching Meeting"])).toEqual({
      success: true,
      values: [{ statusName: "New Coaching Meeting", value: 999 }],
      payload: { "New Coaching Meeting": 999 },
    });
  });

  it.each(["-1", "1.5", "1000", "12a"])("rejects %s", (value) => {
    const name = "New Coaching Meeting";
    const form = new FormData();
    form.set(statusTargetFieldName(name), value);

    const parsed = parseVisibleStatusTargets(form, [name]);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.fieldErrors[statusTargetFieldName(name)]).toBe(
        "Whole numbers from 0 to 999.",
      );
    }
  });

  it("treats a cleared visible input as zero and ignores crafted invisible fields", () => {
    const form = new FormData();
    form.set(statusTargetFieldName("Visible"), "");
    form.set(statusTargetFieldName("Other campus"), "42");

    expect(parseVisibleStatusTargets(form, ["Visible"])).toEqual({
      success: true,
      values: [{ statusName: "Visible", value: 0 }],
      payload: { Visible: 0 },
    });
  });

  it("omits a visible status whose field was not on an older cached form", () => {
    expect(parseVisibleStatusTargets(new FormData(), ["Added later"])).toEqual({
      success: true,
      values: [],
      payload: {},
    });
  });
});

describe("target-status form-state mapping", () => {
  it("maps saved values by status name and defaults new visible statuses to zero", () => {
    expect(
      mapStatusTargetFormValues(
        ["New Coaching Meet", "New Coaching Meeting"],
        [{ statusName: "New Coaching Meeting", value: 7 }],
      ),
    ).toEqual({
      "New Coaching Meet": "0",
      "New Coaching Meeting": "7",
    });
  });

  it("drops saved rows that are no longer in the visible vocabulary", () => {
    expect(
      mapStatusTargetFormValues(
        ["Visible"],
        [
          { statusName: "Visible", value: 3 },
          { statusName: "Re-scoped", value: 9 },
        ],
      ),
    ).toEqual({ Visible: "3" });
  });
});
