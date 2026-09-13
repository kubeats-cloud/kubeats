# Mappls (MapmyIndia) — what to obtain, and how to switch it on

The photo stamp carries a line under the coordinates: an approximate area name
like `Bopal, Ahmedabad, Gujarat`. That name comes from a reverse-geocoding
service. This document is about **upgrading which service** answers.

**Nothing here is required.** With no Mappls credentials set, the app uses free
OpenStreetMap exactly as it always has. There is no degraded mode, no warning,
and no feature that stops working. Set the credentials and the same line simply
gets better in India.

---

## What this changes, and what it does not

| | |
| --- | --- |
| **Changes** | The **name** put on a set of coordinates. Mappls knows Indian colonies, sectors, blocks and landmarks that OpenStreetMap often has only as a city. |
| **Does NOT change** | **GPS accuracy.** The latitude, longitude and accuracy come from the rep's device and are decided before any of this runs. No geocoding service can move a pin. |
| **Does NOT change** | Anything a rep sees while a visit is in progress. The location readout stays hidden during the visit; this only affects the name on the finished record and on the photo stamp. |
| **Does NOT change** | The bundle. The lookup is a server-side `fetch` with no SDK, so the browser downloads exactly what it did before. |

---

## What the client needs to obtain

**From:** the Mappls API console — <https://apis.mappls.com/console/>
(MapmyIndia rebranded to Mappls; the old `mapmyindia.com/api` links redirect
there.)

**Steps:**

1. Create an account, or sign in to the organisation's existing one.
2. Go to **Dashboard → Create Project** (or open the existing project).
3. Open the project's **API keys / Credentials** section.
4. Copy the credentials it shows. Mappls issues more than one kind — see below.
5. Make sure the **Reverse Geocoding** API is enabled for that project. It sits
   under the Maps/Geocoding API family; a key that exists but has the API
   switched off returns an error, which this app treats as "no answer" and
   falls back.

### Which credential, exactly

Mappls issues different credential types depending on when and how the account
was set up. **The app accepts either**, so copy whichever the console shows:

| What the console calls it | Set this | Notes |
| --- | --- | --- |
| **Client ID** + **Client Secret** (OAuth 2.0 / "REST API") | `MAPPLS_CLIENT_ID`, `MAPPLS_CLIENT_SECRET` | The current console issues these. The app exchanges them for a short-lived bearer token itself and caches it. |
| **REST API Key** / licence key | `MAPPLS_REST_KEY` | Older accounts. No token step; the key goes straight into the request. |

Set **one** of the two. If both are present the REST key wins, because it is
the shorter path.

Also worth knowing:

- There is usually a **Map SDK / JavaScript key** alongside these. **We do not
  need it** and must not use it — it is a browser credential, and this app does
  the lookup on the server precisely so no key reaches a browser.
- Check the **free tier limit** on the project. Mappls publishes a monthly
  request allowance per account; the app's cache (below) is what keeps usage
  far under it.

---

## Where to put them

**Never in the repository.** These are server-only secrets: none of the names
carries a `NEXT_PUBLIC_` prefix, so Next will not inline them into the browser
bundle.

- **Locally:** in `.env.local` (git-ignored). See `.env.example`.
- **On Cloudflare:** Worker → Settings → Variables → **Secrets** (encrypted,
  never printed in a build log). *Not* build variables — the app reads them at
  request time, so a secret is correct and a build variable is not.

Adding or removing them needs **no rebuild and no migration**, unlike the
`NEXT_PUBLIC_*` pair. Set the secret, and the next request uses it.

---

## How to check it works

Once the credentials are set, from a machine that has them:

```bash
# OAuth accounts: does the token step work?
curl -s -X POST https://outpost.mappls.com/api/security/oauth/token \
  -d grant_type=client_credentials \
  -d client_id="$MAPPLS_CLIENT_ID" \
  -d client_secret="$MAPPLS_CLIENT_SECRET"
# Expect JSON with an "access_token" and an "expires_in".

# Then the lookup itself (use the access_token, or the REST key directly):
curl -s "https://apis.mappls.com/advancedmaps/v1/<TOKEN_OR_KEY>/rev_geocode?lat=23.0225&lng=72.5714"
# Expect JSON with a "results" array.
```

In the app, the `/api/place` response carries a `source` field: `"mappls"`,
`"openstreetmap"` or `"cache"`. That is the quickest confirmation that the
upgrade is live rather than silently falling back.

### If the response field names differ

The app reads `results[0]` and picks three parts from it — the locality, the
settlement and the state. Those field names are in **one place**:
`formatMapplsPlace()` in `src/lib/places.ts`. If the client's account answers
with different names than the ones listed there, that function is the only
thing to adjust; the rest of the chain, the cache and every screen stay as they
are.

This matters because the response shape was written from Mappls's published API
and **has not been exercised against a live paid account** — the repository has
no credentials to test with. The parsing is deliberately loose: an unrecognised
shape produces a shorter label or a clean fallback to OpenStreetMap, never an
error a rep sees.

---

## How it behaves once it is on

```
1. place_cache   a previously seen coordinate cell answers with no API call at all
2. Mappls        only if credentials are set          1.5s budget
3. Nominatim     free OpenStreetMap, no account       the remaining ~2s
4. nothing       the photo stamps with coordinates and time alone
```

Every step is allowed to fail, and failure falls to the next one. **The place
name can never block a visit or a check-in** — that rule predates this change
and is unchanged by it.

**The cache is what keeps usage inside the free tier.** `place_cache`
(migration 0007) holds one row per coordinate cell rounded to about 11 metres,
shared across the whole team, and a row is written even when the answer was
"nothing there". Twenty reps working the same neighbourhoods ask once between
them. Mappls is only ever reached on a **miss** — a rep standing somewhere the
team has not been before.

Rows already cached from OpenStreetMap are **not** re-fetched when Mappls is
switched on: the cache stores the label, not which service produced it, so both
write the same format and old rows stay valid. If the client wants existing
areas re-named at the better quality, clearing the table is safe and it refills
itself:

```sql
-- Optional. Only if you want previously cached names re-fetched from Mappls.
delete from public.place_cache;
```

---

## Turning it off

Remove the secrets. The next request goes straight to OpenStreetMap. Nothing
else needs doing — no rebuild, no migration, no code change, and every name
already cached stays exactly where it is.
