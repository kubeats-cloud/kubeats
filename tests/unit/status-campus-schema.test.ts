import { describe, expect, it } from "vitest";
import { statusCampusSchema, statusSchema } from "@/lib/validation/admin";

/**
 * Part 2's shape layer: campus_id on statusSchema (create) and the new
 * statusCampusSchema (re-scope an existing status). Both only check that a
 * non-empty value LOOKS like a uuid — whether it names an ACTIVE campus is
 * campusIsActiveOrAll()'s job in admin-actions.ts, proven on the rehearsal
 * DB rather than here, because that answer is live data a static schema
 * cannot hold.
 */

const KARNAVATI = "b160c654-bb3b-429e-bccc-fab2022408b6";

const baseStatus = {
  status: "Awaiting trustee sign-off",
  category: "open",
  tone: "warning",
  asks_expected_date: false,
  asks_session_detail: false,
  asks_head_count: false,
};

describe("statusSchema — campus_id", () => {
  it("accepts an empty string as every campus (null)", () => {
    const parsed = statusSchema.safeParse({ ...baseStatus, campus_id: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.campus_id).toBeNull();
  });

  it("accepts a uuid-shaped campus id", () => {
    const parsed = statusSchema.safeParse({ ...baseStatus, campus_id: KARNAVATI });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.campus_id).toBe(KARNAVATI);
  });

  it("rejects a campus_id that is not a uuid", () => {
    const parsed = statusSchema.safeParse({ ...baseStatus, campus_id: "Karnavati" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.path[0] === "campus_id")).toBe(true);
  });

  it("still requires category and tone — campus_id is additive, not a replacement", () => {
    expect(
      statusSchema.safeParse({ ...baseStatus, category: "", campus_id: "" }).success,
    ).toBe(false);
    expect(
      statusSchema.safeParse({ ...baseStatus, tone: "", campus_id: "" }).success,
    ).toBe(false);
  });
});

describe("statusCampusSchema — re-scoping an existing status", () => {
  it("accepts an empty string as every campus (null)", () => {
    const parsed = statusCampusSchema.safeParse({
      status: "Session done",
      campus_id: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.campus_id).toBeNull();
  });

  it("accepts a uuid-shaped campus id", () => {
    const parsed = statusCampusSchema.safeParse({
      status: "Session done",
      campus_id: KARNAVATI,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.campus_id).toBe(KARNAVATI);
  });

  it("rejects a campus_id that is not a uuid", () => {
    const parsed = statusCampusSchema.safeParse({
      status: "Session done",
      campus_id: "not-a-uuid",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a blank status — it has to name the row being re-scoped", () => {
    const parsed = statusCampusSchema.safeParse({ status: "", campus_id: "" });
    expect(parsed.success).toBe(false);
  });

  it("does not touch category, tone or the asks_* flags — it has no such keys", () => {
    const parsed = statusCampusSchema.safeParse({
      status: "Session done",
      campus_id: "",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).not.toHaveProperty("category");
    expect(parsed.data).not.toHaveProperty("tone");
    expect(parsed.data).not.toHaveProperty("asks_expected_date");
  });
});
