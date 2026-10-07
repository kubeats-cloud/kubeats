# Web push — the "shows from outside if pinned" layer

**Status: PLANNED, NOT BUILT.** Nothing in `src/` implements any of this. The
in-app notification bell (built) is the first pass; this is the second, over the
same data and adding no new source of truth.

## What this is, and what it is not

The bell answers "what is due for me" when a page is rendered. It cannot speak
when the app is closed. This layer is a **sender** over the conditions the bell
already derives — a notification that reaches an installed (pinned / added to
home screen) KUbeats on a phone whose browser is not open.

It is deliberately **not** a second evaluation of those conditions. Migration
0040's header already states the shape: *"a channel would be a SENDER over these
same rows, which is why the rows come first."* The same sentence governs here.

## Why the existing pieces already decide most of this

| Piece | Already exists | What it gives this layer |
| --- | --- | --- |
| `materialise_daily_alerts()` (0040) | yes | the exact predicates, evaluated server-side at fixed IST times |
| `alert_events` rows | yes | one row per member per kind per day, **idempotent** via `alert_events_unique_per_day` |
| pg_cron jobs (0040) | yes | the 09:00 / 10:00 / 16:00 / 19:00 IST schedule |
| `seen_at` + `alert-actions.ts` | yes | a dismissal already exists and already means something |
| `describeAlert()` | yes | the wording, already shared by the banner and the bell |

**The send should key off `alert_events`, not off the bell's live derivation.**
That is the opposite choice from the bell's, and it is right for the opposite
reason: a push must be sent **once**, at a known moment, and must not be re-sent
on every page render. `alert_events` is already exactly-once per member per kind
per day, which is the property a sender needs and the bell did not want.

## What has to be built

### 1. A push-subscription table (new migration)

```
public.push_subscriptions
  id           uuid pk
  member       uuid not null references profiles(id) on delete cascade
  endpoint     text not null unique     -- the push service URL
  p256dh       text not null            -- client public key
  auth         text not null            -- client auth secret
  user_agent   text                     -- to tell a rep's two devices apart
  created_at   timestamptz not null default now()
  last_sent_at timestamptz
  failed_at    timestamptz              -- set on 404/410, see pruning below
```

- RLS: `member = auth.uid()` for insert/delete/select. **Not** `supervises()` —
  a team lead has no business reading their reps' device endpoints, and an
  endpoint plus its keys is enough to send to that device.
- `endpoint` unique: re-subscribing the same device must update, not duplicate.
- A rep may have several rows (phone + desktop). The send fans out per row.

### 2. VAPID keys

- One key pair for the application. Public key reaches the browser, private key
  never does.
- **Goes in `src/lib/env.ts` and nowhere else** — CLAUDE.md's rule. The public
  half is `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (inlined at build time, so rotating it
  needs a rebuild — a deployment fact, worth writing down in `.env.example`).
- The private half must **not** be a `NEXT_PUBLIC_*` and must not go in
  `wrangler.jsonc` — Workers Builds prints `vars` in plaintext into the build
  log, which `/api/health`'s `APP_COMMIT_SHA` note already warns about.

### 3. A service worker

- `public/sw.js`, registered from a client component after sign-in.
- Handles `push` (show the notification) and `notificationclick` (focus or open
  the app at `hrefFor(kind)` — the same destinations the bell uses, so a tap and
  a click land in the same place).
- ⚠ **A service worker is a caching surface whether or not you want one.** It
  must not cache authenticated HTML. The safest shape is a worker that handles
  push events only and registers no `fetch` handler at all; anything else risks
  serving one rep's cached page to another on a shared device.
- ⚠ **Scope and the portability rule.** The worker is a static file, so it is
  platform-neutral. Registering it is app code. Nothing here may reach a
  Cloudflare API.

### 4. The sender

This is the part with a real decision in it.

**It cannot be a Cloudflare Cron Trigger.** 0040 already settled this and the
reasoning is unchanged: the OpenNext adapter's worker exports `fetch` and offers
no supported way to add `scheduled`, and patching it is platform coupling in the
place CLAUDE.md forbids.

**It cannot be pure pg_cron either**, and this is the new constraint: sending a
web push means an HTTPS request to an external push service with a signed VAPID
JWT and an encrypted payload. Postgres cannot do that without `pg_net`, and even
with it the ECDH/AES-GCM payload encryption is not something to hand-roll in
PL/pgSQL.

So the realistic options, in order of preference:

1. **An authenticated route handler + an external scheduler.**
   `POST /api/push/dispatch`, guarded by a shared secret the same way
   `/api/health` is guarded by `HEALTH_CHECK_TOKEN`. It reads the
   `alert_events` rows for today that have not yet been pushed, fans out to
   `push_subscriptions`, and stamps what it sent. Triggered by pg_cron +
   `pg_net` (one `http_post`, no crypto in the database), or by any external
   cron. **Keeps the portability rule**: the route is ordinary Node, the
   scheduler is config.
2. A long-running Node worker alongside the app. Clean, but it is a second
   deployable, which the client's hosting does not currently have.

Option 1 is the recommendation.

**It needs a sent-marker.** `alert_events.seen_at` is the rep's dismissal and
must not be reused for this — a row can be pushed and not seen, or seen in-app
and never pushed. Add `pushed_at timestamptz` to `alert_events` (additive), and
make the dispatch query `where pushed_at is null`. That is what makes a retry
after a half-finished run safe.

### 5. Pruning dead endpoints

A push service answers `404` or `410` for a subscription that is gone
(uninstalled, cleared data). Those must be deleted, not retried forever — set
`failed_at`, delete on the second failure. Without this the send fans out to a
growing list of dead endpoints and gets slower every week.

## What it must NOT do

- **Must not become a second source of truth.** If the push says one thing and
  the bell another, the bell is right: it is live. The push is a copy of what
  was true at a fixed time.
- **Must not send to a team lead about their reps, in the first pass.** The bell
  shows a lead per-rep lines because they asked for a screen; a phone buzzing at
  19:00 about somebody else's follow-up is a different product decision and
  should be made deliberately, not inherited.
- **Must not carry rep or institute detail in the payload.** A push payload is
  decrypted on a device that may be unlocked on a desk. "2 follow-ups still
  open" is enough; the name of the school is not.
- **Must not be the only channel.** Browsers drop subscriptions silently; iOS
  only delivers to a home-screen-installed PWA. The bell stays the guarantee and
  the push is an enhancement, which is why the bell was built first.

## Open questions for the client

1. Does a team lead get pushes at all, or only the in-app bell?
2. Quiet hours — 19:00 IST is the missed check; is a push at 19:00 acceptable,
   or should the evening one wait until the following morning?
3. iOS: push needs the app added to the home screen. Is that an instruction the
   client is willing to give reps, or is the bell sufficient there?
