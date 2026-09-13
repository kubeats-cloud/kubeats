# Ola Maps — what to obtain, and how to switch it on

The photo stamp carries a line under the coordinates: an approximate area name
like `Bopal, Ahmedabad, Gujarat`. That name comes from a reverse-geocoding
service. This document is about **upgrading which service** answers.

**Nothing here is required.** With no Ola key set, the app uses free
OpenStreetMap exactly as it always has. There is no degraded mode, no warning,
and no feature that stops working. Set the key and the same line simply gets
better in India.

---

## What this changes, and what it does not

| | |
| --- | --- |
| **Changes** | The **name** put on a set of coordinates. Ola knows Indian colonies, sectors, blocks and landmarks that OpenStreetMap often has only as a city. |
| **Does NOT change** | **GPS accuracy.** The latitude, longitude and accuracy come from the rep's device and are decided before any of this runs. No geocoding service can move a pin. |
| **Does NOT change** | Anything a rep sees while a visit is in progress. The location readout stays hidden during the visit; this only affects the name on the finished record and the photo stamp. |
| **Does NOT change** | The bundle. The lookup is a server-side `fetch` with no SDK, so the browser downloads exactly what it did before. |

---

## What the client needs to obtain

**Credential type: a single API key.** No client ID, no client secret, no OAuth
token exchange. Ola's Places API authenticates a request with one key passed as
a query parameter.

**Environment variable name: `OLA_MAPS_API_KEY`**

**From:** the Ola Maps developer portal — <https://maps.olakrutrim.com/>
(sign-in goes through the Krutrim Cloud console at
<https://cloud.olakrutrim.com/>; Ola Maps is one of the products there).

**Steps:**

1. Create an account, or sign in to the organisation's existing one.
2. Open **Ola Maps** and create a **project** (some dashboards call it an app).
3. Open the project's **API Keys** / **Credentials** section and generate a key.
4. Make sure the **Places API** is enabled for that project — reverse geocoding
   lives under Places, not under the Map Tiles or Routing products. A key that
   exists but has the API switched off returns an error, which this app treats
   as "no answer" and falls back.
5. Check the free-tier allowance on the project. Ola publishes a monthly free
   quota in the hundreds of thousands of calls; the cache below keeps usage a
   tiny fraction of it.

> **If the dashboard offers you OAuth project credentials (a client ID and
> secret) instead of a plain key**, tell me. The Places API does not require
> them, but if that is all the account issues it is a small addition to
> `src/lib/ola.ts` — the same token-exchange shape the previous provider used.

**Not needed:** any browser/JavaScript SDK key. The lookup runs server-side
precisely so no key reaches a browser — and it matters more here than usual,
because Ola's key travels in the query string.

---

## Where to put it

**Never in the repository.** This is a server-only secret: the name carries no
`NEXT_PUBLIC_` prefix, so Next will not inline it into the browser bundle.

- **Locally:** in `.env.local` (git-ignored). See `.env.example`.
- **On Cloudflare:** Worker → Settings → Variables → **Secrets** (encrypted,
  never printed in a build log). *Not* a plaintext Variable.

> ⚠ **Secrets, not Variables — this bites.** `wrangler.jsonc` deliberately
> declares no `vars` block, and `wrangler deploy` reconciles plaintext
> variables against the config file. A key added as a plaintext **Variable**
> will be **wiped by the next deploy**. A **Secret** survives.

Adding or removing the key needs **no rebuild and no migration**, unlike the
`NEXT_PUBLIC_*` pair. Set the secret, and the next request uses it.

---

## How to check it works

Once the key exists, from any machine:

```bash
curl -s "https://api.olamaps.io/places/v1/reverse-geocode?latlng=23.0225,72.5714&api_key=YOUR_KEY"
```

Expect JSON with a `results` array whose first entry has an
`address_components` list. A 401/403 means the key is wrong or not yet active;
an error mentioning the API means Places is not enabled on the project.

**In the app**, the `/api/place` response carries a `source` field:

| `source` | Meaning |
| --- | --- |
| `"cache"` | Answered from `place_cache`; no service was asked. |
| `"ola"` | The Ola key is set and working. |
| `"openstreetmap"` | Either no key is set, or Ola did not answer and it fell back. |

From a signed-in tab, DevTools console:

```js
await (await fetch('/api/place', {method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({latitude:23.2295,longitude:72.6500})})).json()
```

Use a coordinate the team has **not** visited, or you will get `"cache"`, which
proves nothing either way. `npx wrangler tail kubeats --format pretty` shows
`[ola:reverse]` lines when a lookup fails, saying which step went wrong.

### If the response shape differs from the docs

The app reads `results[0].address_components` and picks three parts from it by
component **type** — the locality, the settlement and the state. Those type
names are in **one place**: `formatOlaPlace()` in `src/lib/places.ts`. If the
live answer is shaped differently, that function is the only thing to adjust;
the chain, the cache and every screen stay as they are.

This matters because the response shape was written from Ola's published API
and **has not been exercised against a live account** — the repository has no
key to test with. The parsing is deliberately loose: an unrecognised shape
produces a shorter label or a clean fallback to OpenStreetMap, never an error a
rep sees.

---

## How it behaves once it is on

```
1. place_cache   a previously seen coordinate cell answers with no API call at all
2. Ola Maps      only if a key is set                 1.5s budget
3. Nominatim     free OpenStreetMap, no account       the remaining ~2s
4. nothing       the photo stamps with coordinates and time alone
```

Every step is allowed to fail, and failure falls to the next one. **The place
name can never block a visit or a check-in** — that rule predates this change
and is unchanged by it.

**The cache is what keeps usage trivial.** `place_cache` (migration 0007) holds
one row per coordinate cell rounded to about 11 metres, shared across the whole
team, and a row is written even when the answer was "nothing there". Twenty
reps working the same neighbourhoods ask once between them. Ola is only ever
reached on a **miss** — a rep standing somewhere the team has not been before.
Realistic usage is a few hundred calls a month against a free tier measured in
hundreds of thousands.

Rows already cached from OpenStreetMap are **not** re-fetched when Ola is
switched on: the cache stores the label, not which service produced it, so both
write the same format and old rows stay valid. If the client wants existing
areas re-named at the better quality, clearing the table is safe and it refills
itself:

```sql
-- Optional. Only if you want previously cached names re-fetched from Ola.
delete from public.place_cache;
```

---

## Turning it off

Remove the secret. The next request goes straight to OpenStreetMap. Nothing
else needs doing — no rebuild, no migration, no code change, and every name
already cached stays exactly where it is.

---

## A note on the provider before this one

Mappls (MapmyIndia) was wired in first and removed in favour of Ola. Its data
was comparable; its free tier was not — about fifty lookups, which is a day's
work for one rep. The code is gone rather than left dormant, because git history
is a better archive than an unwired provider sitting in the chain confusing the
next reader. If it is ever wanted back, the commits that added it are
self-contained and revertable.
