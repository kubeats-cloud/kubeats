import { describe, expect, it } from "vitest";
import { targetStatusSchema } from "@/lib/validation/target-statuses";

/**
 * Admin #8 / Rep #2 — "prevent duplicate or empty status names," the half of
 * that rule checked without a database. Duplicate rejection is the table's
 * own primary key (migration 0045) and is proven in the integration suite.
 */

describe("targetStatusSchema", () => {
  it("accepts an ordinary name", () => {
    const parsed = targetStatusSchema.safeParse({ name: "Pending Approval" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe("Pending Approval");
  });

  it("trims surrounding whitespace", () => {
    const parsed = targetStatusSchema.safeParse({ name: "  Follow Up  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe("Follow Up");
  });

  it("rejects an empty name", () => {
    expect(targetStatusSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects a name that is only whitespace", () => {
    expect(targetStatusSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a name made only of punctuation", () => {
    expect(targetStatusSchema.safeParse({ name: "---" }).success).toBe(false);
  });

  it("rejects a name over 80 characters", () => {
    expect(targetStatusSchema.safeParse({ name: "a".repeat(81) }).success).toBe(false);
  });

  it("accepts a name at exactly 80 characters", () => {
    expect(targetStatusSchema.safeParse({ name: "a".repeat(80) }).success).toBe(true);
  });
});
