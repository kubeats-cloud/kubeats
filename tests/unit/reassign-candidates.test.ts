import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CampusRep } from "@/lib/admin";

/**
 * #3 — the reassign card, when there is nobody to reassign to.
 *
 * WHAT WAS WRONG. `ReassignOwner` offered every rep on the institute's campus,
 * INCLUDING the one who already owns it. On a one-rep campus — the ordinary
 * shape for this client — that meant a dropdown whose only entry was the
 * current owner, so the single available action was a reassign-to-self: a write
 * that changes nothing and then reports "Reassigned. It now belongs to that
 * rep." A success message for an event that did not happen.
 *
 * Taking the owner out is the fix, and it exposes the state that needed naming:
 * the picker is then empty, which looked exactly like the already-handled
 * "no reps on this campus at all" but means something different and has a
 * different answer. That case gets its own sentence.
 *
 * THE CAMPUS FILTER ITSELF IS NOT UNDER TEST and is not changed. It is correct:
 * campus is the outer boundary, a rep elsewhere could not see the institute
 * even after being handed it, and FO025 refuses the move outright.
 */

const rep = (id: string, name: string): CampusRep => ({ id, name });

/**
 * The rule the card applies, restated as the decision it encodes.
 *
 * The component holds this inline and there is no DOM environment here to
 * render it in — vitest.config.mts documents the split — so this asserts the
 * choice between the three states, and the source checks below confirm the
 * component still makes it the same way.
 */
type Outcome = "no-reps-on-campus" | "owner-is-the-only-rep" | "offer-picker";

const outcomeFor = (reps: CampusRep[], ownerId: string | null): Outcome => {
  if (reps.length === 0) return "no-reps-on-campus";
  return reps.filter((r) => r.id !== ownerId).length === 0
    ? "owner-is-the-only-rep"
    : "offer-picker";
};

describe("who an institute can actually be handed to", () => {
  it("says so when the campus has no reps at all", () => {
    // Unchanged behaviour, asserted so the new branch cannot swallow it: the
    // answer to this one is "create a rep", which is a different instruction.
    expect(outcomeFor([], "someone")).toBe("no-reps-on-campus");
    expect(outcomeFor([], null)).toBe("no-reps-on-campus");
  });

  it("says so when the only rep on the campus is the current owner", () => {
    // THE REPORTED CASE. Before the fix this rendered a picker offering the
    // owner back to themselves.
    expect(outcomeFor([rep("r1", "Asha")], "r1")).toBe("owner-is-the-only-rep");
  });

  it("offers the picker as soon as there is somebody else", () => {
    expect(outcomeFor([rep("r1", "Asha"), rep("r2", "Bilal")], "r1")).toBe(
      "offer-picker",
    );
  });

  it("offers the sole rep when the institute is UNASSIGNED", () => {
    // The owner is null, so nobody is filtered out. An unassigned institute is
    // invisible to every rep at once, which makes this the case where handing
    // it over matters most — it must never be mistaken for the self-only one.
    expect(outcomeFor([rep("r1", "Asha")], null)).toBe("offer-picker");
  });

  it("never offers the owner as a candidate, however many reps there are", () => {
    const reps = [rep("r1", "Asha"), rep("r2", "Bilal"), rep("r3", "Chen")];
    const candidates = reps.filter((r) => r.id !== "r2");
    expect(candidates.map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(candidates.some((r) => r.id === "r2")).toBe(false);
  });

  it("matches on id and not on name, because two reps can share one", () => {
    // `registered_by` is what the action writes, and a name is not unique on a
    // campus. Filtering by name would hide the wrong person — and, worse, could
    // leave the real owner in the list under a duplicate name.
    const reps = [rep("r1", "Asha"), rep("r2", "Asha")];
    expect(outcomeFor(reps, "r1")).toBe("offer-picker");
    expect(reps.filter((r) => r.id !== "r1").map((r) => r.id)).toEqual(["r2"]);
  });
});

describe("the card is wired to that rule", () => {
  const source = readFileSync(
    fileURLToPath(
      new URL("../../src/components/institutes/reassign-owner.tsx", import.meta.url),
    ),
    "utf8",
  );

  it("takes the owner's id, not just their name", () => {
    expect(source).toContain("ownerId: string | null");
    expect(source).toContain("reps.filter((rep) => rep.id !== ownerId)");
  });

  it("offers candidates rather than every rep on the campus", () => {
    // The regression: mapping `reps` again would put the owner back.
    expect(source).toContain("{candidates.map((rep) => (");
    expect(source).not.toContain("{reps.map((rep) => (");
  });

  it("has a branch and a sentence for the self-only case", () => {
    expect(source).toContain("candidates.length === 0");
    expect(source).toContain("No other reps on this campus to reassign to.");
  });

  it("keeps the empty-campus sentence separate, because the fix differs", () => {
    expect(source).toContain("reps.length === 0");
    expect(source).toContain(
      "There are no reps on this institute&rsquo;s campus to hand it to.",
    );
  });

  it("is given the owner id by the page that renders it", () => {
    const page = readFileSync(
      fileURLToPath(
        new URL("../../src/app/(app)/institutes/[id]/page.tsx", import.meta.url),
      ),
      "utf8",
    );
    expect(page).toContain("ownerId={institute.registered_by}");
  });
});
