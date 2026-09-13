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
| **Deploy size ceiling** | ~123 KiB headroom under the 3072 KiB free-plan limit (measured, noindex/privacy branch); a big feature could still need the $5/mo Workers Paid plan | `docs/PHASE-10-Production-Readiness-Audit.md`, "Known limitations" |
| **Mappls (MapmyIndia) key** *(optional)* | Better area names on the photo stamp in India. Entirely optional: unset, the app uses free OpenStreetMap exactly as it does today, and nothing degrades. Obtain from the Mappls console and set as a Cloudflare **Secret** | `docs/MAPMYINDIA-SETUP.md` |
| **Set the `security.txt` contact** | The file is live but has **no** contact yet, so finding F5 is not closed. Needs the role address the custom domain unlocks | This document, "Security findings & posture" |

None of these is an application code change. They are operational decisions for whoever owns the
Cloudflare and Supabase accounts after handover.

---

## Custom domain (client decision)

The app is live at `https://kubeats.pavanstudy2012.workers.dev`. Moving it to a domain the client
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
