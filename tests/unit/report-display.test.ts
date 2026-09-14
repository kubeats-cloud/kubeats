import { describe, expect, it } from "vitest";
import { discussionOf, metPersonOf } from "@/lib/report-display";

/**
 * The two-era reads on a filed closing report.
 *
 * These exist because the view read only the RETIRED long report's columns:
 * `discussion_summary` for the note and the `visit_people` table for the person
 * met. Nothing has written to either since 0019, so every report the current
 * form filed rendered "—" and "Nobody was recorded" over data that was in the
 * row. Both directions are pinned here so a future edit cannot quietly drop
 * one era for the other again.
 */

describe("discussionOf", () => {
  it("reads the short form's notes", () => {
    expect(
      discussionOf({ notes: "They want a session in July.", discussion_summary: null }),
    ).toBe("They want a session in July.");
  });

  it("falls back to a long-form report's discussion_summary", () => {
    expect(discussionOf({ notes: null, discussion_summary: "Talked it over." })).toBe(
      "Talked it over.",
    );
  });

  it("prefers notes when a row somehow carries both", () => {
    expect(discussionOf({ notes: "Current.", discussion_summary: "Retired." })).toBe(
      "Current.",
    );
  });

  it("treats blank and whitespace as not recorded, so the view shows a dash", () => {
    expect(discussionOf({ notes: "   ", discussion_summary: "" })).toBeNull();
    expect(discussionOf({ notes: null, discussion_summary: null })).toBeNull();
  });
});

describe("metPersonOf", () => {
  it("returns the name and the number when both were given", () => {
    expect(metPersonOf({ met_name: "A. Sharma", met_phone: "9876543210" })).toEqual({
      name: "A. Sharma",
      phone: "9876543210",
    });
  });

  it("returns the name alone when no number was got", () => {
    expect(metPersonOf({ met_name: "A. Sharma", met_phone: null })).toEqual({
      name: "A. Sharma",
      phone: null,
    });
  });

  it("is null for a long-form report, which recorded people elsewhere", () => {
    expect(metPersonOf({ met_name: null, met_phone: null })).toBeNull();
  });

  /**
   * The name is the mandatory half (0022). A number with nobody attached is
   * dropped rather than rendered as an anonymous line in "People met".
   */
  it("drops a number that has no name beside it", () => {
    expect(metPersonOf({ met_name: "  ", met_phone: "9876543210" })).toBeNull();
  });
});
