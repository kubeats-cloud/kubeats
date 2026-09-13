import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAPPLS_TIMEOUT_MS,
  forgetMapplsToken,
  mapplsConfigured,
  reverseGeocode,
} from "@/lib/mappls";
import { PLACE_TIMEOUT_MS } from "@/lib/geolocate";

/**
 * The Mappls provider, and above all what it does when it is NOT configured.
 *
 * The headline property is the one the client asked for in writing: with no
 * credentials set the app must behave exactly as it did before Mappls existed.
 * That is asserted here as "no fetch is made at all", which is stronger than
 * "it returns false" — a request that goes out and fails would still cost the
 * rep the timeout, and the photo stamp is what waits for it.
 *
 * Everything else is failure behaviour. There is no test that Mappls returns a
 * good label, because that needs live paid credentials; what IS tested is that
 * every way it can go wrong ends in `ok: false` rather than a throw, because
 * `ok: false` is what makes the route fall through to OpenStreetMap.
 */

const KEYS = [
  "MAPPLS_REST_KEY",
  "MAPPLS_CLIENT_ID",
  "MAPPLS_CLIENT_SECRET",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  forgetMapplsToken();
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  forgetMapplsToken();
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

describe("with no credentials at all — the supported default", () => {
  it("reports itself unconfigured", () => {
    expect(mapplsConfigured()).toBe(false);
  });

  it("never reaches the network, so the fallback costs nothing", async () => {
    const fetchSpy = forbiddenFetch();
    const result = await reverseGeocode(23.0225, 72.5714);

    expect(result).toEqual({ ok: false });
    expect(fetchSpy, "an unconfigured lookup must not spend a request").not.toHaveBeenCalled();
  });

  it("treats half a credential as no credential", async () => {
    // A client id with no secret is a typo, not a configuration. Spending a
    // request that is certain to be rejected would cost the rep the timeout.
    process.env.MAPPLS_CLIENT_ID = "id-without-a-secret";
    expect(mapplsConfigured()).toBe(false);

    const fetchSpy = forbiddenFetch();
    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();

    delete process.env.MAPPLS_CLIENT_ID;
    process.env.MAPPLS_CLIENT_SECRET = "secret-without-an-id";
    expect(mapplsConfigured()).toBe(false);
  });

  it("counts a blank string as unset, not as a key", () => {
    process.env.MAPPLS_REST_KEY = "   ";
    expect(mapplsConfigured()).toBe(false);
  });
});

describe("credential shapes", () => {
  it("accepts a REST key on its own", () => {
    process.env.MAPPLS_REST_KEY = "a-rest-key";
    expect(mapplsConfigured()).toBe(true);
  });

  it("accepts a client id and secret together", () => {
    process.env.MAPPLS_CLIENT_ID = "an-id";
    process.env.MAPPLS_CLIENT_SECRET = "a-secret";
    expect(mapplsConfigured()).toBe(true);
  });

  it("uses a REST key directly, with no token round trip", async () => {
    process.env.MAPPLS_REST_KEY = "a-rest-key";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({ results: [{ subLocality: "Bopal", city: "Ahmedabad", state: "Gujarat" }] }),
      );

    const result = await reverseGeocode(23.0225, 72.5714);

    expect(result).toEqual({ ok: true, label: "Bopal, Ahmedabad, Gujarat" });
    expect(fetchSpy, "one call: the lookup, and no token step").toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("rev_geocode");
  });
});

describe("the OAuth path", () => {
  beforeEach(() => {
    process.env.MAPPLS_CLIENT_ID = "an-id";
    process.env.MAPPLS_CLIENT_SECRET = "a-secret";
  });

  it("takes a token, then asks, and normalises to the app's own label format", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 86400 }))
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ subLocality: "Bopal", city: "Ahmedabad", state: "Gujarat" }] }),
      );

    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({
      ok: true,
      label: "Bopal, Ahmedabad, Gujarat",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("oauth/token");
  });

  it("reuses the token rather than minting one per lookup", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 86400 }))
      .mockResolvedValue(jsonResponse({ results: [{ city: "Ahmedabad", state: "Gujarat" }] }));

    await reverseGeocode(23.0225, 72.5714);
    await reverseGeocode(23.0325, 72.5814);

    // One token, two lookups — not two tokens.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("falls back when the token step is refused", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "nope" }, 401));
    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: false });
  });

  it("falls back when the token response has no token in it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ expires_in: 86400 }));
    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: false });
  });
});

describe("every way the lookup can go wrong ends in a clean fallback", () => {
  beforeEach(() => {
    process.env.MAPPLS_REST_KEY = "a-rest-key";
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
    // and the same distinction place_cache keeps for Nominatim.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ results: [{ pincode: "380058" }] }),
    );
    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: true, label: null });
  });
});

describe("a rejected token is dropped, so the next lookup re-mints one", () => {
  beforeEach(() => {
    process.env.MAPPLS_CLIENT_ID = "an-id";
    process.env.MAPPLS_CLIENT_SECRET = "a-secret";
  });

  it("recognises Mappls's 400 + invalid_token, which is NOT a 401", async () => {
    // THE BUG THIS GUARDS, found by probing the live endpoint rather than by
    // reading the docs. A dead Mappls token comes back as
    //   {"responsecode":"400","error_code":"invalid_token", ...}
    // so the obvious `status === 401` check never fired. A token revoked or
    // rotated early would have stayed cached until its nominal expiry, every
    // lookup would have been refused, and every one would have fallen back to
    // OpenStreetMap — silently, with the client still paying for Mappls.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "stale", expires_in: 86400 }))
      .mockResolvedValueOnce(
        jsonResponse(
          { responsecode: "400", error_code: "invalid_token", error: "invalid_token" },
          400,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh", expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ city: "Ahmedabad", state: "Gujarat" }] }));

    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: false });
    // The second lookup must mint a NEW token rather than reuse the dead one.
    expect(await reverseGeocode(23.0325, 72.5814)).toEqual({
      ok: true,
      label: "Ahmedabad, Gujarat",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(String(fetchSpy.mock.calls[2][0]), "a fresh token was minted").toContain(
      "oauth/token",
    );
  });

  it("still honours a plain 401", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "stale", expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh", expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ city: "Ahmedabad", state: "Gujarat" }] }));

    await reverseGeocode(23.0225, 72.5714);
    await reverseGeocode(23.0325, 72.5814);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("keeps the token when the failure is nothing to do with it", async () => {
    // A 429 or a 500 says nothing about the credential. Throwing the token away
    // on every hiccup would mean a token round trip per rate-limited lookup.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "good", expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse({ message: "rate limited" }, 429))
      .mockResolvedValueOnce(jsonResponse({ results: [{ city: "Ahmedabad", state: "Gujarat" }] }));

    expect(await reverseGeocode(23.0225, 72.5714)).toEqual({ ok: false });
    expect(await reverseGeocode(23.0325, 72.5814)).toEqual({
      ok: true,
      label: "Ahmedabad, Gujarat",
    });

    // Three calls, not four: one token, two lookups.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe("the timeout budget", () => {
  it("leaves room for OpenStreetMap inside the browser's own deadline", () => {
    // THE REGRESSION THIS GUARDS. Giving Mappls its own full 3.5s would make
    // the worst case 7s, the browser aborts at 4s, and every photo in a slow
    // spot would wait longer and still get nothing. Mappls plus Nominatim must
    // fit inside the route's 3.5s, which must fit inside the browser's 4s.
    const ROUTE_BUDGET_MS = 3500;
    expect(MAPPLS_TIMEOUT_MS).toBeLessThan(ROUTE_BUDGET_MS);
    expect(ROUTE_BUDGET_MS - MAPPLS_TIMEOUT_MS).toBeGreaterThanOrEqual(1500);
    expect(ROUTE_BUDGET_MS).toBeLessThan(PLACE_TIMEOUT_MS);
  });
});
