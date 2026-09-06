import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AREA_UNAVAILABLE,
  LOCATION_UNAVAILABLE,
  STAMP_PRECISION,
  formatArea,
  formatCoordinates,
  hasArea,
} from "@/lib/location-display";

/**
 * Source with its comments removed.
 *
 * Comments explain this rule and therefore say the word "institute" a great
 * deal. The assertions below are about CODE, so prose is stripped first —
 * otherwise documenting the rule would be the thing that breaks the test
 * enforcing it.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * What a location is allowed to say.
 *
 * The rule these tests exist to hold: a location is the coordinates plus an
 * approximate area name, and it is never the institute. A visit logged from
 * home against the right school must not be able to render like a visit logged
 * at its gate, and the quiet way that happens is a null area being filled in
 * from the nearest thing to hand.
 */

describe("formatCoordinates", () => {
  it("rounds to about eleven metres on screen", () => {
    expect(formatCoordinates(23.02251, 72.57136)).toBe("23.0225, 72.5714");
  });

  it("keeps a finer figure for the photograph", () => {
    // The stamp outlives the row it came from, so it carries more of the number.
    expect(formatCoordinates(23.022513, 72.571364, STAMP_PRECISION)).toBe(
      "23.02251, 72.57136",
    );
  });

  it("says nothing rather than something wrong when there is no position", () => {
    expect(formatCoordinates(null, null)).toBeNull();
    expect(formatCoordinates(23.02, null)).toBeNull();
    expect(formatCoordinates(null, 72.57)).toBeNull();
    expect(formatCoordinates(undefined, undefined)).toBeNull();
    expect(formatCoordinates(Number.NaN, 72.57)).toBeNull();
  });

  it("keeps a real zero, which is a place and not an absence", () => {
    expect(formatCoordinates(0, 0)).toBe("0.0000, 0.0000");
  });
});

describe("formatArea", () => {
  it("passes a real area name straight through", () => {
    expect(formatArea("Satellite, Ahmedabad")).toBe("Satellite, Ahmedabad");
  });

  it("says the area is unavailable rather than going quiet", () => {
    // Silence would leave a reader unable to tell "nobody looked" from "the
    // lookup came back empty" - and would leave a gap to fill with a guess.
    expect(formatArea(null)).toBe(AREA_UNAVAILABLE);
    expect(formatArea(undefined)).toBe(AREA_UNAVAILABLE);
    expect(formatArea("")).toBe(AREA_UNAVAILABLE);
    expect(formatArea("   ")).toBe(AREA_UNAVAILABLE);
  });

  it("never invents a fallback of any kind", () => {
    // formatArea takes one argument. There is deliberately nowhere to pass an
    // institute name, a registered address, or any other second-best source.
    expect(formatArea.length).toBe(1);
  });
});

describe("the wording of an absence", () => {
  it("names the missing thing, so the two cannot be confused", () => {
    // "Location unavailable" means the device gave no position at all.
    // "Area unavailable" means there is a position, but no name for it.
    // A reader has to be able to tell those apart, and neither may quietly
    // become the institute's name.
    expect(LOCATION_UNAVAILABLE).toBe("Location unavailable");
    expect(AREA_UNAVAILABLE).toBe("Area unavailable");
  });
});

describe("hasArea", () => {
  it("separates a name from the absence of one", () => {
    expect(hasArea("Bopal, Ahmedabad")).toBe(true);
    expect(hasArea(null)).toBe(false);
    expect(hasArea("  ")).toBe(false);
  });
});

describe("the photo stamp", () => {
  const photo = code("src/lib/photo.ts");

  it("carries coordinates, an area line and a time, and nothing else", () => {
    // Asserted against the source because the stamp is drawn onto a canvas that
    // a unit test cannot read back. The list of lines is the thing worth
    // pinning: it is what a photograph will still be saying in five years.
    const lines = photo.slice(
      photo.indexOf("const lines = ["),
      photo.indexOf("];", photo.indexOf("const lines = [")),
    );
    expect(lines).toContain("formatCoordinates");
    expect(lines).toContain("STAMP_PRECISION");
    expect(lines).toContain("AREA_UNAVAILABLE");
    expect(lines).toContain("formatDateTime");
    expect(lines).toContain("LOCATION_UNAVAILABLE");
  });

  it("has no way to receive an institute", () => {
    // The stamp's input type is the whole contract. If an institute name is
    // ever to appear on a photograph, it has to be added here first - and this
    // is the test that should stop it.
    const stampType = photo.slice(
      photo.indexOf("export interface PhotoStamp"),
      photo.indexOf("}", photo.indexOf("export interface PhotoStamp")),
    );
    expect(stampType).not.toMatch(/institute/i);
    expect(stampType).not.toMatch(/school/i);
    expect(photo).not.toMatch(/institute/i);
  });
});

describe("nothing substitutes an institute for a location", () => {
  it("is not done by the capture UI, check-in/out, or the admin table", () => {
    // A blunt check, and deliberately so: these are the four screens the rule
    // names. If a future edit reaches for the institute to fill a location, it
    // will land in one of these files, next to one of these formatters.
    const files = [
      "src/components/visits/capture-fields.tsx",
      "src/components/dashboard/check-buttons.tsx",
      "src/components/report/activity-summary.tsx",
      "src/components/visits/report-view.tsx",
    ];

    for (const file of files) {
      const source = code(file);
      // formatArea and formatCoordinates are the only ways a location is worded.
      // Neither may be handed anything institute-shaped.
      const calls = source.match(/format(Area|Coordinates)\([^)]*\)/g) ?? [];
      for (const call of calls) {
        expect(call, `${file}: ${call}`).not.toMatch(/institute/i);
      }
    }
  });

  it("leaves the institute on the visit record, where it belongs", () => {
    // The other half of the rule. The closing report must still say which
    // school the visit was for - the fix is about labelling, not removal.
    const view = code("src/components/visits/report-view.tsx");
    expect(view).toContain('"Institute"');
    expect(view).toContain('"Institute address"');
    expect(view).toContain('"GPS location"');
    // The old label, which sat directly above the coordinates and read as
    // though the registered address were the confirmed place.
    expect(view).not.toContain('"Where"');
  });
});
