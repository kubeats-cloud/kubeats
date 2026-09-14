import { describe, expect, it } from "vitest";
import {
  CAMPUS_REQUIRED,
  instituteFormDataToInput,
  instituteSchema,
} from "@/lib/validation/institute";

/**
 * The institute registry's shared schema, and the campus half of it.
 *
 * `enforce_institute_campus()` (FO022) defaults a new institute to
 * `my_campus()`. That is the rep's campus; an admin has none, so the default
 * lands on null and the trigger refuses the row. The form never asked for a
 * campus, so an admin got "We could not save this institute. Please try again."
 * at something that could never succeed.
 *
 * The field is OPTIONAL here on purpose — a rep genuinely does not send one and
 * the database fills it in. Who must supply one is decided where the role is
 * known: the form asks only an admin, and the action rejects an admin who did
 * not answer. What this schema owns is the shape.
 */

const base = (over: Record<string, unknown> = {}) => ({
  name: "Delhi Public School",
  type: "school",
  campus_id: "",
  address: "",
  pincode: "",
  state: "Gujarat",
  city: "Gandhi Nagar",
  area: "Kudasan",
  boards: ["CBSE"],
  principal_name: "",
  principal_mobile: "",
  decision_maker_name: "",
  decision_maker_designation: "",
  decision_maker_mobile: "",
  class11: [],
  class12: {},
  ...over,
});

const CAMPUS = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("instituteSchema campus", () => {
  it("accepts no campus — the rep's path, where the trigger fills it in", () => {
    const r = instituteSchema.safeParse(base());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.campus_id).toBeNull();
  });

  it("normalises a blank campus to null rather than an empty string", () => {
    const r = instituteSchema.safeParse(base({ campus_id: "   " }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.campus_id).toBeNull();
  });

  it("accepts a campus the admin named", () => {
    const r = instituteSchema.safeParse(base({ campus_id: CAMPUS }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.campus_id).toBe(CAMPUS);
  });

  it("rejects anything that is not one of the listed campuses", () => {
    const r = instituteSchema.safeParse(base({ campus_id: "the Gandhinagar one" }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join("."))).toContain("campus_id");
    }
  });

  it("still rejects the fields it always did, campus or no campus", () => {
    const r = instituteSchema.safeParse(base({ campus_id: CAMPUS, name: "" }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join("."))).toContain("name");
    }
  });
});

describe("instituteFormDataToInput", () => {
  /**
   * The form posts the campus through a hidden input beside a Radix Select.
   * If this stopped being read, an admin's choice would vanish silently and
   * they would meet FO022 again with the picker sitting there answered.
   */
  it("carries the campus through from the form", () => {
    const form = new FormData();
    form.set("name", "Delhi Public School");
    form.set("type", "school");
    form.set("campus_id", CAMPUS);
    expect(instituteFormDataToInput(form).campus_id).toBe(CAMPUS);
  });

  it("reads an absent campus as blank, which the schema turns into null", () => {
    const form = new FormData();
    form.set("name", "Delhi Public School");
    expect(instituteFormDataToInput(form).campus_id).toBe("");
  });
});

describe("CAMPUS_REQUIRED", () => {
  it("names what to do rather than telling anyone to try again", () => {
    expect(CAMPUS_REQUIRED).toMatch(/campus/i);
    expect(CAMPUS_REQUIRED).not.toMatch(/try again/i);
  });
});
