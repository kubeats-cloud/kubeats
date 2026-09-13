import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OLA_TIMEOUT_MS, olaConfigured, reverseGeocode } from "@/lib/ola";
import { PLACE_TIMEOUT_MS } from "@/lib/geolocate";

/**
 * The Ola Maps provider, and above all what it does when it is NOT configured.
 *
 * The headline property is the one the client asked for in writing: with no key
 * set the app must behave exactly as it did before Ola existed. That is
 * asserted here as "no fetch is made at all", which is stronger than "it
 * returns false" — a request that goes out and fails would still cost the rep
 * the timeout, and the photo stamp is what waits for it.
 *
 * Everything else is failure behaviour. There is no test that Ola returns a
 * good label, because that needs a live key; what IS tested is that every way
 * it can go wrong ends in `ok: false` rather than a throw, because `ok: false`
 * is what makes the route fall through to OpenStreetMap.
 */

const KEY = "OLA_MAPS_API_KEY";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[KEY];
  delete process.env[KEY];
  vi.restoreAllMocks();
});

afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
  vi.restoreAllMocks();
});

/** A fetch that fails the test if it is ever called. */
const forbiddenFetch = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    throw new Error(`fetch must not be called, but it asked for ${String(input)}`);
  });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** One Ola result, in the Google-shaped component form its API returns. */
const olaResult = (
  components: { long_name: string; types: string[] }[],
) => ({ results: [{ address_components: components }] });

describe("with no key at all — the supported default", () => {
  it("reports itself unconfigured", () => {
    expect(olaConfigured()).toBe(false);
  });

  it("never reaches the network, so the fallback costs nothing", async () => {
    const fetchSpy = forbiddenFetch();
    const result = await reverseGeocode(23.0225, 72.5714);

    expect(result).toEqual({ ok: false });
    expect(fetchSpy, "an unconfigured lookup must not spend a request").not.toHaveBeenCalled();
  });

  it("counts a blank string as unset, not as a key", async () => {
    process.env[KEY] = "   ";
    expect(olaConfigured()).toBe(false);

    const fetchSpy = forbiddenFetch();
    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("with a key", () => {
  beforeEach(() => {
    process.env[KEY] = "a-test-key";
  });

  it("is configured", () => {
    expect(olaConfigured()).toBe(true);
  });

  it("asks once, and normalises to the app's own label format", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        olaResult([
          { long_name: "Bopal", types: ["sublocality_level_1", "sublocality"] },
          { long_name: "Ahmedabad", types: ["locality"] },
          { long_name: "Gujarat", types: ["administrative_area_level_1"] },
          { long_name: "380058", types: ["postal_code"] },
          { long_name: "India", types: ["country"] },
        ]),
      ),
    );

    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({
      ok: true,
      label: "Bopal, Ahmedabad, Gujarat",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sends the coordinates as one latlng pair, and the key in the query", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(olaResult([])));

    await reverseGeocode(23.0225, 72.5714);

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("latlng=23.0225%2C72.5714");
    expect(url).toContain("api_key=a-test-key");
  });

  it("escapes a key rather than letting it add a parameter of its own", async () => {
    // The key is an opaque string from an environment variable. Interpolating
    // it raw would let a stray "&" become a second query parameter.
    process.env[KEY] = "abc&foo=bar";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(olaResult([])));

    await reverseGeocode(23.0225, 72.5714);

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("api_key=abc%26foo%3Dbar");
    expect(url).not.toContain("foo=bar&");
  });
});

describe("every way the lookup can go wrong ends in a clean fallback", () => {
  beforeEach(() => {
    process.env[KEY] = "a-test-key";
  });

  it("a rejected key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ message: "denied" }, 403));
    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: false });
  });

  it("a rate limit is not an answer, and is never cached as one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 429));
    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: false });
  });

  it("a server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 500));
    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: false });
  });

  it("a network failure, rather than throwing out of the route", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
    await expect(reverseGeocode(23.0225, 72.5714)).resolves.toEqual({ ok: false });
  });

  it("a body that is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>nope</html>"));
    await expect(reverseGeocode(23.0225, 72.5714)).resolves.toEqual({ ok: false });
  });

  it("a JSON body shaped nothing like the documented one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ surprise: true }));
    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: false });
  });

  it("an empty results array", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ results: [] }));
    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: false });
  });

  it("a result with nothing worth stamping is an ANSWER, not a failure", async () => {
    // ok: true with a null label means "asked, nothing there" — worth caching,
    // and the same distinction place_cache keeps for Nominatim. A PIN code and
    // a country are not a place name.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        olaResult([
          { long_name: "380058", types: ["postal_code"] },
          { long_name: "India", types: ["country"] },
        ]),
      ),
    );
    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: true, label: null });
  });
});

describe("the timeout budget", () => {
  it("leaves room for OpenStreetMap inside the browser's own deadline", () => {
    // THE REGRESSION THIS GUARDS. Giving Ola its own full 3.5s would make the
    // worst case 7s, the browser aborts at 4s, and every photo in a slow spot
    // would wait longer and still get nothing. Ola plus Nominatim must fit
    // inside the route's 3.5s, which must fit inside the browser's 4s.
    const ROUTE_BUDGET_MS = 3500;
    expect(OLA_TIMEOUT_MS).toBeLessThan(ROUTE_BUDGET_MS);
    expect(ROUTE_BUDGET_MS - OLA_TIMEOUT_MS).toBeGreaterThanOrEqual(1500);
    expect(ROUTE_BUDGET_MS).toBeLessThan(PLACE_TIMEOUT_MS);
  });
});
