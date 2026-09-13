# KUbeats

**For a smarter KU.** Mobile-first field reporting for an education sales team. Reps log activity
against registered institutes — meetings, sessions, campus visits, olympiad
registrations, application forms, admissions — and commit to weekly targets.
Admins oversee the team, manage the shared lists, and create accounts.

Roughly twenty users. Built to be read and maintained by one developer.

> **Handing this over?** [HANDOVER.md](HANDOVER.md) lists what is the client's to decide or run —
> custom domain, key rotation, backups, monitoring — each pointing to the document with the detail.

## Screens

Six, and no more. The navigation is a thumb-reachable bottom bar.

| Screen | Who | What it does |
| --- | --- | --- |
| Dashboard | everyone | Today's plan (create and track), plus this week's numbers. Admins see the team instead. |
| Institutes | everyone | The shared registry: register, search, open one. |
| Log Visit | everyone | Record a visit with location and an optional photo. |
| Pending | everyone | Sessions and campus visits set but not yet closed. |
| Targets | reps | The eight weekly targets, and progress against them. An admin reaches a rep's from Team. |
| Settings | admins | Team accounts, meeting purposes, the location tree, photo cleanup. |

## Stack

- **Next.js 16** (App Router, TypeScript). Note: middleware is now `proxy.ts`,
  and `cookies()` is async-only.
- **React 19** server components and server actions. No client-side data layer.
- **Supabase** — Postgres, Auth, Storage. Row Level Security is on everywhere.
- **Tailwind v4** + **shadcn/ui** (Radix under the hood).
- **Zod 4** for validation, shared by the browser and the server.
- **Vitest** for tests.

### Where the rules live

The business rules that matter are enforced in **Postgres**, not in the UI —
triggers, CHECK constraints and RLS policies. The TypeScript above them exists
to give a person a sentence instead of a constraint name. If you change one,
change it in the database first.

- **The meeting gate** — a meeting can only be logged for an institute on that
  member's plan for that day (`visits_enforce_meeting_gate`).
- **The weekly lock** — a submitted week cannot be edited, and only an admin can
  reopen it; the trigger stamps who and when (`targets_enforce_lock`). The
  trigger covers daily, weekly and monthly rows alike; the app commits to weeks
  and nothing else, so only the weekly ones are ever written now.
- **Role visibility** — a rep sees only their own work, an admin sees the team.
- **Rule 7 sourcing** — the weekly *Meetings* figure comes from `daily_plans`
  entries marked held; the other seven come from the `visits` log.

`tests/integration` covers exactly these.

## Prerequisites

- **Node 24** (the CI pins it; Node 22 also works).
- A **Supabase project**. The free tier is enough — see *Storage* below.
- npm.

## Setup

```bash
git clone <this repo>
cd field-ops
npm install
cp .env.example .env.local     # then fill it in
```

### Environment

Three variables, all from **Supabase → Project Settings → API**. The app
validates them on first use and fails with a message naming any that are missing
— never their values.

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | e.g. `https://abcdefghijklm.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key | Safe in the browser; RLS still applies to everything it does. |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key | **Server-only. Bypasses RLS.** Never prefix it `NEXT_PUBLIC_`, never import it into a client component. |

`.env.local` is git-ignored. `src/lib/supabase/admin.ts` imports `server-only`,
so importing the service-role client from client code is a build error rather
than a leak.

### Database

Run the migrations in order in the **Supabase SQL Editor** (Dashboard → SQL
Editor → New query → paste the whole file → Run). They are idempotent.

| File | What it does | Required |
| --- | --- | --- |
| `supabase/migrations/0001_init.sql` | Tables, constraints, indexes, RLS, triggers, the private `visit-photos` bucket, and seed data (36 states, 85 cities, 5 purposes). | Yes |
| `0002_log_visit_rpc.sql` | `log_visit()` — saves a visit and its two side effects in one transaction. | Yes |
| `0003_photo_retention.sql` | The 30-day photo retention window, its audit table and the purge function. | Yes |
| `0004_photo_retention_schedule.sql` | Enables pg_cron and pg_net, stores credentials in Vault, schedules the nightly purge. | Optional — without it photos are never deleted automatically |
| `0005_closing_report_and_assignment.sql` | The closing report's columns, `visit_people`, and admin-assigned plan entries. | Yes |
| `0006_photo_required.sql` | Rule 12 — makes the visit photo mandatory and final: `log_visit()` raises `FO007`, the `visits_photo_required` CHECK refuses a direct insert, and the `visits_photo_final` trigger raises `FO008` on any later change to `photo_url`. | Yes |
| `0007_place_cache.sql` | Caches reverse-geocoded area names for the photo stamp, so the geocoder is asked once per neighbourhood. Shared by both providers. | Optional — without it the stamp still works, it just re-asks every time |
| `0008_ist_calendar_day.sql` | Adds `public.app_today()` and makes "today" the Asia/Kolkata calendar day everywhere the database decides one — the `visits.date` and `daily_plans.date` defaults, and `log_visit()`. | Yes — without it the database and the app disagree about the day between 00:00 and 05:30 IST, and the meeting gate rejects meetings that were properly planned |

> **0004 has two placeholders you must fill in — in the SQL editor only.**
> Lines 51 and 52 take your project URL and your service_role key. Paste them
> into the Supabase SQL editor, run it there, and **do not save the edited file
> back into the repo**. The committed copy keeps its placeholders. Do not use
> find-and-replace on the file: the words `project_url` and `service_role_key`
> also appear as the names the Vault secrets are stored under.
>
> Verify with the queries at the bottom of that file. `select * from cron.job;`
> should show one active `purge-visit-photos` job, and
> `select * from public.purge_old_visit_photos();` should return
> `considered = 0` on a fresh project — which is the correct answer.

If a storage policy in 0001 is rejected because your project owns
`storage.objects` under `supabase_storage_admin`, create the `visit-photos`
bucket (private) from the dashboard and add the four policies through the
Storage → Policies UI instead. Everything else in 0001 will have applied.

### The first admin

There is no self-signup: accounts are created by admins, and the first one has
to be made by hand.

1. **Supabase → Authentication → Users → Add user.** Give it an email and
   password, and tick **Auto Confirm User** — an unconfirmed account fails
   sign-in with the same "Invalid email or password" as a wrong password.
2. Copy the new user's UUID.
3. **SQL Editor:**

   ```sql
   insert into public.profiles (id, name, role)
   values ('<paste the uuid>', 'Your Name', 'admin');
   ```

   The role guard allows this because the SQL editor has no `auth.uid()`. Once
   an admin exists, every other account is created in-app from **Settings →
   Team**, which also confirms the email automatically.

## Running it

```bash
npm run dev        # http://localhost:3000
npm run build:next # plain Next production build
npm start          # serve the build
npm run check      # lint + type-check + build:next, the whole gate
npm test           # unit tests, plus integration tests if .env.local is set
npm run build      # Next build + Cloudflare Worker bundle (what the host runs)
```

`build` and `build:next` differ only in what comes out. `build:next` is the
ordinary Next build and is what the local gate and any Node host use. `build`
runs the OpenNext adapter, which runs `build:next` for you in standalone mode
and then bundles the result into `.open-next/worker.js`. Use it when you want
the artefact Cloudflare deploys; use `check` for a fast local pass.

`GET /api/health` returns `{"status":"ok","checks":{"database":"ok"}}` with a
200, or 503 if the database is unreachable. It needs no session, returns no
data, and is what a monitor should poll.

See `tests/README.md` for what the two test suites cover and why the
integration ones skip themselves without credentials.

## How it is put together

```
src/
  app/(app)/        the six screens, all server components
  app/api/          pincode lookup, health check
  components/       ui/ is shadcn; the rest is grouped by screen
  lib/
    supabase/       three clients: browser, server (RLS), admin (service role)
    validation/     Zod schemas, shared by the browser and the server actions
    *-actions.ts    server actions, one module per area
  proxy.ts          session refresh, auth redirects, admin gate, CSP
supabase/migrations/
tests/
```

Server actions all follow the same shape: check the session, parse with the
shared schema, do the work, map a known error code to a sentence, and never let
a database message reach the browser.

### Dates

Everything shown to a person is formatted by `src/lib/dates.ts`, which fixes
both the timezone (Asia/Kolkata) and the wording. Nothing else in `src/` may
format a date. This is not house style: the server runs in UTC and a rep's
phone runs in UTC+5:30, so a date left to the runtime disagrees with itself
after local midnight, React refuses to hydrate the page, and the app is dead
from 00:00 to 05:30 IST every night. That happened. `tests/unit/dates.test.ts`
reloads the module under five timezones and fails if either half comes loose.

### Today

"Today" is decided twice, once in each language, and the two answers have to
match:

| | |
| --- | --- |
| the app | `todayISO()` in `src/lib/dates.ts` |
| the database | `public.app_today()` (migration 0008) |

Both read the **Asia/Kolkata calendar day**, so the day turns over at midnight
in India. It used to turn over at 05:30, because both sides read the server's
own calendar and the server runs in UTC — a rep logging a visit at 01:00 filed
it against yesterday, and an admin assigning one at that hour was offered
yesterday by default.

They meet in the meeting gate. The app writes `daily_plans.date` with its
answer; `log_visit()` dates the visit and looks that plan row up with the
other. **If the two ever disagree the app does not merely show a wrong date —
a rep standing in front of a school is told it is not on today's plan.** That
is what makes this a pair rather than two settings, and why moving a client to
another country means editing `APP_TIME_ZONE` and re-running an edited 0008
together. The `app_today` suite in `tests/integration/rules.test.ts` fails
loudly if only one of them moves; it also skips loudly if 0008 has not been
applied, because a green run would otherwise mean nothing was checking.

Instants are a separate matter and were left alone. `created_at`,
`submitted_at`, `closed_at` and the rest are moments, not calendar days, and
`now()` is the right answer for all of them.

## Deployment

Any host that runs a Node server works. Cloudflare Workers is what this repo is
configured for; nothing in `src/` knows that.

1. Push to GitHub. The CI workflow runs lint, type-check, tests and build on
   every push.
2. Create the project on your host and point it at the repo.
3. Set the three environment variables. Mark `SUPABASE_SERVICE_ROLE_KEY` as a
   server-side secret — it must not be exposed to the browser.
4. Deploy, then check `/api/health` and sign in.
5. In Supabase → Authentication → URL Configuration, set the Site URL to your
   deployed origin.

### Cloudflare Workers

No dashboard build command is needed — the default `npm run build` is the
adapter build, and `wrangler.jsonc` tells Wrangler where the output is. Leave
the build command field empty and set the deploy command to `npx wrangler
deploy` (its default).

Locally:

```bash
npm run cf:preview   # build, then serve the Worker on workerd
npm run cf:deploy    # build, then wrangler deploy
```

Two files hold everything platform-specific: `wrangler.jsonc` (Worker name,
compatibility flags, the assets binding) and `open-next.config.ts`. Moving to a
Node host means deleting them and running `build:next` instead.

#### Where each variable goes — the two places are not interchangeable

Cloudflare has **build** variables (Workers Builds settings, present while the
code is compiled) and **runtime** bindings (the Worker's own Variables and
Secrets). This app needs one of each, and putting either in the wrong place
produces a Worker that deploys cleanly and then 500s on every request.

| Variable | Where | Why |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Build** variable | Baked into the browser bundle at compile time |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Build** variable | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** (runtime) | Never inlined; read per request |
| `MAPPLS_CLIENT_ID` / `MAPPLS_CLIENT_SECRET`, or `MAPPLS_REST_KEY` | **Secret** (runtime), optional | Better Indian area names on the photo stamp. Unset means free OpenStreetMap, which is the supported default. `docs/MAPMYINDIA-SETUP.md` |

**The `NEXT_PUBLIC_*` pair must exist at build time, and changing them requires
a rebuild — not a restart.** They are public by design (the anon key is
protected by RLS) and they will appear in the build log, which is fine. What is
not fine is setting them only as runtime Variables: the browser bundle is
compiled without them, so `createBrowserClient()` receives `undefined` and
sign-in breaks even though pages render.

Verified against the built output rather than assumed. Built *with* them, the
value appears as a literal in both the browser chunks and `publicEnv()` in the
server bundle. Built *without* them, the browser chunks contain neither the
value nor a `process.env` read — it is simply gone — while the server bundle
keeps `process.env.NEXT_PUBLIC_SUPABASE_URL` as a runtime read. So a
runtime-only setup half-works, which is worse than failing outright.

`SUPABASE_SERVICE_ROLE_KEY` goes the other way: runtime-only is correct.
Nothing is prerendered, so the build never reads it — CI proves it by building
with the variable deliberately unset. At runtime the adapter copies the Worker's
bindings into `process.env`, so `serverEnv()` finds it. `/api/health` uses the
service-role client, so a green health check *is* the proof the Secret is wired
up.

**Secrets survive a deploy; plaintext `vars` are reconciled against the config
file.** `wrangler.jsonc` declares no `vars` — deliberately, since it is
committed — so do not rely on plaintext Variables added by hand in the Worker's
settings surviving the next deployment. Build variables are a separate setting
and are not affected.

**If every route returns "Internal error", including `/api/health`,** this is
almost always the cause. The Worker log shows it exactly:

```
Error in routingHandler [EnvError]: Missing public environment variables:
  - NEXT_PUBLIC_SUPABASE_URL is not set
  - NEXT_PUBLIC_SUPABASE_ANON_KEY is not set
```

It is thrown from the middleware, which builds the CSP from `publicEnv()`
before any route runs — hence *every* path failing, health check included. Read
the live log with `npx wrangler tail kubeats --format pretty` (after
`npx wrangler login`).

#### Never deploy a locally-built artifact

The adapter embeds the contents of `.env*` into the Worker bundle so the values
survive into the runtime. A `npm run build` on a developer machine therefore
bakes the **real service-role key** from `.env.local` into
`.open-next/worker.js` in plaintext. `.open-next/` is git-ignored so it cannot
be committed, but do not upload, share or hand over that directory. Cloudflare's
builder has no `.env.local`, so what it produces is clean.

#### Plan: Cloudflare free, on purpose

We are on the free plan knowingly, not by oversight. The Worker deploys at
2.75 MiB against the 3 MiB ceiling — about 8% of headroom (see below).

**If it bites, upgrade to Workers Paid ($5/mo) and the ceiling becomes 10 MiB.**
That is the intended fix, and it is instant: no code change, no redeploy needed
beyond the next one. Do not spend an afternoon shaving bytes first.

#### Security note, 2026-09-04

`SUPABASE_SERVICE_ROLE_KEY` was set as a plaintext Variable for the first
Cloudflare deploy, and Workers Builds printed its value into that build log.

It was **not rolled**, deliberately. The exposure was to a private build log in
the project owner's own Cloudflare account; the key has never been in git
(verified against every object in the repository's history, not just the working
tree) and the GitHub repo is private. The cause was fixed instead: the Variable
was deleted and the key re-added as an encrypted Secret.

Recorded here so the decision is not mistaken later for something nobody
noticed. If Cloudflare account access ever widens beyond the people who should
hold that key, roll it — Supabase → Project Settings → API → service_role →
regenerate, then update the Cloudflare Secret and `.env.local`.

#### The 3 MiB ceiling

A Worker must be under **3 MiB compressed** on the free plan (10 MiB on Paid).
An untouched build of this app is 3.67 MiB, so two things in the deploy path
exist purely to fit:

- `"minify": true` in `wrangler.jsonc`. The adapter does not minify its own
  output — it string-patches it afterwards — and Wrangler does not minify by
  default, so nothing else would. Worth 0.39 MiB.
- `scripts/trim-worker.mjs`, run at the end of `npm run build`. It drops
  @vercel/og's `resvg.wasm` and `yoga.wasm` from the middleware bundle, which
  the adapter pulls in unconditionally for an image renderer this app never
  calls. Worth 0.53 MiB. The script explains itself, and stops the build rather
  than silently doing nothing if the adapter changes.

Those two together were the cheap wins, and they are spent. Neither is worth
extending.

**Where it stands: 2949 KiB against a 3072 KiB ceiling — 123 KiB, about 4.0%.**

Read that as a budget, not a comfort. It was 2831 KiB before the in-app camera
and the area-name lookup; two ordinary features spent nearly two thirds of the
room that existed then. The redesign gave some back and then spent more: stage 1
freed 7 KiB and stage 2 another 7, and stage 3 cost 47 — the forced check-in
chain adds two client components and a server-action module, and deleting the
1076-line closing report did not cover it. Treat the number as a release gate:

| Measured | Do |
| --- | --- |
| under ~2900 KiB | carry on |
| 2900–3072 KiB | you are in the last 5%; size every new dependency before adding it |
| over 3072 KiB | **do not push** — the build passes and the *deploy* fails |

**The intended fix for an overrun is the Workers Paid plan ($5/mo, 10 MiB
ceiling), not more trimming.** Staying on free is a deliberate choice and a
cheap one to reverse: it is a plan change, no code and no redeploy beyond the
next one. Any sizable new feature — a rich text editor, a charting library, a
PDF generator, anything pulling a large dependency into a server component —
should be assumed to need it. Check first, upgrade, then build; discovering it
from a failed deploy is the expensive way round.

Check before deploying:

```bash
npm run build && npx wrangler deploy --dry-run --outdir /tmp/out
```

The `Total Upload:` line reports the compressed size.

### Deploying somewhere that isn't Cloudflare

Set the host's build command to `npm run build:next` and its start command to
`npm start`. `build` would still succeed, but it produces a Worker bundle the
host has no use for.

The build output is entirely dynamic (`ƒ`): every route reads the session,
so nothing is prerendered and no page is cached across users.

**Serve it over HTTPS.** The session cookie is marked `Secure` in production,
and `Strict-Transport-Security` is sent on every response.

### Storage capacity

Photos are shrunk and stamped in the browser before upload — about 100 KB each.
Twenty reps at five visits a day is roughly **300 MB a month** against
Supabase's 1 GB free tier, so the nightly purge (0004) is doing real work.
Admins can also clear photos early from **Settings → Visit photos**.

A visit keeps its `photo_url` after the file is deleted. That is intended: the
row is the record, the picture was only the evidence.

Photos are shown on an institute's visit history, as a thumbnail that opens
larger on tap. The bucket is private, so each one is signed server-side for five
minutes on the caller's own session — a rep's own photos, an admin's anyone's.
A path whose file has gone renders a small "Photo expired" placeholder, never a
broken image or an error, and anything else that displays a photo must do the
same.

## Backups and moving hosts

```bash
npm run backup                 # → ./backups/<timestamp>/  (rows, users, photos)
npm run backup -- --no-photos  # faster, rows and users only
npm run backup:verify -- backups/<timestamp>   # is that backup any good?
```

`backup:verify` reads a backup on its own terms — no network, no keys, no
Supabase account — so it still works on a copy pulled off an external drive
years later, which is the only moment anyone actually asks the question.

Four things hold state and they move differently: table rows, auth users (not
just rows — and password hashes need a SQL-level dump), the photo files in the
private bucket, and the Vault secret plus cron job from migration `0004`, which
cannot be exported at all and must be re-created by re-running that migration.

**[docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md)** is the runbook: scheduling a
routine backup, the `pg_dump` commands for a real move, the restore order and
what breaks when a step is skipped, pointing the app at a new project, and what
running on plain Postgres would and would not give you. It also states plainly
which steps have been executed and which you would be the first to run.

`backups/` is git-ignored and contains personal data — names, mobile numbers,
GPS coordinates and photographs of school premises. Keep a copy somewhere other
than the machine running the app, and somewhere you would be willing to defend.
The runbook's **"For the client"** section names who owns the weekly backup, the
quarterly check and the yearly restore rehearsal; unassigned, none of them
happen.

## Troubleshooting

**"Missing public environment variables" on startup.** `.env.local` is absent or
a value is blank. Copy `.env.example` and fill in all three, then restart — Next
only reads env files at boot.

**Sign-in always says "Invalid email or password".** The account is probably
unconfirmed. Supabase → Authentication → Users → the user → confirm it.
Accounts made through Settings → Team are confirmed automatically.

**A rep sees "Nothing to manage yet" or gets bounced from /settings.** Working
as intended — `/settings` is admin-only, enforced in `proxy.ts`, in the page,
and by RLS.

**"A meeting can only be logged for an institute on that day's plan."** The
meeting gate. Add the institute to today's plan on the Dashboard first. This is
a database trigger; no amount of UI work will get round it.

**A week cannot be edited.** It has been submitted. An admin reopens it from the
Dashboard → the rep → *Reopen this week*.

**PIN lookup returns nothing.** It fails soft on purpose: India Post is
sometimes slow or down, so the form falls back to the manual State → City → Area
picker. Nothing is blocked.

**Photos are not being deleted.** Migration 0004 was not run, or its Vault
secrets are missing. Run `select * from public.purge_old_visit_photos();` — a
`FO101` error means Vault has no `project_url` / `service_role_key`.

**`LayoutProps` / `PageProps` not found during type-check.** Run
`npm run typecheck`, which runs `next typegen` first; `tsc` alone cannot see
generated route types.

## Licence

Private. All rights reserved.
