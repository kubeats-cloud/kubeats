import { describe, expect, it } from "vitest";
import {
  targetStatusCampusSchema,
  targetStatusSchema,
} from "@/lib/validation/target-statuses";

/**
 * Part 3's shape layer: campus_id on targetStatusSchema (create) and the new
 * targetStatusCampusSchema (re-scope an existing target status). Mirrors
 * tests/unit/status-campus-schema.test.ts for institute_statuses, against a
 * deliberately separate schema — Part 0 confirmed target_statuses is its own
 * vocabulary. Whether a non-empty value names an ACTIVE campus is
 * campusIsActiveOrAll()'s job in target-status-actions.ts, proven on the
 * rehearsal DB rather than here.
 */

const KARNAVATI = "b160c654-bb3b-429e-bccc-fab2022408b6";

describe("targetStatusSchema — campus_id", () => {
  it("accepts an empty string as every campus (null)", () => {
    const parsed = targetStatusSchema.safeParse({
      name: "Awaiting trustee sign-off",
      campus_id: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.campus_id).toBeNull();
  });

  it("accepts a uuid-shaped campus id", () => {
    const parsed = targetStatusSchema.safeParse({
      name: "Awaiting trustee sign-off",
      campus_id: KARNAVATI,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.campus_id).toBe(KARNAVATI);
  });

  it("rejects a campus_id that is not a uuid", () => {
    const parsed = targetStatusSchema.safeParse({
      name: "Awaiting trustee sign-off",
      campus_id: "Karnavati",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.path[0] === "campus_id")).toBe(true);
  });

  it("still requires a usable name — campus_id is additive, not a replacement", () => {
    expect(targetStatusSchema.safeParse({ name: "", campus_id: "" }).success).toBe(false);
    expect(targetStatusSchema.safeParse({ name: "!!!", campus_id: "" }).success).toBe(false);
  });
});

describe("targetStatusCampusSchema — re-scoping an existing target status", () => {
  it("accepts an empty string as every campus (null)", () => {
    const parsed = targetStatusCampusSchema.safeParse({
      name: "Rehearsal QA Status",
      campus_id: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.campus_id).toBeNull();
  });

  it("accepts a uuid-shaped campus id", () => {
    const parsed = targetStatusCampusSchema.safeParse({
      name: "Rehearsal QA Status",
      campus_id: KARNAVATI,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.campus_id).toBe(KARNAVATI);
  });

  it("rejects a campus_id that is not a uuid", () => {
    const parsed = targetStatusCampusSchema.safeParse({
      name: "Rehearsal QA Status",
      campus_id: "not-a-uuid",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a blank name — it has to name the row being re-scoped", () => {
    const parsed = targetStatusCampusSchema.safeParse({ name: "", campus_id: "" });
    expect(parsed.success).toBe(false);
  });
});
