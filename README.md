# KUbeats

**For a smarter KU.** Mobile-first field reporting for an education sales team. Reps log activity
against registered institutes — meetings, sessions, campus visits, olympiad
registrations, application forms, admissions — and commit to weekly targets.
Admins oversee the team, manage the shared lists, and create accounts.

Roughly twenty users. Built to be read and maintained by one developer.

## Screens

Six, and no more. The navigation is a thumb-reachable bottom bar.

| Screen | Who | What it does |
| --- | --- | --- |
| Dashboard | everyone | Today's plan (create and track), plus this week's numbers. Admins see the team instead. |
| Institutes | everyone | The shared registry: register, search, open one. |
| Log Visit | everyone | Record a visit with location and an optional photo. |
| Pending | everyone | Sessions and campus visits set but not yet closed. |
| Weekly | everyone | The eight weekly targets, and progress against them. |
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
  reopen it; the trigger stamps who and when (`weekly_targets_enforce_lock`).
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

**Set the variables in the dashboard, and make `SUPABASE_SERVICE_ROLE_KEY` a
Secret rather than a plaintext Variable.** Workers Builds prints plaintext
variables into the build log. Nothing secret belongs in `wrangler.jsonc`, which
is committed.

The two `NEXT_PUBLIC_*` values stay plain Variables, and *will* appear in the
build log. That is correct and harmless: they are inlined into the browser
bundle anyway, the anon key is protected by RLS, and a Secret would not be
available to the build.

A Secret is runtime-only, which this app is fine with. Nothing is prerendered,
so the build never reads the service-role key — CI proves it by building with
the variable deliberately unset. At runtime the adapter copies the Worker's
bindings into `process.env`, so `serverEnv()` finds it. `/api/health` uses the
service-role client, so a green health check *is* the proof the Secret is wired
up.

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

That lands at **2.75 MiB, about 8% under the limit**. It is not much headroom:
a large new dependency reachable from a server component could put it back over,
and the fix at that point is the Workers Paid plan, not more trimming. Neither
of the two measures above is worth extending — they were the cheap wins, and
they are spent.

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
```

Four things hold state and they move differently: table rows, auth users (not
just rows — and password hashes need a SQL-level dump), the photo files in the
private bucket, and the Vault secret plus cron job from migration `0004`, which
cannot be exported at all and must be re-created by re-running that migration.

**[docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md)** is the runbook: scheduling a
routine backup, the `pg_dump` commands for a real move, the restore order and
what breaks when a step is skipped, pointing the app at a new project, and what
running on plain Postgres would and would not give you. It also states plainly
which steps have been executed and which you would be the first to run.

`backups/` is git-ignored and contains personal data. Store it accordingly.

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
