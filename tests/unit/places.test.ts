import { describe, expect, it } from "vitest";
import { cellFor, formatMapplsPlace, formatPlace, joinPlaceParts } from "@/lib/places";

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

describe("formatMapplsPlace", () => {
  it("builds the same three parts from Mappls's names for them", () => {
    expect(
      formatMapplsPlace({ subLocality: "Bopal", city: "Ahmedabad", state: "Gujarat" }),
    ).toBe("Bopal, Ahmedabad, Gujarat");
  });

  it("falls back through the alternatives for each part", () => {
    expect(
      formatMapplsPlace({ locality: "Sanand", village: "Sanand Town", state: "Gujarat" }),
    ).toBe("Sanand, Sanand Town, Gujarat");
    expect(formatMapplsPlace({ street: "MG Road", district: "Ahmedabad", state: "Gujarat" })).toBe(
      "MG Road, Ahmedabad, Gujarat",
    );
  });

  it("ignores the postal address, which is the wrong answer for a stamp", () => {
    // Mappls returns a full courier-grade address. It is better data and it
    // does not fit under the coordinates, so it must not leak into the label.
    const label = formatMapplsPlace({
      formatted_address: "123, Shivalik Plaza, Nr. IIM, Bopal Road, Ahmedabad, Gujarat 380058",
      subLocality: "Bopal",
      city: "Ahmedabad",
      state: "Gujarat",
    });
    expect(label).toBe("Bopal, Ahmedabad, Gujarat");
    expect(label).not.toContain("Shivalik");
  });

  it("drops a repeated name, exactly as the OpenStreetMap side does", () => {
    expect(
      formatMapplsPlace({ subLocality: "Bopal", city: "Bopal", state: "Gujarat" }),
    ).toBe("Bopal, Gujarat");
  });

  it("returns null when there is nothing worth stamping", () => {
    expect(formatMapplsPlace({})).toBeNull();
    expect(formatMapplsPlace(null)).toBeNull();
    expect(formatMapplsPlace(undefined)).toBeNull();
    // A pincode alone is not a place name.
    expect(formatMapplsPlace({ pincode: "380058" })).toBeNull();
  });

  it("stays short enough for the stamp", () => {
    const long = formatMapplsPlace({
      subLocality: "A".repeat(60),
      city: "B".repeat(60),
      state: "C".repeat(60),
    });
    expect(long).not.toBeNull();
    expect(long!.length).toBeLessThanOrEqual(80);
  });
});

describe("the two providers produce the SAME label", () => {
  it("so nothing downstream can tell which service answered", () => {
    // THE PROPERTY THAT MATTERS. A visit named by Mappls and a visit named by
    // OpenStreetMap are rendered by the same components and cached in the same
    // column; if the two formatted differently, the stamp would change shape
    // depending on which service happened to be up.
    const osm = formatPlace({ suburb: "Bopal", city: "Ahmedabad", state: "Gujarat" });
    const mappls = formatMapplsPlace({
      subLocality: "Bopal",
      city: "Ahmedabad",
      state: "Gujarat",
    });
    expect(mappls).toBe(osm);
  });

  it("because both go through one join", () => {
    expect(joinPlaceParts(["Bopal", "Ahmedabad", "Gujarat"])).toBe(
      "Bopal, Ahmedabad, Gujarat",
    );
    expect(joinPlaceParts([null, undefined, "  ", "Gujarat"])).toBe("Gujarat");
    expect(joinPlaceParts([])).toBeNull();
    expect(joinPlaceParts([null, undefined])).toBeNull();
  });
});
