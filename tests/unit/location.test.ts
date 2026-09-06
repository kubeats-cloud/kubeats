import { describe, expect, it } from "vitest";
import {
  ACCURACY_BADGE,
  GOOD_ACCURACY_M,
  NETWORK_ACCURACY_M,
  accuracyBand,
  describeAccuracy,
  formatAccuracy,
  parseAccuracy,
  shouldRetryLocation,
} from "@/lib/validation/location";

/**
 * The accuracy vocabulary, which exists because a visit in Ahmedabad was
 * recorded 25 km away in Gandhinagar and nothing in the system could tell.
 *
 * The point of every rule here is that a number alone is not enough: "137 m"
 * looks fine until you know it came from a Wi-Fi lookup rather than a
 * satellite, so the band and the wording are the product, not decoration.
 */

describe("accuracyBand", () => {
  it("calls a satellite-quality fix good", () => {
    expect(accuracyBand(5)).toBe("good");
    expect(accuracyBand(20)).toBe("good");
    expect(accuracyBand(GOOD_ACCURACY_M)).toBe("good");
  });

  it("calls a neighbourhood fix approximate", () => {
    expect(accuracyBand(GOOD_ACCURACY_M + 1)).toBe("approximate");
    expect(accuracyBand(400)).toBe("approximate");
    expect(accuracyBand(NETWORK_ACCURACY_M - 1)).toBe("approximate");
  });

  it("calls a whole-city fix network", () => {
    // The band the Gandhinagar error lived in.
    expect(accuracyBand(NETWORK_ACCURACY_M)).toBe("network");
    expect(accuracyBand(3000)).toBe("network");
    expect(accuracyBand(25_000)).toBe("network");
  });

  it("does not pretend to know when the browser did not say", () => {
    expect(accuracyBand(null)).toBe("unknown");
    expect(accuracyBand(Number.NaN)).toBe("unknown");
    expect(accuracyBand(-1)).toBe("unknown");
  });

  it("has a badge for every band", () => {
    for (const band of ["good", "approximate", "network", "unknown"] as const) {
      expect(ACCURACY_BADGE[band], band).toBeTruthy();
    }
  });
});

describe("the 137 m case — the one that actually happened", () => {
  it("is called good, which is exactly why it went unnoticed", () => {
    // The real reading from the machine that produced the wrong location. It
    // IS precise by its own account; it was simply wrong. No threshold can
    // catch this one, which is why the fix is to RECORD accuracy and to wait
    // for a better fix — not to rely on the number alone.
    expect(accuracyBand(137)).toBe("good");
    expect(shouldRetryLocation(137)).toBe(false);
  });
});

describe("formatAccuracy", () => {
  it("uses metres below a kilometre and kilometres above", () => {
    expect(formatAccuracy(12)).toBe("±12 m");
    expect(formatAccuracy(137.4)).toBe("±137 m");
    expect(formatAccuracy(999)).toBe("±999 m");
    expect(formatAccuracy(1000)).toBe("±1.0 km");
    expect(formatAccuracy(3200)).toBe("±3.2 km");
  });

  it("says so plainly when there is no figure", () => {
    expect(formatAccuracy(null)).toBe("accuracy unknown");
  });
});

describe("describeAccuracy", () => {
  it("says what the number means, not just what it is", () => {
    expect(describeAccuracy(12)).toBe("±12 m (good)");
    expect(describeAccuracy(400)).toBe("±400 m (approximate)");
    expect(describeAccuracy(3200)).toBe(
      "±3.2 km (network location — likely not your real spot)",
    );
    expect(describeAccuracy(null)).toBe("Accuracy unknown");
  });
});

describe("shouldRetryLocation", () => {
  it("nudges on approximate and network, not on good", () => {
    expect(shouldRetryLocation(20)).toBe(false);
    expect(shouldRetryLocation(GOOD_ACCURACY_M)).toBe(false);
    expect(shouldRetryLocation(GOOD_ACCURACY_M + 1)).toBe(true);
    expect(shouldRetryLocation(5000)).toBe(true);
  });

  it("does not nag when the browser gave no figure", () => {
    // Unknown is not the same as bad. Prompting a retry that cannot improve
    // anything would just be noise at a school gate.
    expect(shouldRetryLocation(null)).toBe(false);
  });
});

describe("parseAccuracy", () => {
  it("reads a form value, and refuses nonsense", () => {
    expect(parseAccuracy("137")).toBe(137);
    expect(parseAccuracy("12.5")).toBe(12.5);
    expect(parseAccuracy("")).toBeNull();
    expect(parseAccuracy("   ")).toBeNull();
    expect(parseAccuracy("-5")).toBeNull();
    expect(parseAccuracy("north")).toBeNull();
  });
});

describe("the threshold is one constant", () => {
  it("is the only thing deciding good from approximate", () => {
    // The brief asked for an easy-to-change threshold. If this ever needs
    // moving, it moves in one place and every band follows.
    expect(GOOD_ACCURACY_M).toBe(150);
    expect(accuracyBand(GOOD_ACCURACY_M)).toBe("good");
    expect(accuracyBand(GOOD_ACCURACY_M + 0.01)).toBe("approximate");
  });
});
