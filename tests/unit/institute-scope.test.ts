import { describe, expect, it, vi } from "vitest";

import {
  INSTITUTE_OUT_OF_SCOPE,
  instituteNameFrom,
  instituteNameOr,
} from "@/lib/institute-scope";

vi.mock("@/lib/errors", () => ({ logError: vi.fn() }));

/**
 * The label a rep sees where an institute's name could not be resolved.
 *
 * Worth pinning because it is one string covering THREE different causes, and
 * the temptation whenever one of them is in mind is to name that one:
 *
 *   - the institute is in another campus (0020b),
 *   - it belongs to another rep (0028),
 *   - it has been deleted.
 *
 * Nothing on the read path can tell them apart — an embedded join returns null
 * for all three — so a label naming any single cause is wrong the other two
 * times. "Not in your campus" was exactly that mistake, and after 0028 it was
 * wrong in the commonest case rather than the rarest.
 */
describe("the out-of-scope institute label", () => {
  it("does not name a cause it cannot know", () => {
    expect(INSTITUTE_OUT_OF_SCOPE).toBe("No longer yours");
    // The specific regressions: either would be a confident wrong answer.
    expect(INSTITUTE_OUT_OF_SCOPE).not.toMatch(/campus/i);
    expect(INSTITUTE_OUT_OF_SCOPE).not.toMatch(/unknown|deleted|missing/i);
  });

  it("is used for a name that is absent, however it is absent", () => {
    for (const absent of [null, undefined, ""]) {
      expect(instituteNameOr(absent, "test")).toBe(INSTITUTE_OUT_OF_SCOPE);
    }
    expect(instituteNameFrom(new Map(), "some-id", "test")).toBe(
      INSTITUTE_OUT_OF_SCOPE,
    );
  });

  it("returns the real name untouched when there is one", () => {
    expect(instituteNameOr("Kendriya Vidyalaya", "test")).toBe(
      "Kendriya Vidyalaya",
    );
    expect(
      instituteNameFrom(new Map([["abc", "St Xavier's"]]), "abc", "test"),
    ).toBe("St Xavier's");
  });
});
