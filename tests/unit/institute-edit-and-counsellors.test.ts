import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  EDIT_ALLOWANCE_NOTICE,
  EDIT_ALLOWANCE_SPENT,
  canEditInstitute,
  counsellorFormDataToInput,
  counsellorIdSchema,
  counsellorSchema,
  instituteEditRefusal,
} from "@/lib/validation/institute";

/**
 * Phase B's two rules, as far as they can be proven without a database.
 *
 * What is here: the four-branch edit gate, and the counsellor shape. Both are
 * pure functions of their inputs, and both are read by more than one caller —
 * the gate by the detail page, the edit page and the action; the schema by the
 * browser and the server — which is exactly the shape that drifts if it is not
 * pinned.
 *
 * What is NOT here, and cannot be: that the trigger is scoped to the right
 * COLUMNS, and that the counsellor policies reach through the parent institute.
 * Those live in Postgres and only a real database can answer them; the
 * `institute_counsellors` and `rep edit allowance` blocks in
 * tests/integration/rules.test.ts do that.
 */

const REP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const owned = (used: number) => ({ registered_by: REP, rep_edits_used: used });

describe("who may edit an institute's details", () => {
  it("lets an admin edit, always, whatever the counter says", () => {
    for (const used of [0, 1]) {
      expect(
        instituteEditRefusal(owned(used), { isAdmin: true, viewerId: OTHER }),
      ).toBeNull();
    }
  });

  it("lets the owning rep edit while they still have their correction", () => {
    expect(
      instituteEditRefusal(owned(0), { isAdmin: false, viewerId: REP }),
    ).toBeNull();
    expect(canEditInstitute(owned(0), { isAdmin: false, viewerId: REP })).toBe(true);
  });

  it("refuses the owning rep once it is spent, and says which refusal it is", () => {
    expect(
      instituteEditRefusal(owned(1), { isAdmin: false, viewerId: REP }),
    ).toBe("allowance-spent");
    expect(canEditInstitute(owned(1), { isAdmin: false, viewerId: REP })).toBe(false);
  });

  /**
   * The two refusals are kept apart because they need different answers on
   * screen: a spent allowance has to explain itself where the button was, and
   * "not yours" says nothing at all — a rep cannot even read a colleague's
   * institute after 0028, so there is no button and nothing to explain.
   */
  it("refuses a rep who does not own it, as a different refusal", () => {
    expect(
      instituteEditRefusal(owned(0), { isAdmin: false, viewerId: OTHER }),
    ).toBe("not-yours");
  });

  it("refuses a signed-out viewer", () => {
    expect(
      instituteEditRefusal(owned(0), { isAdmin: false, viewerId: null }),
    ).toBe("not-yours");
  });

  it("refuses an unowned institute for everyone but an admin", () => {
    const orphan = { registered_by: null, rep_edits_used: 0 };
    expect(instituteEditRefusal(orphan, { isAdmin: false, viewerId: REP })).toBe(
      "not-yours",
    );
    expect(instituteEditRefusal(orphan, { isAdmin: true, viewerId: REP })).toBeNull();
  });

  /** One helper, three callers — the whole reason it is a function. */
  it("is the same decision the page, the editor and the action all read", () => {
    const read = (path: string) =>
      readFileSync(fileURLToPath(new URL(`../../src/${path}`, import.meta.url)), "utf8");

    expect(read("app/(app)/institutes/[id]/page.tsx")).toContain(
      "instituteEditRefusal",
    );
    expect(read("app/(app)/institutes/[id]/edit/page.tsx")).toContain(
      "instituteEditRefusal",
    );
    expect(read("lib/institute-actions.ts")).toContain("instituteEditRefusal");
  });

  /**
   * THE EDGE GATE IS GONE, DELIBERATELY (B1), AND THE ACTION'S IS NOT.
   *
   * `ADMIN_ONLY_PATTERNS` could not express "admin or the owner with an edit
   * left", so the editor dropped from three gates to two. That makes
   * `updateInstitute()`'s own gate load-bearing in a way it was not before: if
   * somebody ever restored `requireAdmin()` to its first line the feature would
   * silently stop working for every rep, and if they deleted the gate entirely
   * the only thing left would be RLS and FO030.
   */
  it("keeps the action gating on the allowance rather than on the role alone", () => {
    const action = readFileSync(
      fileURLToPath(new URL("../../src/lib/institute-actions.ts", import.meta.url)),
      "utf8",
    );
    const update = action.slice(action.indexOf("export async function updateInstitute"));
    const body = update.slice(0, update.indexOf("export async function", 10));

    // `await requireAdmin()` is how it is actually CALLED — matching the bare
    // name would hit this function's own comment explaining its absence.
    expect(body).not.toContain("await requireAdmin()");
    expect(body).toContain("instituteEditRefusal");
    // And FO030 is mapped by CODE, never by message text.
    expect(body).toContain('error.code === "FO030"');
  });

  it("gives the two sentences a rep actually reads", () => {
    expect(EDIT_ALLOWANCE_SPENT).toMatch(/one correction/i);
    expect(EDIT_ALLOWANCE_SPENT).toMatch(/admin/i);
    expect(EDIT_ALLOWANCE_NOTICE).toMatch(/one correction/i);
  });
});

describe("the counsellor shape", () => {
  const ok = { name: "Priya Shah", phone: "9876543210", email: "priya@school.edu" };

  it("accepts a full row", () => {
    const parsed = counsellorSchema.safeParse(ok);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(ok);
  });

  /** There is always a person; there is not always a number. */
  it("requires a name", () => {
    for (const name of ["", "   "]) {
      const parsed = counsellorSchema.safeParse({ ...ok, name });
      expect(parsed.success, JSON.stringify(name)).toBe(false);
    }
  });

  it("refuses a name over 120 characters", () => {
    expect(counsellorSchema.safeParse({ ...ok, name: "x".repeat(121) }).success).toBe(
      false,
    );
    expect(counsellorSchema.safeParse({ ...ok, name: "x".repeat(120) }).success).toBe(
      true,
    );
  });

  it("accepts an absent phone and an absent email", () => {
    const parsed = counsellorSchema.safeParse({ name: "Priya Shah", phone: "", email: "" });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ name: "Priya Shah", phone: null, email: null });
  });

  /**
   * The same ten-digit rule `institutes_principal_mobile_valid` and
   * `profiles_mobile_valid` carry, and the one 0037's CHECK repeats — so every
   * phone number in the app answers to one shape.
   */
  it("refuses a phone that is not ten digits", () => {
    for (const phone of ["987654321", "98765432101", "98765-43210", "+919876543210", "abcdefghij"]) {
      expect(counsellorSchema.safeParse({ ...ok, phone }).success, phone).toBe(false);
    }
    expect(counsellorSchema.safeParse({ ...ok, phone: "0000000000" }).success).toBe(true);
  });

  it("refuses an email that is not one", () => {
    for (const email of ["priya", "priya@", "@school.edu", "priya school.edu"]) {
      expect(counsellorSchema.safeParse({ ...ok, email }).success, email).toBe(false);
    }
  });

  it("refuses an email over 254 characters", () => {
    const long = `${"x".repeat(250)}@a.io`;
    expect(counsellorSchema.safeParse({ ...ok, email: long }).success).toBe(false);
  });

  it("trims before judging", () => {
    const parsed = counsellorSchema.safeParse({
      name: "  Priya Shah  ",
      phone: " 9876543210 ",
      email: " priya@school.edu ",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(ok);
  });

  it("refuses a counsellor id that is not a uuid", () => {
    expect(counsellorIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(
      counsellorIdSchema.safeParse("8b1a9953-4c22-4d1f-9b1a-99534c224d1f").success,
    ).toBe(true);
  });
});

describe("the form the browser and the server both read", () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  it("reads the three fields the panel posts", () => {
    expect(
      counsellorFormDataToInput(
        form({
          counsellor_name: "Priya Shah",
          counsellor_phone: "9876543210",
          counsellor_email: "priya@school.edu",
        }),
      ),
    ).toEqual({ name: "Priya Shah", phone: "9876543210", email: "priya@school.edu" });
  });

  it("reads a missing field as empty rather than undefined", () => {
    expect(counsellorFormDataToInput(form({ counsellor_name: "Priya" }))).toEqual({
      name: "Priya",
      phone: "",
      email: "",
    });
  });

  /** Round trip: what the panel posts is what the schema accepts. */
  it("round-trips through the schema", () => {
    const parsed = counsellorSchema.safeParse(
      counsellorFormDataToInput(
        form({ counsellor_name: " Dev Patel ", counsellor_phone: "", counsellor_email: "" }),
      ),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ name: "Dev Patel", phone: null, email: null });
  });

  /**
   * The panel's input names and the reader's keys are the one place an
   * off-by-one in repeating fields would hide, so they are pinned against the
   * component rather than trusted.
   */
  it("uses the names the panel actually renders", () => {
    const panel = readFileSync(
      fileURLToPath(
        new URL("../../src/components/institutes/counsellors-panel.tsx", import.meta.url),
      ),
      "utf8",
    );
    for (const name of ["counsellor_name", "counsellor_phone", "counsellor_email"]) {
      expect(panel, name).toContain(`name="${name}"`);
    }
  });
});
