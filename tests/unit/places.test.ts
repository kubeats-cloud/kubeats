import { describe, expect, it } from "vitest";
import { cellFor, formatPlace } from "@/lib/places";

/**
 * The reverse-geocoding helpers. The cache key matters more than it looks: the
 * CHECK constraint in migration 0007 is written against `cellFor`'s output, so
 * a change in shape here silently stops every write from landing.
 */

describe("cellFor", () => {
  it("rounds to four decimal places", () => {
    expect(cellFor(23.0225123, 72.5713987)).toBe("23.0225,72.5714");
  });

  it("always emits four decimals, even for round numbers", () => {
    expect(cellFor(23, 72)).toBe("23.0000,72.0000");
  });

  it("handles the southern and western hemispheres", () => {
    expect(cellFor(-33.86882, -151.20929)).toBe("-33.8688,-151.2093");
  });

  it("puts nearby readings in the same cell, so the GPS twitching is not a miss", () => {
    // ~2 m apart.
    expect(cellFor(23.02251, 72.57139)).toBe(cellFor(23.022514, 72.571388));
  });

  it("keeps genuinely different places apart", () => {
    expect(cellFor(23.0225, 72.5714)).not.toBe(cellFor(23.0325, 72.5714));
  });

  it("matches the shape migration 0007 will accept", () => {
    const pattern = /^-?[0-9]{1,3}\.[0-9]{1,6},-?[0-9]{1,3}\.[0-9]{1,6}$/;
    for (const [lat, lon] of [
      [23.0225, 72.5714],
      [-33.8688, 151.2093],
      [0, 0],
      [-0.00004, -0.00004],
      [90, 180],
      [-90, -180],
    ] as const) {
      expect(cellFor(lat, lon), `${lat},${lon}`).toMatch(pattern);
    }
  });
});

describe("formatPlace", () => {
  it("builds locality, settlement and state", () => {
    expect(
      formatPlace({ suburb: "Bopal", city: "Ahmedabad", state: "Gujarat" }),
    ).toBe("Bopal, Ahmedabad, Gujarat");
  });

  it("falls back through the alternatives for each part", () => {
    expect(
      formatPlace({ village: "Sanand", county: "Ahmedabad", state_district: "Gujarat" }),
    ).toBe("Sanand, Ahmedabad, Gujarat");
  });

  it("drops a repeated name rather than printing it twice", () => {
    expect(formatPlace({ suburb: "Bopal", city: "Bopal", state: "Gujarat" })).toBe(
      "Bopal, Gujarat",
    );
  });

  it("ignores case when deciding a name is repeated", () => {
    expect(formatPlace({ suburb: "bopal", city: "Bopal", state: "Gujarat" })).toBe(
      "bopal, Gujarat",
    );
  });

  it("copes with only a state", () => {
    expect(formatPlace({ state: "Gujarat" })).toBe("Gujarat");
  });

  it("returns null when there is nothing worth stamping", () => {
    expect(formatPlace({})).toBeNull();
    expect(formatPlace(null)).toBeNull();
    expect(formatPlace(undefined)).toBeNull();
    expect(formatPlace({ country: "India" })).toBeNull();
  });

  it("ignores blank strings", () => {
    expect(formatPlace({ suburb: "   ", city: "Ahmedabad", state: "Gujarat" })).toBe(
      "Ahmedabad, Gujarat",
    );
  });

  it("stays short enough for the stamp", () => {
    const long = formatPlace({
      suburb: "A".repeat(60),
      city: "B".repeat(60),
      state: "C".repeat(60),
    });
    expect(long).not.toBeNull();
    expect(long!.length).toBeLessThanOrEqual(80);
  });
});
