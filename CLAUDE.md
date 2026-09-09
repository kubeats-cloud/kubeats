@AGENTS.md

# KUbeats

"For a smarter KU." Mobile-first field reporting for an education sales team. Reps log activity
against registered institutes; admins oversee the whole team.

## The prototype is a behaviour reference, not a visual one

`docs/field-ops-demo.tsx` is the validated click-through prototype. Match it for
**behaviour, field names and flows only** — activity keys, the weekly metric
set, the "open for today" meeting gate, the Set → Done lifecycle, the follow-up
visibility rules.

The prototype's **weekly lock** is no longer one of these. Stage 2 of the
redesign ended weekly commitments entirely (see below and
`docs/flow-redesign-plan.md`), so there is nothing left to lock.

**Do not copy its visuals.** Its cream/teal/gold palette and Fraunces serif are
not our design. The UI is specified below and nowhere else.

## Design & UI (our own — do NOT copy the prototype's visuals)

Clean, modern, mobile-first utility app.

- Component library: shadcn/ui (Tailwind + Radix; accessible by default;
  components live in the repo).
- Font: Inter via next/font (no serif; do not use Fraunces).
- Palette: white surfaces on a light slate background; one primary brand colour
  (indigo); slate neutrals. Semantic status colours used consistently:
  green = done/achieved, amber = scheduled/in-progress, red = pending/overdue,
  slate = neutral.
- Layout: mobile-first, single-column, max-width container centred on desktop;
  primary navigation as a thumb-reachable bottom bar; minimum 44px tap targets;
  generous spacing.
- Every screen has clear loading, empty, and error states. Dark mode is out of
  scope for v1.
- The nine institute status badges and the target-progress bars are colour-coded
  per the semantic palette above. Badge colour tracks the outcome, not the
  open/closed category — "First meeting done" is green and still open.

### Screen ownership

A rep has six screens: Dashboard, Institutes, Log Visit, Pending, This week
and Materials. An admin has a workspace instead — Overview, Review, Assign, Team,
Institutes, Settings — plus Data and Manage materials, which are deliberately
off the bar and reached from Settings or Overview.

This said "six screens, and no others" through Phase 9, when a rep had five and
`/materials` did not exist. It is a statement about restraint, not a hard count:
a new tab has to earn its place in a thumb-reachable bar, which is why the two
admin tools that get used a few times a year are one tap deeper instead.

**The Dashboard owns the daily-plan create-and-track flow.** There is no Daily
tab. On the Dashboard a rep adds today's planned visits (institute + purpose
from the admin-managed purposes list), sees each entry's held / not-held state,
and moves from an unheld entry into Log Visit.

This is load-bearing, not a layout preference: the meeting gate (rule 2) checks
a visit against that member's `daily_plans` rows for that date, so a meeting
cannot be logged at all unless the Dashboard flow put it on the plan first.

**Nothing in this app sets a target any more.** Stage 2 of the redesign
(`docs/flow-redesign-plan.md`, changes 3 and 4) removed commitment altogether:

- The **daily** target was found to be the daily plan wearing a second name —
  both were exactly institute + purpose — so it was merged into the Dashboard
  flow above rather than duplicated. There is still no Daily tab, and now there
  is no daily target either.
- The **weekly** tab became "This week": a read-only count of what was actually
  recorded, with no numbers to set, no submit and no lock.

`public.targets` is untouched in the database — table, columns, rows, RLS and
the `enforce_target_lock` trigger all still there — but no code reads or writes
it. That is the reversible choice, the same one taken for `institutes_covered`:
reviving commitments means restoring the screens, not writing a migration. Rule
6 (the lock) therefore still exists in SQL and is still covered by the
integration tests; it is simply unreachable from the app.

### How that maps to the code

Tokens live in `src/app/globals.css`. Use the semantic utilities rather than
raw Tailwind colours, so a palette change stays in one file:

| Intent | Utilities |
| --- | --- |
| Page background | `bg-background` (light slate) |
| Card / surface | `bg-card` (white) |
| Brand | `bg-primary`, `text-primary`, `ring-ring` (indigo) |
| Secondary text | `text-muted-foreground` |
| Done / achieved | `bg-success`, `<Badge variant="success">` |
| Scheduled / in progress | `bg-warning`, `<Badge variant="warning">` |
| Pending / overdue | `bg-danger`, `<Badge variant="danger">` |
| No status yet | `bg-neutral`, `<Badge variant="neutral">` |

Each status has a solid pair (`--success` / `--success-foreground`) for fills
and progress bars, and a `subtle` pair (`--success-subtle` /
`--success-subtle-foreground`) for tinted badges with accessible dark text.

`<Progress indicatorClassName="bg-success" />` colours a target bar.

Dark mode: `@custom-variant dark` is defined but no `.dark` palette exists, so
`dark:` utilities inside shadcn components never fire. Adding a `.dark { … }`
block in `globals.css` is the extension point if v2 wants it.

## Portability

This app must stay movable: hosted Supabase today, a client's self-hosted
Supabase or plain Postgres later, on any host that runs a Node server.

**The rule: no host-specific API may appear in application code.** No edge
runtime, no platform SDK, no `process.env.VERCEL_*` / `CF_*`, no provider image
loader, no KV or queue binding reached from a component or an action. If a
platform needs something, it goes in config or a thin adapter module — one file,
named for the platform — and the app keeps talking to its own interface.

Concretely, and true as of Phase 9:

- Every environment variable is read in `src/lib/env.ts` and nowhere else, apart
  from `NODE_ENV`. Adding a `process.env.SOMETHING` read anywhere else is the
  thing this rule exists to stop.
- The Supabase origin is derived from `NEXT_PUBLIC_SUPABASE_URL` — including in
  the CSP — so pointing at a self-hosted instance is a variable change, never a
  code change. No hostname is written down in `src/`.
- Everything the database needs lives in `supabase/migrations/`. What those
  migrations cannot carry — auth users, storage objects, the Vault secret and
  the cron schedule — is listed in `docs/BACKUP-RESTORE.md`, which is the
  document to update if that list ever changes.
- `NEXT_PUBLIC_*` values are inlined at build time, so moving projects means a
  rebuild, not just a restart. That is a deployment fact, not a code smell.

## Deployment ceiling

Cloudflare Workers **free plan: 3072 KiB gzipped**, and this app is at **2875
KiB** — about 197 KiB, 6.4% spare. The budget is real: measure before adding
anything sizable, and re-measure rather than trusting this line. It has been
wrong before, in both directions — it read 2949 for a while after the figure it
described had already moved, which is how a stale number becomes a wrong
decision about a dependency.

```bash
npm run build && npx wrangler deploy --dry-run --outdir /tmp/out   # "Total Upload:"
```

Over the line, the build still passes and the **deploy** fails. The answer is
the Workers Paid plan ($5/mo, 10 MiB), which is a plan change and nothing else —
not more trimming. `minify` in `wrangler.jsonc` and `scripts/trim-worker.mjs`
already claimed the easy 0.9 MiB between them; see README for both.

## Engineering notes

- Next.js 16: `cookies()` is async-only, and middleware is now `proxy.ts`
  (Node runtime, no edge).
- `npm run typecheck` runs `next typegen` first — `LayoutProps`/`PageProps` are
  generated into `.next/types` and `tsc` alone cannot see them.
- Load-bearing rules (meeting gate, role visibility) belong in the database as
  RLS and triggers, not only in the UI. The weekly lock was one of these and its
  trigger is still installed; the app no longer reaches it.
- Validate every input on both client and server. Never surface stack traces,
  SQL or secrets to users.
- A write that touches more than one table goes through a Postgres function so
  it is one transaction. Saving a visit is `public.log_visit()` (migration
  0002); it runs SECURITY INVOKER, so RLS and every trigger still apply. It
  raises `FO001`-`FO007` for the cases a rep can cause, and `src/lib/visit-actions.ts`
  maps those codes — never the message text — to sentences.
- Rule 4's status vocabulary is nine values, each carrying an OPEN or CLOSED
  category. `INSTITUTE_STATUS_CATALOGUE` in `src/lib/validation/institute.ts` is
  the app's single source of truth for the mapping; `public.institute_statuses`
  plus `institute_status_category()` (migration 0010) is the database's, so a
  query can tell open from closed without the app. **They have to be changed
  together** — the `institute_status_category` suite in
  `tests/integration/rules.test.ts` fails if only one of them moves, and 0010
  itself refuses to apply if its lookup table and its two CHECK constraints
  disagree. Nothing may decide open-vs-closed for itself; ask one of those two.
  Note that null is neither open nor closed: "no status yet" is its own thing.
- **Rule 5 IS the open category now**, which is the reverse of what this said
  through stage 2. An OPEN status needs a follow-up date **and time**; a CLOSED
  one does not (though it may still carry one — "they said no, ask again next
  intake" is a real note). `followUpRequired()` asks `isOpenStatus()` and
  `enforce_follow_up_when_open()` (0018) asks
  `public.institute_status_is_open()`, so neither side keeps its own list and
  they cannot drift. It is a TRIGGER rather than a CHECK because two of the
  three live visits carried an open status with no follow-up time and a
  constraint would have refused to build.
  0001's `visits_follow_up_hidden_when_scheduled` — which FORBADE a follow-up
  on the two "scheduled" statuses — is **dropped** by 0018. "Next session set"
  *is* "Session scheduled", so the old rule and the new one were opposites.
  0010's `visits_follow_up_required_when_awaiting` CHECK stays: both its
  statuses are open, so it is a strict subset, kept so dropping the trigger
  could not silently lose it.
- Every visit must carry a photo (Rule 12, migration 0006). The rule is stated
  three times on purpose: the shared zod schema, `log_visit()` raising `FO007`,
  and the `visits_photo_required` CHECK, which is the one that holds against a
  direct insert.
- **A check-in needs a location, or the rep's reason for not having one.** This
  reverses the never-block rule 0014 and 0015 both state at length, and it is
  the sharpest reversal in the redesign. What it is not is a wall: GPS fails →
  the rep types why → the arrival saves with `checkin_location_manual` true and
  their words in `checkin_manual_reason`, both shown to admins. A logged escape,
  never a silent one. `enforce_checkin_located()` raises `FO012`; the columns
  stay nullable because one row predates the rule and because the escape is
  real. A POOR fix still warns and never blocks — blocking on accuracy would
  strand a rep in a staff room, and with one-visit-at-a-time that ends their day.
- **The presence guarantee covers every activity**, not just meetings. 0014
  exempted sessions, campus visits and the one-shots because "they do not run
  off the daily plan"; every visit runs off it now. `enforce_checkin_before_visit()`
  replaces `enforce_checkin_before_meeting()` under the same trigger name and
  the same `FO009`. `enforce_meeting_gate()` is untouched and still separate —
  0014 insisted on two triggers so dropping either leaves the other standing.
- The photo arrives one of two ways, both in `CaptureFields`: the in-app camera
  (`getUserMedia`, rear-facing by default, in `camera-capture.tsx`) or a file
  from the device. Whichever it is, the coordinates stamped into the image are
  read **at the moment of attaching**, not at page load — browsers strip EXIF
  geotags, so a live reading is both the only option and the harder one to fake.
  If `getUserMedia` is unavailable or refused, it falls back to the native
  `capture="environment"` input; there is no desktop webcam path beyond that.
- The stamp carries an approximate area name under the coordinates, from
  OpenStreetMap's Nominatim via `/api/place` (server-side, so the User-Agent
  their policy asks for can be set and the answer cached in `place_cache`,
  migration 0007). It is decoration and is treated as such: a 3.5s timeout on
  the route, a 4s abort in the browser, and any failure simply omits the line.
  The coordinates and the time are never replaced by it, and no visit has ever
  failed to save because a place could not be named.
- The area name is deliberately NOT stored on `visits`. It is already burned
  into that visit's photograph, and `place_cache` can be joined on the rounded
  coordinates to recover it — see the query at the foot of 0007. A column would
  be a third copy of the same fact, and would mean redefining `log_visit()` for
  a convenience label.
- `photo_url` is written once and never again — the `visits_photo_final` trigger
  (0006) raises `FO008` on any UPDATE that changes it, for the service role too.
  Written as "any change at all" rather than "any change after `closed_at`" on
  purpose: a meeting never gets a `closed_at`, so the narrower rule would leave
  every meeting's evidence editable forever.
- Week figures are ALWAYS live: recomputed from `daily_plans` and `visits` on
  every read, never a frozen snapshot. Any reporting that needs one has to take
  it itself.
- **Closing a "Set" no longer moves it.** It used to: one row flipped Set →
  Done, so a session set in week 1 and held in week 3 counted as *Done in week
  1*. Stage 3 closes a loop by VISITING AGAIN — check in, log the visit that
  completes it — so there are two rows. The completing row carries
  `closes_visit_id`; the Set row keeps `lifecycle_status = 'Set'` and only gains
  a `closed_at`. Week 1 keeps its Sessions Set, week 3 earns its Sessions Done,
  and each week is credited with what happened in it.
  This is load-bearing arithmetic, not bookkeeping: flipping the row would have
  moved the credit **and** let the new row count as a second Done. Pending and
  the open-loops tile therefore both read `lifecycle_status = 'Set' AND
  closed_at IS NULL` — `getPendingVisits()` **and** `openLoopsByMember()`; miss
  the second and the tile never comes down.
- **Pending is a read-only notice board.** Nothing is closed from it, by anyone.
  Filing happens inside the visit: submitting the short feedback form calls
  `close_visit()`, which writes the report, closes any earlier Set and stamps
  the check-out in one transaction. There is no check-out button and no rep-facing
  "abandon" — a visit nobody can finish is swept overnight by
  `sweep_open_checkins()` into the same "closed, time not recorded" state the
  old escape valve used.
- **`checkout_missing` is an admin's to set, never a rep's.** Deleting the rep's
  "close without check-out" button did not close the API path behind it —
  `daily_plans_update` is `member = auth.uid() or is_admin()`, so a rep could
  have set the column by hand. `guard_checkout_missing()` (FO020) is what
  actually removes the abandon button, and it stamps `checkout_closed_by` /
  `checkout_closed_at` itself rather than trusting a client. A null `_by` with a
  set `_at` means the nightly sweep did it; a name means an admin did, from the
  "Still checked in" panel on Overview — the same-day unblock for a rep whose
  visit was orphaned, since one open visit stops them working anywhere.
- A week runs Monday to Saturday for reporting, but counts Monday through
  Sunday: a Sunday's work folds into the week that just ended rather than
  falling out of every total. `weekEnd()` is the Saturday shown to the rep;
  `weekCountEnd()` is the Sunday every rollup query uses.
- Every date and time on a screen goes through `src/lib/dates.ts`, and nothing
  else may format one. Both the timezone (Asia/Kolkata) and the wording are
  fixed there, because a rendered date that depends on where the code runs is
  not a cosmetic bug: the server renders in UTC, an Indian browser renders in
  UTC+5:30, and once past local midnight the two disagree about the day, React
  refuses to hydrate (#418) and the app freezes until 05:30 IST. The month
  names are a table in that file rather than a locale lookup on purpose — CLDR
  revises abbreviations (en-GB's September became "Sept" in 2022), so asking a
  locale for the word makes the output depend on which ICU each end happens to
  ship. `tests/unit/dates.test.ts` reloads the module under five timezones and
  fails if either half is unpinned.
- Not the same thing: `weeks.ts` still does its week *arithmetic* in UTC, so a
  stored `YYYY-MM-DD` cannot drift; it only borrows dates.ts for the spelling.
- `todayISO()` in dates.ts is the app's single definition of "today", and the
  database has the matching one in `public.app_today()` (migration 0008). Both
  read the Asia/Kolkata calendar day, so the day turns over at midnight in
  India rather than at 05:30. **They have to be changed together.** The app
  writes `daily_plans.date` with one and `log_visit()` dates the visit and
  looks that plan row up with the other; if they disagree, a rep standing in
  front of a school is told it is not on today's plan. Migration 0008's header
  says the same thing from the SQL side, and the `app_today` suite in
  `tests/integration/rules.test.ts` fails loudly if only one of them moves.
  There is exactly one `todayISO()` in `src/` — `visits.ts` re-exports it, and
  a second copy is how the two halves drifted the first time.
- The materials library (Feature A, migration 0012) inverts the visit-photos
  shape: one private bucket the whole team READS, that only an admin may write.
  Size and type are enforced four times — the browser, the server action, the
  `materials_*_valid` CHECKs, and the bucket's own `file_size_limit` /
  `allowed_mime_types`, which is the layer a forged form cannot reach.
  **Materials are never compressed**, unlike visit photos: a poster or a fee
  sheet has to stay print-quality, so the 5 MiB cap is the only thing between
  the library and the 1 GB free tier. There is no retention job — a material
  stays until an admin deletes it. Deleting removes the storage object first and
  the row second, because a file with no row is invisible and permanent, while a
  row with no file merely renders as unavailable; the housekeeping query at the
  foot of 0012 lists both kinds of orphan.
- Visit photos are deleted automatically after
  `public.visit_photo_retention_days()` days (migration 0003, scheduled in
  0004). The visit rows, coordinates and timestamps are kept forever, so a row
  older than the window still has a `photo_url` whose file is gone: anything
  that displays a photo must treat a missing object as "expired", not an error.
