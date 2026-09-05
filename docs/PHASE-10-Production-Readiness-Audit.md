# KUbeats — Phase 10 Production-Readiness Audit

**Prepared for:** client handover
**Application:** KUbeats — mobile-first field reporting for an education sales team
**Live:** https://kubeats.pavanstudy2012.workers.dev
**Audited:** 5 September 2026, against commit `b45cfc2` and the live deployment
**Scale this is calibrated to:** ~20 reps, 50–100 user accounts, Cloudflare Workers free plan,
Supabase free tier

**Method.** This is not a checklist read against the source. Every security claim below was
executed against the live production project as a real signed-in rep — 20 probes, listed in
section 4 — and every deployment claim was measured against the live Worker. Where a finding says
"verified", it was reproduced; where it says "assessed", it was reasoned from the code and is
labelled as such.

---

## 1. Executive summary

**Verdict: APPROVED AFTER FIXES — 79/100.**

I would hand this to a paying client after roughly **one hour of operational work**, none of it
code. It is materially better engineered than most projects of its size, and the things standing
between it and approval are not defects in the software.

What is genuinely strong, and was verified rather than assumed:

- **The security model holds under attack.** Twenty probes were run against production as a real
  rep — privilege escalation, IDOR reads and writes across every table, storage traversal, the
  weekly lock, the meeting gate, evidence tampering. **All twenty behaved correctly.** A rep cannot
  promote themselves, cannot see or touch another rep's data, and cannot rewrite a photograph they
  have already filed.
- **The load-bearing rules live in Postgres, not in TypeScript.** The meeting gate, the weekly lock,
  the mandatory photo and the photo's immutability are CHECK constraints and triggers. They refuse
  the service-role key as readily as they refuse a rep. This is the single best structural decision
  in the codebase, and it is why the security result above is trustworthy rather than incidental.
- **Documentation is exceptional for this scale** — a 325-line backup and restore runbook with a
  tested restore procedure, and a README that explains decisions rather than listing commands.
- **The code explains its own reasoning.** Comments say *why*, consistently, including why things
  were *not* done. That is what makes this maintainable by someone who is not its author, which is
  the whole point of a handover.

What stops me approving it outright:

- **There is no backup of production data. None.** The tooling is written and documented, but
  `npm run backup` has never been run — there is no `backups/` directory — and the Supabase free
  tier includes no automated database backups. Today, a mistaken delete or a project problem is
  unrecoverable. This is the one finding I would not sign off around, and it is ~10 minutes to fix.
- **The service-role key should be rotated.** The build tooling materialises it in plaintext on
  disk, and it has previously reached a build log. I verified the exposure really is contained —
  it is not in the client bundle, not in git, and not in the deployed artefact — but a key that has
  been in a log should not stay in service.

Neither is a code change. Both are operational, and both are listed as pre-handover work in
section 7.

**One thing the client should be told plainly:** the app is **123 KiB under a hard 3 MiB deploy
ceiling** on the Cloudflare free plan. That is under 5% headroom. It is a deliberate, documented
choice and not an oversight — but it means the next meaningful feature will likely require the
$5/month Workers Paid plan. Better said now than discovered during a deploy.

---

## 2. Findings by severity

### CRITICAL — none

No critical issues were found. Specifically ruled out by testing, not by inspection: privilege
escalation, IDOR, secret exposure in the deployed artefact or client bundle, secrets in git history,
SQL injection, and authentication bypass.

---

### HIGH

#### H1 — No backups exist for production data

**What.** `npm run backup` has never been run: there is no `backups/` directory. The Supabase free
tier provides no automated database backups (those begin on Pro). The documented schedule is a
Windows Task Scheduler entry or a cron job that someone has to create on a machine that stays on.

**Why it matters.** The database holds the entire commercial record — every institute, every visit,
GPS coordinates, contact names and mobile numbers. An accidental delete, a bad migration, or a
problem with the Supabase project is currently **unrecoverable**. For a paying client this is the
single largest risk in the system, and it is a risk of total loss rather than degradation.

**Fix (10 minutes).** Run `npm run backup` now to establish a baseline. Then either schedule it per
`docs/BACKUP-RESTORE.md`, or upgrade Supabase to Pro for automated daily backups — noting that Pro
backups cover the database and auth users but **not** the photo files or the Vault secret and cron
job, so the script is still wanted. Store backups off the machine that runs them.

> **Status — 5 Sep 2026: partly closed.**
>
> - A **baseline backup has been taken and verified**: 14 files, 63.7 KiB; every table's row count
>   matches production, auth user ids and emails match, and the stored photo is **byte-identical**
>   to the live object (SHA-256 `78ecf48cb2540d3b…`). `npm run restore --dry-run` reads it correctly
>   and its "same project" guard fires as intended.
> - **`npm run backup:verify` now exists** (`scripts/verify-backup.mjs`, 21 unit tests) so checking a
>   backup is a routine anyone can run. It is deliberately **offline** — no network, no credentials —
>   so it works on a copy from an external drive years later, which is when it is actually needed.
> - `docs/BACKUP-RESTORE.md` now opens with a **client-facing section** naming who owns each job, the
>   tested weekly Task Scheduler command, why backups must live off the app machine, and a full
>   **restore rehearsal** procedure.
>
> **Still open, and still the handover blocker:** the recurring schedule is not running on a machine
> the client controls, and the restore rehearsal has not been performed. The tooling and the
> procedure are done; the operational commitment is not. Note also that the baseline was taken when
> the database was nearly empty (0 institutes, 0 visits), so it proves the pipeline rather than a
> full-data restore — take another once real field data exists.

---

#### H2 — The service-role key is materialised in plaintext by the build, and has reached a build log

**What.** `@opennextjs/cloudflare` generates `.open-next/cloudflare/next-env.mjs`, which embeds the
**entire local environment as string literals** — including `SUPABASE_SERVICE_ROLE_KEY`. It is
copied into `worker.js.map` as well.

**Blast radius — measured, not assumed:**

| Location | Contains the key? | Evidence |
| --- | --- | --- |
| Client bundle (`.next/static`) | **No** | Only the zod field *name* appears: `SUPABASE_SERVICE_ROLE_KEY:sJ.z.string().min(1)`. Byte-search for the value found nothing. |
| Git history (all branches) | **No** | Zero JWT-shaped strings across all history. The 68 hits for "service_role" are the literal word in SQL and docs. |
| Deployed Worker (`worker.js`) | **No** | Byte-search clean. |
| Uploaded to Cloudflare | **No** | `Total Upload: 10918.58 KiB` exactly equals `worker.js` (10918 KiB). The 24,902 KiB source map is **not** uploaded — `upload_source_maps` is unset, so Wrangler's default of `false` applies. |
| Local `.open-next/` on disk | **Yes** | Gitignored (`.gitignore:48`). |
| Cloudflare build container | **Transiently** | Regenerated there from dashboard variables each build. |

So the exposure is genuinely contained, and `wrangler.jsonc` is correct on the point that matters:
there is no `vars` block, and the key is set as a **Secret** rather than a Variable.

**Why it still matters.** Two reasons. First, a key that has appeared in a build log should be
rotated regardless of how contained it was — that is hygiene, not paranoia. Second, this is a
**latent footgun**: setting `upload_source_maps: true` is a one-line change that someone will be
tempted to make, because `observability.enabled` is already `true` and readable stack traces are
attractive. That single line would ship the service-role key to Cloudflare inside the source map.
The service-role key bypasses RLS entirely; whoever holds it holds every row and every photograph.

**Fix.** (a) Rotate the key in the Supabase dashboard and update it in the Cloudflare Secret and
`.env.local`. (b) Add a build-time guard that fails the build if the key's value appears in any
file destined for upload — `scripts/trim-worker.mjs` already runs at the end of every build and is
the natural home. (c) Add a comment beside `observability` warning that `upload_source_maps` must
stay off while the adapter behaves this way. *(I have not made change (b) or (c) — see section 7;
they are hardening, not a critical fix, and I did not want to change code during an audit without
your say-so.)*

---

### MEDIUM

#### M1 — Any rep can modify any institute, with no audit trail

**Verified live:** as a rep, updating another user's institute succeeded (`1 row updated`). The RLS
policy is `institutes_update ... using (true) with check (true)`.

**Why it matters.** This is deliberate — the comment calls it "a shared registry: everyone reads and
contributes" — and at 20 trusted colleagues it is a reasonable business decision. But the record
carries a status that drives reporting, and `status_updated_by` is captured while **name, boards,
contacts and address changes are not attributed to anyone**. A rep who overwrites a colleague's
institute, by accident or otherwise, leaves no trace. There is no UI for editing today, so this is
reachable only via the API — which makes it latent rather than active.

**Fix.** Either accept it explicitly and write it into the handover notes, or add `updated_by` /
`updated_at` columns with a trigger, mirroring what `status_updated_by` already does. Low effort,
and it converts an unbounded trust assumption into an auditable one.

---

#### M2 — No persistent logging or alerting

Errors go to `console.error` and land in Cloudflare Workers logs. `observability.enabled` is on, but
free-plan retention is short and there is no Logpush, no aggregation, and no alerting. If the app
starts failing at 02:00, **nobody is told, and by morning the evidence may be gone**. The
`/api/health` endpoint exists and is correct — but nothing polls it.

**Fix.** Point any free uptime monitor (UptimeRobot, Better Stack) at `/api/health` with email or
SMS alerting. Five minutes, no code. It converts "the client tells you it is down" into "you know
first", which is most of the value of monitoring at this scale.

---

#### M3 — No automated UI or end-to-end test coverage

138 tests pass, and they are good tests — but they are pure logic (dates, weeks, validation,
metrics) and database rules exercised through the API. **There is not a single component or
end-to-end test.** Every claim about the interface rests on the manual 37-scenario run.

**Why it matters.** A refactor can break a form, a gate, or a whole screen and CI will stay green —
which is exactly what happened in the previous phase, when an app-wide hydration failure went
undetected by the suite and was only caught by driving a browser by hand.

**Fix.** Not a full E2E suite — that is disproportionate here. Three or four Playwright smoke tests
over the highest-value paths (sign in → log a visit with a photo → submit the week) would have
caught the hydration bug and would catch its next cousin.

---

#### M4 — The session cookie is not `httpOnly`

Forced by `@supabase/ssr`, whose browser client reads the session from `document.cookie`; making it
script-invisible would sign users out on client navigation. The code documents this honestly.

**Residual risk:** any successful XSS yields the session token. **Mitigations in place and verified
live:** a strict CSP with a per-request nonce and `strict-dynamic` (no `unsafe-inline` for scripts),
`SameSite=Lax`, HSTS with `preload`, and `frame-ancestors 'none'`. That is a strong compensating
set — the CSP in particular makes injected script very hard to execute. Accept and document; the
alternative is fighting the auth library.

---

#### M5 — No application-level rate limiting

Two faces of the same gap. Both are now **Deferred / Planned** (decided 5 Sep 2026), for the reasons
below.

**(a) Login brute force — tracked as pen-test finding P1.** The follow-up pen test confirmed this:
30 rapid failed logins drew no `429`, so throttling rests on Supabase's own (looser) limits. The
audit's earlier line that "Supabase enforces auth rate limits" was optimistic — it does *some*, but
not within a burst.

> **STATUS: Deferred / Planned.** Closes with one free Cloudflare WAF rate-limit rule (`POST /login`,
> ~10 req/min per IP, Block/Managed Challenge) **once the app moves to a custom domain** — WAF
> rate-limiting is zone-level and cannot attach to `*.workers.dev`. See
> [HANDOVER.md](../HANDOVER.md), "Custom domain", and P1 in the pen-test report.
> **Interim risk: Medium, mitigated** by non-enumerable login errors, Supabase's built-in
> throttling, and a small admin-created user base (~20–100, no public signup).
> **Deliberately not done in-Worker** (rate-limit binding / KV / Durable Object): it would be the
> first host-specific code in the app, breaking the portability rule to close a Medium finding the
> custom domain closes for free.

**(b) Outbound-calling routes** — `/api/place`, `/api/pincode`. A signed-in user could loop
`/api/place` and get the app's IP throttled by OpenStreetMap, degrading the photo stamp for
everyone. Partly mitigated: `place_cache` means repeat coordinates never reach Nominatim, and both
routes are auth-gated (verified: `401` unauthenticated), so they are not an open proxy. At this scale
the realistic risk is an accidental loop, not an attack. **Fix if it ever bites:** a per-user counter
in Postgres. Accept and monitor for now.

---

#### M6 — No staging environment

`main` deploys straight to production via Cloudflare Workers Builds. There is no place to see a
change running against real infrastructure before users do.

**Assessed as reasonable at this scale** — a second Worker and a second Supabase project doubles the
operational surface for a 20-person app — but it should be a stated decision, not a silent one. The
compensating control is that CI runs lint, type-check, tests and a full Worker build on every push,
so a broken build cannot reach production. What CI cannot catch is a change that builds cleanly and
behaves wrongly, which is precisely M3.

---

### LOW

| # | Finding | Why it matters | Fix |
| --- | --- | --- | --- |
| L1 | `x-powered-by: Next.js` on every response | Framework and version disclosure; free reconnaissance | `poweredByHeader: false` in `next.config.ts` — one line |
| L2 | Login page has no `<h1>` | Screen-reader users get no page heading; app pages are fine (`PageHeader` renders `<h1>`) | Promote the "Sign in" `CardTitle` to `<h1>`, or add a visually-hidden one |
| L3 | `/api/health` is public and uses the service-role client | Unauthenticated traffic can drive database queries. Returns no data, single indexed count, 4s timeout — cost is trivial | Accept; optionally add a shared-secret header if the client objects |
| L4 | Orphaned photos linger up to 30 days | Upload happens at capture, so an abandoned visit leaves a file with no row. **One such file exists in production now.** The nightly purge does reclaim them (it scans `storage.objects` by age, not via visits) — but the admin "photo flush" does **not**, because it selects through `visits.photo_url` | Working as designed; worth stating so the discrepancy between the two cleanup paths is not mistaken for a bug |
| L5 | A rep can change a visit's `date` after filing | RLS allows a rep to update their own visit; only `photo_url` is frozen by trigger. Since weekly metrics are derived from `date`, a rep could shift work between weeks. No UI exists, so this is API-only | Freeze `date` after insert with a trigger, mirroring `visits_photo_final` |
| L6 | CI never runs the integration tests | `SUPABASE_SERVICE_ROLE_KEY` is deliberately absent from CI, so the 51 database-rule tests skip themselves. The RLS and trigger guarantees are therefore only verified on a developer machine | Deliberate and defensible (no production credentials in CI). Consider a free throwaway Supabase project for CI later |
| L7 | Cold-start TTFB ≈ 1.1 s | Every route is dynamic and `no-store`, correctly, since all content is user-specific. Noticeable on a phone on mobile data | Accept at this scale; the login page could be cached if it ever matters |

---

## 3. Failure scenarios

Twenty realistic failures, and what the system actually does today. Rows marked **verified** were
reproduced during this audit or the phase-9 test run.

| # | Scenario | Current behaviour | Risk | Handling |
| --- | --- | --- | --- | --- |
| 1 | Rep tries to promote themselves to admin | Refused, `42501 "Only an admin can change a role."` — trigger, not policy | None | **Handled — verified** |
| 2 | Rep requests another rep's visits, plans or weekly rows | Returns 0 rows; writes are refused or affect 0 rows | None | **Handled — verified** |
| 3 | Rep uploads into another rep's photo folder | Refused by storage RLS | None | **Handled — verified** |
| 4 | Rep logs a meeting for an institute not on today's plan | Refused by CHECK (`23514`), for the service role too | None | **Handled — verified** |
| 5 | Rep edits or unlocks a submitted week | Both refused (`23514`, `42501`) | None | **Handled — verified** |
| 6 | Rep swaps the photo on a filed visit | Refused, `FO008`, service role included | None | **Handled — verified** |
| 7 | Rep saves a visit with no photograph | Refused at three layers: zod, `log_visit()` `FO007`, and the `visits_photo_required` CHECK | None | **Handled — verified** |
| 8 | GPS denied, unavailable, or slow | Visit still saves; UI says "Finding your location took too long. You can still save the visit." | Low — a visit without coordinates | **Handled by design — verified** |
| 9 | OpenStreetMap is down, slow or rate-limiting | 3.5 s server timeout, 4 s browser abort; the stamp simply omits the place line. Failures are never cached as absences | Low — cosmetic only | **Handled — verified in code and live** |
| 10 | Photo older than 30 days is viewed | Nightly job deleted the file; the row keeps `photo_url`, coordinates and time. UI renders "Photo expired" | None — intended | **Handled — verified** |
| 11 | Two reps plan the same institute on the same day | `daily_plans_unique_per_day` rejects the duplicate | Low — a confusing error | **Partly handled** — the constraint is right; the message could be friendlier |
| 12 | Clock crosses IST midnight mid-session | `todayISO()` and `app_today()` both read the Asia/Kolkata day and are tested together | None now — this was the phase-9 outage | **Handled — verified** |
| 13 | Supabase is unreachable | `/api/health` returns 503; screens show friendly errors, never stack traces | Medium — app is unusable while it lasts | **Partly handled** — degrades cleanly, but **nobody is alerted** (M2) |
| 14 | Someone deletes production data by mistake | **No backup exists** | **Severe — total, permanent loss** | **NOT handled (H1)** |
| 15 | Service-role key leaks | Full read/write to every row and photo, bypassing RLS | Severe | **Partly handled** — not in client, git or the deployed artefact; **but rotation is outstanding (H2)** |
| 16 | Bundle grows past 3072 KiB | Build succeeds, **deploy fails** | Medium — a blocked release, discovered late | **Documented, not automated** — no CI size gate; measure before adding |
| 17 | Rep's session expires mid-form | Server action fails; friendly "session has expired" message | Low — possible loss of unsaved input | **Partly handled** — no draft preservation |
| 18 | Two admins reopen the same week at once | Last write wins; `reopened_by`/`reopened_at` record whoever was last | Very low | **Acceptable** at this scale |
| 19 | Rep uploads a huge photo on poor signal | Client resizes and stamps before upload (~14–23 KB observed); failure shows a retry message and blocks the save | Low | **Handled — verified** |
| 20 | XSS attempted via institute name or notes | React escapes by default; CSP has no `unsafe-inline` for scripts and uses a per-request nonce with `strict-dynamic` | Low | **Handled** — no `dangerouslySetInnerHTML` anywhere in the codebase |

---

## 4. Security review

### Probes run against production

Executed as a genuine signed-in rep against the live project, then torn down. **20 of 20 behaved
correctly.**

| Attack | Result |
| --- | --- |
| Set own `role` to `admin` (update) | Refused `42501` |
| Set own `role` to `admin` (upsert) | Refused `42501` |
| Read another member's visits | 0 rows |
| Read another member's weekly targets | 0 rows |
| Read another member's daily plans | 0 rows |
| Enumerate all profiles | Own row only |
| Insert a visit attributed to another member | Refused `42501` |
| Update another member's visit | 0 rows affected |
| Delete another member's visit | 0 rows affected |
| Unlock own submitted week | Refused `42501` |
| Edit targets on a locked week | Refused `23514` |
| Log a meeting with no plan row | Refused `23514` |
| Save a visit with no photo | Refused `23514` |
| Rewrite `photo_url` after filing | Refused `FO008` |
| List another member's storage folder | 0 objects |
| Upload into another member's folder | Refused by storage RLS |
| Delete an institute as a rep | 0 rows affected |
| Write admin-managed purposes as a rep | Refused `42501` |
| Read reference data as a rep | Allowed — by design |
| Edit another rep's institute | **Allowed — by design (M1)** |

### By category

**Authentication.** Sound. `getUser()` is used throughout — never `getSession()` — so the token is
verified with Supabase rather than trusted from a cookie. Least privilege is the default: an
unreadable profile is treated as `rep`, never `admin`, and admin surfaces additionally require
`profileStatus === "ready"`. Sign-in failures are deliberately indistinguishable, so the form is not
an account-enumeration oracle. Supabase's own rate limiting covers brute force, and `429` is handled.

**Authorisation / IDOR.** Genuinely mitigated, and mitigated in the right place. Three layers: the
proxy redirects (a real 307, not a 200 with a client-side bounce), each page re-checks server-side,
and RLS enforces it in Postgres underneath both. The middleware comment is explicit that it is an
optimistic gate and not the boundary — that framing is correct and it is why the layering works.

**Injection.** No raw SQL anywhere; everything goes through PostgREST or parameterised functions.
The one string-built URL (`/api/place` → Nominatim) uses a fixed host with `encodeURIComponent` over
values already validated as finite numbers in range — no SSRF path.

**XSS.** No `dangerouslySetInnerHTML` in the codebase. React escapes output. CSP uses a per-request
nonce with `strict-dynamic` and no `unsafe-inline` for scripts. `style-src 'unsafe-inline'` is
required by Radix and is a much weaker vector.

**Secrets.** `env.ts` is the only reader of `process.env`, validates on first read, and names
offending variables **without their values**. `serverEnv()` throws if reached from the browser.
Verified: the service-role value is not in the client bundle, not in git history, and not in the
deployed Worker. Residual: H2.

**Session.** `SameSite=Lax`, `secure` in production, HSTS `max-age=63072000; includeSubDomains;
preload`. `httpOnly` is absent by library constraint — M4.

**Headers (live).** `Content-Security-Policy` (nonce + `strict-dynamic`), `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(self), camera=(self),
microphone=(), payment=()`. Only gap: `x-powered-by` (L1).

**Residual risks, stated plainly:** (1) service-role key pending rotation — H2; (2) session cookie
readable by script if XSS ever succeeds — M4; (3) any rep can edit any institute unattributed — M1;
(4) login brute-force throttling deferred to the custom-domain WAF rule, and no rate limiting on the
two outbound-calling routes — M5 / P1.

---

## 5. Production-readiness score

| Category | Weight | Score | Weighted | Notes |
| --- | ---: | ---: | ---: | --- |
| Security | 15 | 8.5/10 | 12.75 | 20/20 probes; strong headers; −key rotation, −no `httpOnly` |
| Database integrity | 10 | 10/10 | 10.00 | Rules in Postgres; transactional RPC; service role refused too |
| Functional correctness | 10 | 9.5/10 | 9.50 | 37/37 scenarios, 138 tests |
| Backups / DR | 8 | 3/10 | 2.40 | Excellent runbook, **never executed** |
| Testing | 8 | 7/10 | 5.60 | Strong logic + DB coverage; no UI/E2E |
| Error handling | 6 | 9/10 | 5.40 | No leaks; friendly, actionable messages |
| Input validation | 6 | 9/10 | 5.40 | zod client + server, plus DB CHECKs |
| Deployment | 6 | 7.5/10 | 4.50 | Auto-deploy, pinned compat date; no staging; 4% size headroom |
| Monitoring / logging | 6 | 5/10 | 3.00 | Health endpoint exists; nothing polls it, logs ephemeral |
| Performance | 5 | 8/10 | 4.00 | No N+1 (bulk + `Promise.all`); ~1.1 s cold TTFB |
| Reliability | 5 | 7/10 | 3.50 | Graceful degradation throughout; no alerting |
| Frontend / UX | 5 | 8.5/10 | 4.25 | Loading, empty and error states on every screen |
| Documentation | 4 | 10/10 | 4.00 | Best-in-class for this size |
| Accessibility | 3 | 7/10 | 2.10 | Good basics; no formal audit; login `<h1>` |
| Code quality / Git | 3 | 9/10 | 2.70 | Clean history, no secrets, comments explain *why* |
| **Total** | **100** | | **79.10** | |

### Verdict: **APPROVED AFTER FIXES — 79/100**

**Why not APPROVED.** One reason only: **there is no backup of production data.** Everything else
found is Medium or below and could reasonably ship. But handing a client a system holding their
entire commercial record with no recovery path is not something I would sign. It is ten minutes of
work, not a rebuild.

**Why not NOT APPROVED.** The software itself is sound. The security model was tested rather than
assumed and held on all twenty probes; the business rules are enforced where they cannot be bypassed;
error handling is careful; the documentation is genuinely better than most commercial handovers. The
gaps are operational and small.

**What the score means.** 79 is a good score for a free-tier deployment at this scale. It is held
down mostly by three things — no backups (−5.6 against weight), thin monitoring (−3.0), and no UI
tests (−2.4) — which together account for most of the distance to 90. Fix the first, spend five
minutes on the second, and this is comfortably a mid-80s system.

---

## 6. Known limitations and deliberate scale decisions

These are **conscious trade-offs**, correctly made for ~20 reps on free-tier hosting. They are
recorded so the client inherits the reasoning, not just the consequence.

1. **The 3072 KiB deploy ceiling, and the $5/month trigger.** The Worker is **2949.31 KiB gzipped
   against a 3072 KiB hard limit — 122.69 KiB, under 5%, of headroom.** Over the line the build
   still passes and the **deploy** fails. `minify` and `scripts/trim-worker.mjs` already claimed the
   easy 0.9 MiB between them. **The answer is the Workers Paid plan ($5/month, 10 MiB) — a plan
   change and nothing else.** Measure before adding anything sizable:
   `npm run build && npx wrangler deploy --dry-run --outdir /tmp/out`.
2. **No staging environment.** A second Worker plus a second Supabase project doubles operational
   surface for a 20-person app. CI (lint, type-check, tests, full Worker build on every push) is the
   compensating control.
3. **The in-app camera needs a real device.** Confirmed on real phone hardware; it cannot be covered
   by automation, because a synthetic `MediaStream` proves nothing about rear-camera selection or
   the OS permission prompt. Re-test by hand after any change to the capture path.
4. **Photos expire after 30 days.** Deliberate: photos are proof of attendance, not archive. Visit
   rows, coordinates and timestamps are kept forever. ~100 KB × 20 reps × 5 visits/day is ~300 MB a
   month against a 1 GB tier — the retention window is what keeps the app inside free storage.
5. **The institute registry is shared and openly editable.** Everyone contributes, only admins
   delete (M1). Right for a small team that trusts each other; revisit if the team grows or is
   outsourced.
6. **Integration tests never run in CI.** No production credentials in CI is the correct call; the
   cost is that DB rules are verified only on a developer machine (L6).
7. **The session cookie cannot be `httpOnly`.** A constraint of `@supabase/ssr`, compensated with a
   strict CSP (M4).
8. **Dark mode is out of scope for v1.** `@custom-variant dark` exists but no `.dark` palette, so
   `dark:` utilities never fire. Adding a `.dark { … }` block in `globals.css` is the extension
   point.
9. **Backups are unencrypted and contain personal data** — names, mobile numbers, GPS coordinates,
   photographs of school premises. The runbook says so. Wherever they are stored needs to be
   defensible in a data-protection conversation.
10. **The app is deliberately portable.** No host-specific API in application code; every
    environment variable is read in `src/lib/env.ts` and nowhere else; the Supabase origin is
    derived from configuration, including in the CSP. Moving to a client's self-hosted Supabase or
    plain Postgres is a variable change and a rebuild, not a rewrite.

---

## 7. Prioritised remaining work

### Before handover — ~1 hour, no code changes

| # | Task | Effort | Why |
| --- | --- | --- | --- |
| 1 | ~~Run `npm run backup`~~ **done and verified 5 Sep**. Remaining: put the **weekly schedule on a machine the client controls**, store backups **off** that machine, and do the **restore rehearsal** once — all three in `docs/BACKUP-RESTORE.md`, "For the client" | 30 min | H1 — the only finding blocking approval |
| 2 | **Rotate `SUPABASE_SERVICE_ROLE_KEY`**; update the Cloudflare Secret and `.env.local` | 15 min | H2 — it has been in a build log |
| 3 | **Point a free uptime monitor at `/api/health`** with alerting | 5 min | M2 — turns "the client tells you" into "you know first" |
| 4 | Confirm with the client **who holds the Cloudflare and Supabase accounts**, and that recovery contacts are theirs | 15 min | A handover is not complete while access belongs to the developer |
| 5 | Tell the client, in writing, about the **123 KiB size headroom and the $5/month upgrade trigger** | 5 min | Avoids a failed deploy being discovered as a surprise |

### Recommended soon after — small, high value

| # | Task | Effort | Why |
| --- | --- | --- | --- |
| 6 | Build-time guard: fail if the service-role value appears in an uploadable file; comment `upload_source_maps` as must-stay-off | 30 min | Closes H2's latent footgun permanently |
| 7 | `poweredByHeader: false` | 1 min | L1 |
| 8 | 3–4 Playwright smoke tests over sign-in → log a visit → submit the week | half day | M3 — would have caught the phase-9 hydration outage |
| 9 | CI size gate failing above ~2950 KiB | 30 min | Turns scenario 16 from a failed deploy into a failed build |
| 10 | `<h1>` on the login page | 5 min | L2 |
| 11 | After the custom-domain move, add the free WAF rate-limit rule on `POST /login` | 10 min | Closes P1 / M5(a); prerequisite and steps in [HANDOVER.md](../HANDOVER.md) |

### Nice to have later

11. `updated_by` / `updated_at` on institutes (M1).
12. Freeze `visits.date` after insert (L5).
13. Per-user rate limiting on `/api/place` and `/api/pincode` (M5).
14. A throwaway Supabase project so CI can run the integration tests (L6).
15. A formal accessibility audit with a screen reader on a real device.
16. Draft preservation on session expiry mid-form (scenario 17).
17. Dark mode, if the client asks.

---

## Appendix — verification evidence

| Check | Result |
| --- | --- |
| Lint | Clean |
| Type-check | Clean |
| Tests | **138/138 passing** (7 files) |
| Worker size | **2949.31 KiB gzipped** / 3072 KiB limit — 122.69 KiB headroom |
| Live health | `200 {"status":"ok","checks":{"database":"ok"}}` |
| Security probes | **20/20 correct** against production |
| Secrets in git history | **None** — 0 JWT-shaped strings across all branches |
| Service-role key in client bundle | **Absent** (field name only) |
| Service-role key in deployed artefact | **Absent** — upload size equals `worker.js` exactly |
| Test data left behind | **None** — database returned to baseline and verified row by row |

*Audit performed against commit `b45cfc2` and the live deployment on 5 September 2026. No
application code was changed during this audit.*
