# KUbeats — Handover

The things that are the **client's** to decide or run, gathered in one place. Each links to the
document that has the full detail; this page is the index, not a copy of them.

## Outstanding client-owned items

| Item | Why it matters | Where the detail lives |
| --- | --- | --- |
| **Custom domain** | A professional URL, and it unlocks the free WAF login rate-limit (closes pen-test P1) | This document, below |
| **Rotate the service-role key** | It has appeared in a build log; rotating retires it | `docs/PHASE-10-Production-Readiness-Audit.md` (H2) and the rotation steps handed over in session |
| **Weekly backup + one restore rehearsal** | No automatic backup exists on the free tier; a mistaken delete is otherwise unrecoverable | `docs/BACKUP-RESTORE.md`, "For the client" |
| **Uptime monitoring** | Nothing polls `/api/health` today, so an outage goes unnoticed. Point a monitor at it for liveness; set `HEALTH_CHECK_TOKEN` if you also want it to check the database | `docs/PHASE-10-Production-Readiness-Audit.md` (M2), and "Security findings & posture" below for F2 |
| **Deploy size ceiling** *(no longer a constraint)* | The account is on the Workers **Paid** plan, so the limit is 10 MiB gzipped. The app measures **~2,972 KiB — about 29%**. Nothing is waiting on this; it is here so nobody re-reads the old free-plan warning and worries | `CLAUDE.md`, "Deployment ceiling" |
| **Ola Maps key** *(optional — but see the note)* | Better area names on the photo stamp in India. The app runs on free OpenStreetMap without it and nothing degrades. ⚠ **Any key in use today sits on the developer's own Ola account.** Before handover is final the client should either obtain their own key or accept that the feature switches itself off when that account goes | "Place names" below, and `docs/OLA-MAPS-SETUP.md` |
| **Roll out admin sign-in codes (MFA)** | Built and live, and switched **off for everyone** until an admin turns it on for themselves. Two admins, so one can always unlock the other | "Admin sign-in security" below |
| **Set the `security.txt` contact** | The file is live but has **no** contact yet, so finding F5 is not closed. Needs the role address the custom domain unlocks | This document, "Security findings & posture" |

None of these is an application code change. They are operational decisions for whoever owns the
Cloudflare and Supabase accounts after handover.

---

## What the app does now

A plain description of the current behaviour, for anyone picking this up cold. The detail behind
each is in `CLAUDE.md`; this is the version you can read to a new admin.

### Logging a visit is driven by one question

A rep never chooses an "activity". They plan the visit on their Dashboard by picking an institute
and a **purpose** ("First meeting", "Complete a session", "Follow-up"...), and the purpose decides
what the visit counts towards in the weekly numbers. An admin manages that list in Settings.

At the end of the visit the rep answers one question — **where does this leave the institute?** --
and that status decides everything else the form asks for:

| Status | What the form then asks |
| --- | --- |
| First meeting done | Follow-up date, notes |
| Session scheduled | Follow-up date, expected session date, notes |
| Campus visit scheduled | Follow-up date, expected campus visit date, notes |
| Pending for management approval | Follow-up date, notes |
| Invited principal for event | Follow-up date, notes |
| Session done | Session date, number of students, topic title, taken by, notes |
| Campus visit done | Campus visit date, number of students, notes |
| RSVP received | Notes only, and notes are optional |
| Will not come | Notes only, and notes are optional |

Two things follow from this that people ask about:

- **A follow-up date is only requested when the institute is left OPEN.** It used to appear on
  every status, including "Will not come", which is what made the form feel long.
- **A photo is always required**, on every status, with no exception. It is taken in the app from
  the camera — there is no option to attach a picture from the gallery — and the coordinates, time
  and area name are stamped into the image as it is taken.

The nine statuses above are **not fixed in the code**. An admin can add, rename and retire them in
Settings, and the form, the reports and the Excel export all follow automatically.

> ⚠ **Known issue, fix pending.** Logging a visit with the status **"Session done"** or **"Campus
> visit done"** currently fails: the date field is shown and filled in, but the form does not send
> the value, so it reports the date as missing and will not save. The other seven statuses are
> unaffected. It is a one-line fix — delete this note once it ships.

### Each institute belongs to one rep

An institute is visible to the rep who registered it and to admins — **not** to other reps, even on
the same campus. Campus is still the outer boundary; ownership is a tighter one inside it.

If someone leaves, or an institute is with the wrong person, an admin reassigns it from the
institute's own page ("Who this belongs to"). Only reps on that institute's campus are offered. The
visits already logged stay with the rep who made them; only the ownership moves.

### Check-in, check-out, and what an admin can see afterwards

A visit is logged from the moment the rep arrives. They check in at the institute — which records
the time, the GPS position and how accurate it was — then log the visit, then file the short
report, which stamps the check-out.

**Both ends now record their own position.** The departure used to be a bare timestamp; it carries
its own coordinates, address and accuracy, so an admin reading a visit can see a rep arrive
somewhere and leave from somewhere rather than guessing. If the device cannot get a fix on the way
out, the report still files and the record simply reads "Location unavailable" — **a missing
location can never block a rep from saving their work.**

A rep cannot check in without a location, or without typing a reason why they have not got one.
That reason is shown to admins, so the escape is logged rather than silent.

### The activity report and the Excel export

Admin → Team → **Full report** shows one row per rep for any date range, with:

- six fixed activity columns — Meetings, Sessions, Campus Visits, Olympiad Registrations,
  Applications, Admissions;
- then a column for every institute status, grouped into CLOSED and OPEN bands.

**Export to Excel** produces exactly the same grid as an `.xlsx`, laid out to match the client's own
template. The status columns are generated from the live list, so **a status an admin adds today
gets a column in tomorrow's export with no developer involved** — it appears after the template's
own columns so that existing formulas and pivots do not shift. A retired status keeps its column
only while it still has numbers in the range, marked "(retired)".

The Overview screen carries a compact version of the same table, with "View full report" beside it.

### Admin sign-in security (MFA)

Admins can add a **6-digit code from an authenticator app** to their sign-in, in
Settings → Sign-in security. It is **admin-only** — reps are never asked and are not affected in
any way.

**It is off until an admin switches it on for themselves.** Nothing is required of an account that
has not enrolled, so turning this on for one admin changes nothing for anyone else, and there is no
moment where somebody is locked out waiting for it.

**Recovery — read this before enrolling.** There are no printed backup codes. The recovery path is
each other:

1. **One admin loses their phone** → the other admin resets their code in Settings. The first admin
   then signs in with their password alone and sets up a new authenticator.
2. **Both lose access at once** → the codes can be cleared from the Supabase project itself
   (Authentication → Users). That is a different login from the app, which is exactly what makes a
   total lockout impossible.

Two recommendations that make the common case a non-event:

- **Enrol two authenticators each**, on two different devices. A lost or replaced phone then costs
  nothing.
- **Rehearse the reset once, deliberately**, before both admins are enrolled: have the second admin
  reset the first, and confirm the first can sign in and re-enrol. An untested recovery path is not
  a recovery path.

### Creating team members catches email typos

Accounts are created by an admin; there is no public sign-up. When adding someone, the form checks
the email address and warns if the domain looks like a slip — "Did you mean gmail.com?" for
`gamil.con`, and the same for common misspellings of yahoo, hotmail and outlook.

**It is a warning, not a block.** Press Add again and it proceeds, because unusual domains are real.
There is a one-tap button to accept the correction. This exists because a dead address means that
person can never reset their own password.

---

## Deploy gotchas

Things that have actually bitten during this project, rather than general advice.

### `NEXT_PUBLIC_*` values are baked in at build time

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are inlined into the bundle when it
is built, not read when it runs. **Changing either one means a rebuild, not a restart.** If you
point the app at a different Supabase project, trigger a fresh deploy (an empty commit pushed to
`main` is enough) or the old values keep being used.

Server-side values — `SUPABASE_SERVICE_ROLE_KEY`, `OLA_MAPS_API_KEY`, `HEALTH_CHECK_TOKEN` — are
read per request, so those take effect without a rebuild.

### A build variable must be written to a file, not just exported

`APP_COMMIT_SHA` is what lets `/api/health` report which commit is live. Exporting it in front of
the build command does **not** work — the value has to reach an `.env` file for the build to pick
it up:

```
echo "APP_COMMIT_SHA=$WORKERS_CI_COMMIT_SHA" >> .env.production.local && npm run build
```

The symptom of getting this wrong is a null field with nothing to explain it. `.env.example` carries
the working command.

### The Ola key must be a Secret, and it is on the developer's account today

Add it as a Cloudflare **Secret**, never a plaintext Variable: `wrangler.jsonc` declares no `vars`
block and `wrangler deploy` reconciles plaintext variables against that file, so **a key added as a
Variable is wiped by the next deploy.**

And the ownership point, which is a handover item rather than a technical one: **any Ola key in use
today belongs to the developer's own account.** Area names on the photo stamp will quietly fall back
to OpenStreetMap if that account goes away. Nothing breaks and no visit fails — the names simply
get less precise — but the client should obtain their own key if they want to keep the better ones.

### `supabase/.temp/` must stay in `.gitignore`

The Supabase CLI writes a scratch directory there. It contains **`pooler-url`, a live database
connection string**, alongside the linked project reference. It is listed in `.gitignore` and has
never been committed — **keep it that way.** If you ever see it appear in `git status` as something
to be added, the ignore rule has been broken.

### Database migrations are applied in order, by number

Everything the database needs is in `supabase/migrations/`, numbered `0001` upward. Apply them in
order; the highest is `0029`. If you restore a database from scratch, running the whole folder in
order rebuilds it — which is why a migration applied to the live database must always also be
committed to the repository. `docs/BACKUP-RESTORE.md` covers what the migrations cannot carry: the
auth users, the stored photos, the Vault secret and the scheduled job.

---

## Custom domain (client decision)

The app is live at `https://kubeats.kubeats.workers.dev`. Moving it to a domain the client
owns — e.g. `app.yourschoolgroup.com` — is optional but recommended, for two reasons:

1. **A professional URL.** A `*.workers.dev` address is fine for a developer preview; a paying
   client's field team should not be logging into someone else's subdomain.
2. **It unlocks brute-force protection on login.** Cloudflare's WAF rate-limiting is a **zone-level**
   feature — it can only be attached to a domain that exists as a zone in the account. `*.workers.dev`
   is Cloudflare's zone, not ours, so no WAF rule can attach to the current URL. On a custom domain,
   one **free** rate-limit rule closes pen-test finding **P1** (see
   `docs/PHASE-10-Frontend-Security-Pentest.md`). Until then, P1's interim risk is Medium and
   mitigated (non-enumerable login errors, Supabase's own throttling, a small admin-created user
   base with no public signup).

### Steps

**1. Add the domain to Cloudflare (free plan is fine).**
In the Cloudflare dashboard, add the domain as a site and follow the nameserver instructions. If the
domain is already on Cloudflare, it is already a zone — skip to step 2.

**2. Point the domain at the Worker.**
Workers & Pages → **kubeats** → Settings → **Domains & Routes** → **Add** → **Custom Domain** →
enter the hostname (e.g. `app.yourschoolgroup.com`). Cloudflare provisions the TLS certificate and
routes the hostname to the Worker automatically. The Worker stays reachable at its `workers.dev`
address too; that route can be disabled separately later if you want the custom domain to be the
only entry point.

**3. Add the WAF login rate-limit rule.**
Security → **WAF** → **Rate limiting rules** → create one rule on that zone:

- **When incoming requests match:** `URI Path` equals `/login` **AND** `Request Method` equals `POST`
- **Rate:** ~10 requests per 1 minute, counting by **IP**
- **Then:** **Block** (or **Managed Challenge**) for the timeout window

The free plan includes one rate-limiting rule with limited configurability — enough for exactly this.
Confirm it is available on the account's plan before relying on it.

**4. Verify.**
Send ~15 rapid `POST /login` requests from one IP; once the threshold trips they should return
`429`/`403`. (Ask the developer for the exact test command if needed.)

### What changes in the app — and what does not

**Almost nothing, and no code change is required for the app to serve on the new domain.**

- **The Supabase connection is unaffected.** The app derives the Supabase origin from the
  `NEXT_PUBLIC_SUPABASE_URL` environment variable (read in `src/lib/env.ts` and nowhere else),
  including in the Content-Security-Policy. It does **not** hardcode its own hostname anywhere, so
  moving the app's URL does not touch how it reaches the database.
- **Only the app's own URL changes**, and that happens at the edge (Cloudflare routing), not in the
  code. The app builds its links relative to the incoming request, so it works on whatever hostname
  serves it.

**Two things to update outside the code, or sign-in emails will break:**

- **Supabase Auth URLs.** Supabase dashboard → Authentication → **URL Configuration**: set the
  **Site URL** to the new domain and add it to **Redirect URLs**. Password-reset and any email links
  point at the Site URL, so if it still says the old address those emails will send people to the
  wrong place.
- **Redeploy if you change any environment variable.** `NEXT_PUBLIC_*` values are inlined at build
  time, so any env change is a rebuild, not just a restart. The domain move itself needs no env
  change — but if you also retire the `workers.dev` route or adjust anything in `.env`/the Cloudflare
  variables, trigger a fresh deploy (an empty commit pushed to `main` is enough) and re-check
  `/api/health` afterwards.

*The domain move is a handover decision. Until it happens, P1 stays Deferred / Planned with the
interim mitigation recorded above and in the pen-test report.*

---

## Place names: the Ola Maps key

The photo stamp's area name is an optional upgrade — but there **is** one thing outstanding here,
and it is an ownership question rather than a technical one. See "Whose key is it?" below.

The photo stamp carries an approximate area name under the coordinates, like
`Bopal, Ahmedabad, Gujarat`. Two services can produce that name, and the app tries them in order:

| | Service | When it is used |
| --- | --- | --- |
| 1 | `place_cache` | A coordinate cell the team has already been to. No API call at all. |
| 2 | **Ola Maps** | **Only if a key is set.** Better names in India. |
| 3 | **OpenStreetMap** (Nominatim) | Free, no account. What runs whenever no key is set, and the fallback if Ola does not answer. |
| 4 | — | Nobody could name it: the photo stamps with coordinates and time alone. |

### Whose key is it?

⚠ **Any Ola key in use today sits on the developer's own Ola account, not the client's.** That is
fine while the developer is still involved and is not fine as a permanent arrangement: if that
account lapses or the key is withdrawn, the app falls back to OpenStreetMap on the next request.

**What that fallback actually costs is small, and worth being precise about.** Nothing breaks. No
visit fails, no check-in is blocked, no screen changes. The area name under the coordinates simply
becomes less precise in India. The coordinates, the time and the photograph — the parts that are
evidence — are unaffected, because they never came from Ola in the first place.

So this is a "decide before handover is final" item, not an urgent one. The two clean endings are:

1. **The client obtains their own key** and sets it as their own Cloudflare Secret (steps below).
2. **The client accepts OpenStreetMap**, and the developer's key is removed deliberately rather
   than being left to expire silently one day.

With no key set at all the app skips Ola *without even making a request* — a supported, finished
state, with no degraded mode, no warning banner and nothing in the interface that mentions it.

### If the client wants better India place names later

They obtain their own Ola Maps key and set it as a **Cloudflare Secret** named `OLA_MAPS_API_KEY`.
That is the whole change:

- **One API key.** No client ID, no secret, no OAuth token step.
- **No code change, no rebuild, no migration, no redeploy.** It is read at request time, unlike the
  `NEXT_PUBLIC_*` pair, so the next request picks it up.
- **No new cost to us** — the client's own Ola account and their own free tier, which is measured
  in hundreds of thousands of calls a month. `place_cache` keeps realistic usage to a few hundred:
  one row per ~11 m cell, shared by the whole team, so Ola is only reached when a rep is somewhere
  the team has not been before.
- **Reversible.** Remove the secret and it goes straight back to OpenStreetMap. Names already
  cached stay valid either way, because the cache stores the label and not which service produced
  it.

> ⚠ **It must be a Secret, not a plaintext Variable.** `wrangler.jsonc` declares no `vars` block,
> and `wrangler deploy` reconciles plaintext variables against the config file — so a key added as
> a Variable is **wiped by the next deploy**. A Secret survives.

**Which key to obtain, from where, and how to verify it: `docs/OLA-MAPS-SETUP.md`.** In short, from
<https://maps.olakrutrim.com/>, with the **Places API** enabled on the project.

### How to tell which service answered

`/api/place` returns a `source` field on every successful lookup:

| `source` | Meaning |
| --- | --- |
| `"cache"` | Answered from `place_cache`; neither service was asked. |
| `"ola"` | The Ola key is set and working. |
| `"openstreetmap"` | Either no key is set, or Ola did not answer and it fell back. |

That one field is the quickest confirmation that a newly added key is actually live rather than
silently falling back. Note that a repeat lookup of the same spot returns `"cache"`, so check a
coordinate the team has not visited before.

### The rule that governs all of it

**A place name can never block a visit or a check-in.** Every step above is allowed to fail, and
failure simply omits the line: the coordinates and the time are the record and are never replaced
by the name.

And to head off the likeliest misreading: **none of this affects GPS accuracy.** The position comes
from the rep's device. A geocoding service turns coordinates into words; it cannot move a pin.

### Why not Mappls (MapmyIndia)

Mappls was wired in first and then removed. Its Indian data was comparable to Ola's; its free tier
was about **fifty lookups**, which is a day's work for one rep. Ola's free tier is measured in
hundreds of thousands of calls a month for the same quality of data, so the provider was swapped
before any key was bought. Nothing was lost: the chain was built so that step 2 is a *slot*, and
changing what fills it touched four lines of the route.

## Security findings & posture

Two independent penetration tests have been run against this app: our own during Phase 10, and a
later external one by a colleague of the client. They agreed on the shape of the result — the
application boundaries hold, and what remains is a small number of hardening items. This section is
the summary; it is not a substitute for either report.

### What both tests passed

| Area | Result |
| --- | --- |
| Role-based access control | **PASS** — a rep cannot reach admin screens or data, in the proxy, the page, and RLS |
| IDOR / object references | **PASS** — no path found to another user's records by guessing an id |
| Secrets in the bundle | **PASS** — the service-role key never reaches the client; the build asserts this |
| Open redirect | **NOT VULNERABLE** — `?next=` was already sanitised at render time |
| Security headers | **PASS** — nonce-based CSP with `strict-dynamic`, HSTS, `frame-ancestors 'none'`, no sniffing |

### What was fixed after the external test

| ID | Finding | What changed |
| --- | --- | --- |
| **F2** | Public `/api/health` ran a database query on every request, and disclosed latency and DB status | The public answer is now a static `{"ok":true}` that touches nothing (~5 ms instead of ~400 ms). The real check still exists behind `HEALTH_CHECK_TOKEN` + the `x-health-token` header; leave the variable unset and the deep check does not exist at all. |
| **F3** | The `next` parameter was sanitised when rendered but re-checked only loosely in the sign-in action | `safeNextPath()` in `src/lib/validation/auth.ts` is now the single definition both sides call. It accepts only `^/(?!/)`, rejects backslashes, control characters (CR/LF header-splitting shapes) and absurd lengths, and falls back to `/`. Covered by `tests/unit/safe-next.test.ts`. |
| **F5** | No security contact published | **Partly done.** `public/.well-known/security.txt` is live and publicly reachable — `.well-known` is excluded from the proxy matcher, so it is never redirected to login and never costs a session refresh. But `Contact:` is deliberately still unset, so **F5 remains open**: see below. |
| **F8** | Session cookie is not `HttpOnly` | Attempted, measured, and **reverted** — see below. |

### F8: why the session cookie is not HttpOnly

This was tested rather than assumed. With `httpOnly: true`:

- login — **works**
- staying signed in across navigation — **works**
- sign out — **works**
- **any upload from the browser — broken**, `403 new row violates row-level security policy`

`@supabase/ssr`'s *browser* client builds its `Authorization` header from the session it reads out of
`document.cookie`. Hide that cookie from script and the client silently falls back to the anon key,
so every call it makes is anonymous. Two paths depend on it, both uploading straight from the browser
so a multi-megabyte file never passes through a request body: the **visit photo**
(`capture-fields.tsx`) and the **materials upload** (`material-upload-form.tsx`). Because Rule 12
makes a photo mandatory, `HttpOnly` means a rep cannot log **any** visit at all.

The failure is worth understanding because of its shape: server-rendered pages keep working, so login
and navigation look healthy, and the app only breaks at the moment a rep standing in front of a school
tries to save their work.

A control run confirmed the cause rather than inferring it — the identical upload returns `200` with
`HttpOnly` off and `403` with it on, changing nothing else.

So it stays off as a **known `@supabase/ssr` constraint**, not an oversight. Standing in for it: a
nonce-based CSP with `strict-dynamic` that refuses inline and third-party script — which is what an
XSS would need in order to read the cookie in the first place — plus `SameSite=Lax`, `Secure` in
production, and HSTS. Worth revisiting if `@supabase/ssr` ever reads the session server-side only.

### F5: why security.txt has no contact yet

The file is served; the `Contact:` line is not set. That is a decision, not an
oversight, and it means **F5 is not closed**.

A security contact should be a **role address that outlives any one person** —
`security@<your domain>` — rather than an individual's inbox. security.txt is
harvested by scrapers within hours of going public, so a personal address put
here is leaked permanently and cannot be withdrawn, and real reports end up
routed to someone who may later have nothing to do with the project.

The custom domain is what makes a role address possible, which is why this
waits on the same move as F1. When the domain lands:

1. uncomment the `Contact:` line in `public/.well-known/security.txt` and set
   the hostname;
2. redeploy (an empty commit pushed to `main` is enough);
3. confirm with `curl https://<domain>/.well-known/security.txt`.

Everything else about the file is already proven in production — the path, the
proxy exemption, the public reachability and the deploy. Only the address is
missing. `Expires` is set to 2030-01-01, so the file will not go stale in the
meantime; RFC 9116 treats an expired file as invalid, so refresh that date
whenever you next touch it.

### F1: login rate-limiting — deferred to the custom domain

Both tests found it, and it is the same finding under two names: the external report calls it **F1**,
our Phase 10 report calls it **P1**. There is no per-IP throttle in front of the login form. It is
**deferred on purpose**, not overlooked. Cloudflare's free WAF closes it with a rate-limit rule once the app is on
a custom domain, which costs nothing and adds no host-specific code to the app — and adding an
application-level limiter now would mean either a new dependency or a KV binding, both of which the
portability rule exists to keep out.

Interim mitigation, already in place: Supabase Auth applies its own per-project throttling and returns
`429`, which the sign-in action surfaces as *"Too many attempts."*; sign-in failures are
indistinguishable ("Invalid email or password") so the form is not an account-enumeration oracle; and
accounts are admin-created, so there is no public sign-up surface to spray.

See "Custom domain" above for the steps. **The rule is the last step of that move, not a separate
task.**

### The pattern note that outlives these findings

**`proxy.ts` returns early for `/api/*`.** Page routes are behind the session gate; API routes are
not — the proxy refreshes the session and then hands the request straight to the route, because
redirecting a `fetch()` to an HTML login page would answer JSON with a document.

So **every future `/api/*` route must authenticate itself** — check a session, check a role, or check
a secret — or it is public to the internet. F2 was exactly this mistake made once. `/api/health` is
now the worked example of the rule, not an exception to it.
