@AGENTS.md

# KUbeats

"For a smarter KU." Mobile-first field reporting for an education sales team. Reps log activity
against registered institutes; admins oversee the whole team.

## The prototype is a behaviour reference, not a visual one

`docs/field-ops-demo.tsx` is the validated click-through prototype. Match it for
**behaviour, field names and flows only** — activity keys, the weekly metric
set, the "open for today" meeting gate, the Set → Done lifecycle, the follow-up
visibility rules.

The prototype's **weekly lock** is one of these again. Stage 2 of the redesign
ended weekly commitments entirely; the client's own spec put them back, so the
eight numbers, the submit-and-lock and the admin reopen are all live (see below
and `docs/flow-redesign-plan.md`). What did NOT come back is the daily target.

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

A rep has six screens: Dashboard, Institutes, Log Visit, Pending, Targets
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

**A purpose is admin-managed; an activity is not, and the asymmetry is
arithmetic.** Two requests that sound identical get opposite answers, and this
is the one paragraph to read before touching either:

- **`activity` is six values and stays six.** Seven of the eight weekly metrics
  are counted by `(activity, lifecycle_status)` and `public.targets` has one
  integer column per metric, so a seventh activity would be a metric with no
  column, no row on the Targets screen and no place in `tallyVisitMetrics()` —
  invisible in every total, which is worse than not existing.
- **`public.purposes` is the admin-managed layer on top**, and since migrations
  0024 and 0025 each row DECLARES what the visit will be: `activity` (which of
  the six, NOT NULL) and `lifecycle` (Set/Done, or null). An admin may add as
  many purposes as they like; the arithmetic underneath never moves.

**Stage 3 deleted Log Visit's Activity selector.** The rep never picks an
activity — it is derived from the purpose they planned under, through
`daily_plans.purpose_id` → `purposes`. What the selector used to feed, it still
feeds: `log_visit()` gets the same `p_activity`, so the meeting gate, Rule 3's
CHECK and Rule 7's counting are untouched — only the value's SOURCE moved.
`lifecycle` is what tells "Fix a session" from "Complete a session", both of
which map to `session`; without it Sessions Set and Sessions Done would be
indistinguishable.

**A one-shot purpose carries lifecycle NULL, and that is not a preference.**
`visits_lifecycle_matches_activity` (0001) refuses a lifecycle on anything that
is not a session or a campus visit, so "First meeting", "Other", "Follow-up",
Olympiad, Application and Admissions are all null.
`purposes_lifecycle_matches_activity` (0025) is that same CASE expression
written against purposes, so the two tables cannot disagree, and
`plannedActivityIsValid()` asks the same question in TypeScript before a rep is
walked into a visit that could not be saved.

**A metric with no purpose behind it cannot be earned**, and would fail
silently — a week's numbers simply come in flat. 0025's assertion block walks
all eight metrics against the live table and refuses to apply if any has no
active purpose feeding it; `purpose-activity.test.ts` checks the other half,
that what the app derives is a shape Rule 7 can count.

**Retire a purpose, never delete one.** `purposes.is_active` (0025) takes it out
of the picker while keeping it readable, because every plan row that references
it still needs its mapping to resolve. Deleting one strands that plan — with the
selector gone there is no by-hand fallback — so `/log` catches it and sends the
rep back to re-plan rather than showing a form the database would refuse.

It replaces `PURPOSE_ACTIVITY`, a hard-coded map from four purpose LABELS whose
own comment named the weakness: renaming a purpose in Settings silently dropped
it out. The mapping travels on the row now. `purposes_activity_valid` and
`visits_activity_valid` are two hand-written copies of one vocabulary, and
0024's assertion block compares them and refuses to leave them disagreeing —
the same guard, for the same reason, as 0010's for statuses.

**Adding a purpose is choosing a metric**, so `PurposesPanel`'s activity picker
mounts EMPTY and is required. A picker pre-set to "Meeting" would let an admin
add a session purpose that silently counts as a meeting for ever.

**A rep commits to a week, and to nothing else.** Stage 2 of the redesign
(`docs/flow-redesign-plan.md`, changes 3 and 4) removed commitment altogether;
the client's authoritative spec restored half of it. The two halves went
different ways and they are not symmetrical:

- The **daily** target is gone and is not coming back. It was found to be the
  daily plan wearing a second name — both were exactly institute + purpose — so
  it was merged into the Dashboard flow above. There is still no Daily tab and
  no daily target. Rebuilding one would put a second writer in front of the
  `daily_plans` row rule 2 checks, which is the thing screen ownership exists to
  prevent.
- The **weekly** target is back, whole: a rep sets the eight metric targets on
  `/targets`, saves a draft or submits, a submitted week locks, and only an
  admin can reopen it. Rule 6 is reachable from the app again rather than merely
  installed. The tab is labelled "Targets" again to match.

**The two screens show one thing, not two.** Achieved-vs-target IS the "what you
did this week" count — the achieved figure is the numerator — so there is no
separate read-only block anywhere. A metric with a target gets a bar; a metric
with none still shows its count rather than being replaced by an instruction to
go and set numbers, which is the one place `MetricRow` improves on the
pre-stage-2 original.

Rule 7's sourcing is untouched throughout: **Meetings** come from `daily_plans`
where `meetings_actual = 1`, the other seven from `visits`, both counted by
`date` over the week's range with its deliberate Sunday end.

`public.targets` needed **no migration** for any of this — table, columns, rows,
RLS, both CHECKs and the `enforce_target_lock` trigger were all still there,
which was the entire point of retiring the feature from the app rather than from
the schema. 0021 is comment-only and optional: it retracts the "DORMANT" notice
0017 wrote onto the table, which would otherwise now be a lie. `period` still
accepts `daily` and `monthly` and the app writes only `weekly`, so the rows
committed under the old periods stay readable and unoffered — the same
asymmetry, pointing the other way.

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

## The public surface is three things, and nothing else

KUbeats is a private tool. Exactly three paths answer a stranger:
**`/login`**, **`/privacy`**, and **`/.well-known/security.txt`**. Everything
else redirects to `/login` for anyone without a session.

- **`PUBLIC_PATHS` and `AUTH_PATHS` in `src/lib/nav.ts` are two lists on
  purpose**, and collapsing them back into one is the mistake to avoid. Public
  means "reachable with no session"; auth means "and a signed-in user is
  bounced off it". `/login` is both. `/privacy` is only the first, because a rep
  who wants to know what is recorded about them must be able to read it while
  logged in. The `nav.test.ts` suite asserts the containment and the asymmetry.
- **`robots.ts` is a Route Handler, so `proxy.ts`'s matcher must exclude
  `robots.txt`** or the signed-out redirect hands a crawler the login page and
  the file might as well not exist. Same trap `manifest.webmanifest` already
  documents there.
- **`X-Robots-Tag: noindex, nofollow`** rides on every response from
  `next.config.ts`. robots.txt asks a crawler not to FETCH; the header tells it
  not to INDEX. Both, deliberately — `src/app/robots.ts` explains the
  interaction and why a private app takes belt and braces.
- **Neither is a security control.** The boundary is `proxy.ts`, the `(app)`
  layout's own server-side check, and RLS.
- **`/api/*` is a fourth surface and is NOT behind the page gate.** `proxy.ts`
  returns early for it, so every route under it authenticates itself or it is
  public. `/api/health` is the worked example and it answers twice: a static
  `{"ok":true}` to anyone, and — only to a caller presenting
  `HEALTH_CHECK_TOKEN` as `x-health-token` — a real database check, plus the
  **commit the bundle was built from**. The split is the pen-test F2 finding: an
  anonymous caller must not be able to spend database quota or learn whether
  Postgres is up, and need not learn which commit to go and read either.
  The SHA is what makes "has the new build gone out?" a one-line check, and it
  is needed because every screen the current rework changes sits behind auth —
  two consecutive builds are otherwise indistinguishable from outside, and
  comparing content-hashed asset names does not work because those hashes are
  not reproducible across build environments. It arrives as `APP_COMMIT_SHA`,
  read in `env.ts` like every other variable; the platform maps its own spelling
  onto that generic name **in the build command**, never in `wrangler.jsonc`,
  which must never grow a `vars` block because Workers Builds prints those in
  plaintext into the build log. **It has to be written into an `.env*` file, not
  just exported** — the OpenNext adapter bakes in what Next loaded from env
  files, so a shell-only value is present during the build and absent from the
  bundle, and the symptom is a null field with nothing to explain it. Verified,
  not assumed; `.env.example` carries the working command.
- **There are TWO 404s and both are needed.** `src/app/not-found.tsx` answers an
  unmatched URL, renders in the root layout, and assumes no session;
  `src/app/(app)/not-found.tsx` answers `notFound()` thrown inside the app group
  and keeps the nav bar, because that reader is signed in and mid-task. Before
  the root one existed, an unmatched URL fell through to Next's own unbranded
  default.
- **A signed-OUT stranger never sees a 404**, and that is deliberate. Letting
  them tell "no such page" from "page you may not see" would turn the 404 into a
  route-enumeration oracle. One redirect for everything unknown-or-protected
  leaks nothing. Reversing it is an exemption list in `proxy.ts`.

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

**The client is on the Workers Paid plan: 10 MiB gzipped**, and this app is at
**3067 KiB** — about 30% of the ceiling. The plan change that this file spent
several phases recommending has happened, so **size is no longer a constraint on
what may be added**, and the paragraph that used to sit here — 106 KiB spare,
measure before adding a dependency, the campus picker costing 17 KiB — no longer
describes the situation. It was true against the free plan's 3072 KiB.

```bash
npm run build && npx wrangler deploy --dry-run --outdir /tmp/out   # "Total Upload:"
```

**Still measure, and still re-measure rather than trusting this line.** The
figure has been wrong before in both directions — it read 2949 for a while after
the thing it described had already moved — and a number nobody checks is how a
stale line becomes a wrong decision. What has changed is the consequence: a
measurement is now a fact worth recording, not a gate to clear. Over the line
the build still passes and the **deploy** fails, which is now four times further
away than it was.

`minify` in `wrangler.jsonc` and `scripts/trim-worker.mjs` claimed about 0.9 MiB
between them and both stay — they cost nothing and a smaller Worker still starts
faster. See README for both.

## Engineering notes

- **The app and its schema ship separately, and something has to watch the gap.**
  `npm run check:schema` asks a database which column-bearing migrations it
  actually has and exits non-zero when it is behind the code. Read-only, and it
  takes a URL and key so it can be pointed at any environment.
  It exists because the gap was real: a build went out expecting 0024–0026
  against a database still at 0022, and every mutation on Settings failed with
  a sentence that read like a network blip. `/api/health` answers "has the new
  BUILD gone out" and is structurally incapable of catching that — this is the
  other half of the same question, and `PGRST204` / `42703` mapping to
  `DATABASE_BEHIND` in `errors.ts` is the third.
  **It cannot see 0023 or 0027–0030**, which add no column. A clean run means
  the schema is roughly where the code expects, not that it is current; each
  migration's own assertion block is what proves it landed.
- Next.js 16: `cookies()` is async-only, and middleware is now `proxy.ts`
  (Node runtime, no edge).
- `npm run typecheck` runs `next typegen` first — `LayoutProps`/`PageProps` are
  generated into `.next/types` and `tsc` alone cannot see them.
- Load-bearing rules (meeting gate, role visibility, the weekly lock) belong in
  the database as RLS and triggers, not only in the UI. The lock survived stage
  2 as an installed-but-unreachable trigger and that is exactly why restoring
  the weekly target cost no migration: the rule had never left.
- Validate every input on both client and server. Never surface stack traces,
  SQL or secrets to users.
- A write that touches more than one table goes through a Postgres function so
  it is one transaction. Saving a visit is `public.log_visit()` (migration
  0002); it runs SECURITY INVOKER, so RLS and every trigger still apply. It
  raises `FO001`-`FO007` for the cases a rep can cause, and `src/lib/visit-actions.ts`
  maps those codes — never the message text — to sentences.
- **Rule 4's status vocabulary lives in ONE place in the database**, and since
  migration 0026 that is `public.institute_statuses` — not a CHECK constraint.
  Each row carries an OPEN or CLOSED category; `institute_status_category()` and
  `institute_status_is_open()` (0010) read it, so a query can tell open from
  closed without the app. Null is neither: "no status yet" is its own thing.
  **`institutes.status` and `visits.status_set_to` are FOREIGN KEYS to it**
  (0026), replacing the two CHECKs that each listed the nine literals.
  `institute_status_history.status` has been one since 0011. The reason is not
  tidiness: **a CHECK cannot be extended by an admin and an FK can.** An admin
  adding a row while the CHECKs stood would create a status that inserts fine
  into the vocabulary and is then refused by every institute and visit with a
  raw 23514. Drift is now impossible by construction rather than by 0010's
  assertion, which only ever ran once.
  All three FKs are `on update restrict on delete restrict`, which gives the
  editing rule for free and with no code: a status **never used** renames or
  deletes cleanly (the typo case), one **in use** is refused with 23503, and
  retiring is `is_active = false`. Referential checks ignore RLS, so a rep's
  insert is validated exactly as an admin's — the same reasoning 0011 gives.
  **`visits_follow_up_required_when_awaiting` (0010) is deliberately NOT
  converted.** It is about a RULE, not a vocabulary, and being a literal list of
  two statuses is what it is for. It is a strict subset of FO016, which asks the
  category and so already covers anything an admin adds — but if one of those
  two is ever retired and replaced under a new name, the CHECK stops covering it
  and only the trigger remains.
  `SEED_STATUS_CATALOGUE` in `src/lib/validation/institute.ts` is a **seed and a
  fallback, not the vocabulary**: the nine a fresh database is created with, and
  what the app renders if the read fails. `listStatusCatalogue()` is the single
  place that asks the database, **deliberately uncached**, so a status an admin
  adds is usable by a rep on their next request. Every helper takes a catalogue
  and `visitSchema` is `makeVisitSchema(catalogue)` — a schema holding the
  seeded nine would refuse the very status the database just accepted.
  **An admin maintains the vocabulary from Settings** (stage 4b): add, rename
  while unused, retire. There is **no delete** — not for an admin, not even for
  a status nothing has used. Retiring is the one removal path, so there is one
  rule to learn and no way to discover the difference by losing something.
  Renaming needs no guard code: the foreign keys are `on update restrict`, so an
  unused status renames cleanly and one in use is refused with 23503, which the
  action turns into "add the corrected one and retire this".
- **Every visit must say where it left the institute.**
  `enforce_status_required()` (FO024, migration 0027) refuses an insert with no
  `status_set_to`, and "No change" is gone from Log Visit. It is a database rule
  rather than form validation because Pending is built on it: a visit that set
  no status is not a follow-up owed and not a closed loop — it is absent, for
  ever, with nothing to say it went missing. **INSERT-only**, so every visit
  logged under "No change" stays legal, readable and countable; a NOT NULL could
  not have been built against them, and rewriting them would be inventing data.
  ⚠ **0027 is the one deploy-coupled migration in Phase 2.** Applied before the
  code ships it refuses every rep who picks "No change" — on a visit they have
  already walked to and photographed. Deploy-first is survivable; apply-first is
  not, which is the opposite of the usual advice.
- **Rule 5 IS the open category now**, which is the reverse of what this said
  through stage 2. An OPEN status needs a follow-up **date**; a CLOSED one does
  not (though it may still carry one — "they said no, ask again next intake" is
  a real note). `followUpRequired()` asks `isOpenStatus()` and
  `enforce_follow_up_when_open()` asks `public.institute_status_is_open()`, so
  neither side keeps its own list and they cannot drift. It is a TRIGGER rather
  than a CHECK because two of the three live visits carried an open status with
  no follow-up at all and a constraint would have refused to build.
  **A DATE, and no longer a time.** 0018 required both and the form pre-filled
  the time to 11:00 so a rep only really answered once; the client settled on
  the date alone, so **migration 0023** rewrites the trigger to ask for the date
  and the Time control is deleted. `visits.follow_up_time` is **dormant, not
  dropped** — it keeps every value recorded between 0018 and 0023 — and
  `visitSchema` still ACCEPTS one, so a page cached from before 0023 that posts
  a time has it stored rather than silently discarded. 0023 only loosens, so
  unlike 0018/0019/0022 it can be applied at any time, before or after its
  deploy.
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
- **Captured, not displayed: the location readout is off during a visit.** What
  is captured has not changed by a field. What a rep SEES while they are mid-visit
  has: no coordinates, no accuracy badge, no area name, no arrival time in the
  page header, and no "Reading your location…" narration on the photo steps.
  It all comes back on the FINISHED record — `report-view.tsx`, the admin's
  activity report, the duration on a completed plan entry — where it is a record
  rather than a readout, and admins keep every mid-visit view they had.
  **The one exception is the GATE, and it has to stay visible**:
  `NO_LOCATION_GUIDANCE` and the reason-override are the rep's only explanation
  of why check-in is refused, so silencing them would turn a blocked check-in
  into a broken button. The rule is the distinction between the two: hide the
  READOUT, keep the GATE. A poor fix still gets its one line and its Try again,
  because that is something the rep can act on; `describeAccuracy()` is simply
  not called on that path any more.
- **The presence guarantee covers every activity**, not just meetings. 0014
  exempted sessions, campus visits and the one-shots because "they do not run
  off the daily plan"; every visit runs off it now. `enforce_checkin_before_visit()`
  replaces `enforce_checkin_before_meeting()` under the same trigger name and
  the same `FO009`. `enforce_meeting_gate()` is untouched and still separate —
  0014 insisted on two triggers so dropping either leaves the other standing.
- **The photo comes from a camera, and only from a camera.** `CaptureFields`
  offered a second button that picked a file from the device; Phase 2 stage 1
  deleted it. A picture chosen from a gallery is evidence of nothing in
  particular — any image, anywhere, any day — and the whole point of the
  photograph is that it is evidence. The in-app camera (`getUserMedia`,
  rear-facing by default, in `camera-capture.tsx`) takes the frame from the live
  stream straight into the stamping canvas, so it never exists as a file the rep
  could substitute.
  **The native fallback is NOT the gallery and must not be deleted with it.**
  When `getUserMedia` is unavailable or refused, `CaptureFields` hands over to a
  hidden `capture="environment"` input, which opens the device's own CAMERA app.
  It looks exactly like the picker that was removed, and removing it too would
  mean a rep on such a device cannot attach a photo at all — Rule 12 then blocks
  the save and they cannot log the visit. `tests/unit/capture-fields.test.ts`
  fails if either half of that moves: the gallery coming back, or the fallback
  going away. On a DESKTOP browser `capture` is only a hint and degrades to a
  file picker, so a laptop with no webcam has no route to a photo; reps are on
  phones, so that is accepted rather than solved.
  Whichever camera it is, the coordinates stamped into the image are read **at
  the moment of attaching**, not at page load — browsers strip EXIF geotags, so
  a live reading is both the only option and the harder one to fake.
- The stamp carries an approximate area name under the coordinates, via
  `/api/place` (server-side, so the User-Agent Nominatim's policy asks for can
  be set, no key reaches a browser, and the answer is cached in `place_cache`,
  migration 0007). It is decoration and is treated as such: a 3.5s timeout on
  the route, a 4s abort in the browser, and any failure simply omits the line.
  The coordinates and the time are never replaced by it, and no visit has ever
  failed to save because a place could not be named.
- **Two geocoders, chained, and the second one is the default.** `place_cache`
  first, then **Ola Maps** when a key is set, then **Nominatim**, then nothing.
  Ola is optional in the strong sense: with `OLA_MAPS_API_KEY` unset the route
  skips it WITHOUT a fetch and behaves exactly as it did before it existed,
  which is the supported configuration, not a degraded one.
  `docs/OLA-MAPS-SETUP.md` is what the client follows to switch it on.
  Four things hold this together:
  - **Step 2 is a SLOT, not a provider.** It held Mappls first, whose free tier
    turned out to be about fifty lookups a month; swapping in Ola changed the
    route by four lines and the rest of the chain not at all. Whatever fills it
    next has the same contract: return a label in the app's own format, or say
    nothing and get out of the way. Mappls was DELETED rather than left dormant
    — git history is a better archive than an unwired provider confusing the
    next reader, and dead code costs bundle bytes in a budget with ~106 KiB
    spare. That is the opposite call from the dormant *columns* elsewhere in
    this file, and deliberately: restoring a column needs a migration,
    restoring a module needs `git revert`.
  - **The 3.5s budget is SPLIT, not doubled** — 1.5s for Ola, the rest for
    Nominatim. Giving each its own full timeout would make the worst case 7s
    against a browser that aborts at 4s, so every photo in a slow spot would
    wait longer and still get nothing. `tests/unit/ola.test.ts` asserts the
    arithmetic against `PLACE_TIMEOUT_MS` rather than restating the numbers.
  - **Both providers produce the SAME label.** `joinPlaceParts()` in `places.ts`
    is the only place a label is built; `formatPlace()` and `formatOlaPlace()`
    only decide which of their own fields feed it. They do not even agree on the
    SHAPE: Nominatim returns flat named keys, Ola returns a Google-style list of
    components tagged with `types`, so Ola's is found by asking what a component
    IS rather than reading a key. Ola's `formatted_address` is deliberately
    ignored — a courier's address does not fit under the coordinates.
  - **The cache stores the label, not its source.** That is what lets a key be
    added or removed, or the whole provider swapped, without invalidating a row.
  This changes the NAME only. GPS accuracy comes from the device and nothing
  here can move a pin, which is also why none of it touched the capture path or
  the location-hidden-during-a-visit rule above.
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
- **Pending is what is still OWED**, which is a wider question than it used to
  ask. It listed visits at `lifecycle_status = 'Set'` — sessions and campus
  visits promised and not held — and missed every other kind of owing: a first
  meeting nobody chased, an approval nobody came back on, an invitation with no
  answer. Phase 2 stage 5 asks the vocabulary instead: **one row per institute
  whose CURRENT status is OPEN.** It holds no list of its own, so a status an
  admin adds and marks open appears there on the next request.
  Driven off `institutes.status` rather than off each visit, for three reasons:
  it is the same value as the badge on `/institutes` so the two cannot disagree;
  it collapses to ONE row for an institute visited five times; and it handles
  supersession across reps, since two reps share a campus and B logging "Session
  done" must take A's row off the screen.
  Scoping is RLS's, twice and differently: `institutes` is campus-scoped, which
  decides which rows exist; `visits` is `member = auth.uid() or is_admin()`,
  which decides only whether a row can be ATTRIBUTED. A rep therefore sees an
  open institute in their campus even when a colleague left it open, and the row
  says whose it is rather than hiding it.
- **Nothing is CLOSED from Pending, and a rep can now START from it.** Filing
  still happens inside the visit — the feedback form calls `close_visit()`,
  which writes the report, closes any earlier Set and stamps the check-out in
  one transaction — and there is still no check-out button and no rep-facing
  "abandon"; a visit nobody can finish is swept overnight by
  `sweep_open_checkins()`. What stage 5 adds is a way IN: `startFollowUp()` puts
  the institute on today's plan and **hands straight back to the Dashboard**.
  That is what keeps it inside the screen-ownership rule above — it seeds a row
  and never tracks one, so there is still exactly one screen where a visit is
  followed, and from the redirect onwards it is the ordinary check-in → log →
  report → auto-check-out chain with the same photo, gate and guarantee.
  **An admin's Pending is read-only** (D10): no campus, no field visits, and a
  launch would put the visit on the admin's own day. `startFollowUp()` refuses
  them itself rather than trusting the view.
- **`getUnreportedVisits()` on Pending must not be deleted**, however redundant
  it looks. Logging and filing are one submit but TWO RPCs, so a visit can exist
  unreported; overnight the sweep sets `checkout_missing`, `visitStatusOf()`
  then calls the plan entry "Completed", the Dashboard stops offering "Continue"
  and only ever showed today anyway. That block is the **only** thing in the app
  that produces a `/log?plan=` link for such a visit. Remove it and the report is
  owed for ever with nothing on screen to say so.
- **The closing report asks four things, plus two the status asks for**
  (Phase 2 stage 1, `docs/phase2-flow-rework-plan.md` §14): a free-text "How did
  it go?", person met as **name (required) + phone (optional)**, and — only when
  the status says so — ONE student count, with the session's topic and who took
  it. That is the whole form.
  The name and the phone were BOTH optional until the client's spec separated
  them, with a rule that a phone had to have a name beside it; so a report could
  name nobody at all, while a rep who never got a mobile had a field the form
  implied they owed. There is always a person; there is not always a number.
  Optional still means "may be absent", never "may be wrong" — a phone that is
  present is still ten digits, which `visits_met_phone_valid` would insist on
  regardless.
  **Withdrawing a field costs nothing, and that is by design.** Every field in
  `close_visit()` is a DEFAULTED parameter, so a question leaving the form is
  the app passing null — `feedback-actions.ts` does it explicitly at both call
  sites, with a comment, so a reader sees a decision rather than an omission.
  The column keeps its data and its vocabulary CHECK, `report-view.tsx` skips an
  empty value so a report filed under any version still renders, and bringing
  one back is a control. Withdrawn so far: is-the-institute-interested, the
  OUTCOME, the MANAGEMENT RESPONSE, the STUDENT RESPONSE, management interest
  LEVEL, designation, and everything the retired long report asked.
  **The head count is ONE number again.** 0009 built `students_reached`, 0022
  woke it as a second count (PRESENT and PARTICIPATED), and stage 1 retired it
  once more; the client's spec asks one question about students. The survivor is
  `students_attended` — unchanged since 0001, and the number every filed report
  already carries. It is not compulsory: a rep who did not count heads must
  still be able to file. `report-view.tsx` still labels the old second count by
  era, switching on `activities_conducted`, which only the long form ever wrote,
  so nothing already filed starts meaning something different.
  **The follow-up is NOT part of this form** and used not to be honest about it.
  `close_visit()` never wrote `follow_up_date` or `follow_up_time`, so on the
  recovery path the rep typed a date into a box that discarded it. The pair now
  lives in `visitSchema` alone, rendered on Log Visit beside the status that
  decides it, and stored by `log_visit()`. The rule is the status: OPEN requires
  a **date** (`enforce_follow_up_when_open`, FO016 — see Rule 5 above for why
  the time it also demanded from 0018 to 0023 is gone), CLOSED merely permits
  one. The "Is a next session set?" yes/no that used to
  gate them is gone — it was a second answer to the same question, and choosing
  an open status while answering "No" hid fields the schema still required, so
  the error named a box that was not on the screen.
  `tests/unit/feedback.test.ts` asserts the whole shape, not the two absences:
  **every field this form collects is one `close_visit()` writes.**
- **Campus scoping is a security boundary, not a filter.** `public.campuses`
  holds the university's own five campuses — the places reps work FROM — and is
  NOT `public.institutes`, which is the pipeline of prospect schools they work
  ON. A rep has exactly one campus (`profiles.campus_id`); an admin has none and
  sees everything, which is why the column is nullable and `my_campus()` returns
  null for them. `enforce_profile_campus` (FO021) holds both halves.
  Three doors, not one: `institutes_select`, `institutes_update` (which was
  `using (true) with check (true)` — any rep could edit any institute, readable
  or not) and `institute_status_history_select` (which exposed the whole
  registry's journey without touching `institutes`). Materials are scoped in
  **two** places, the table and the bucket, or the row is hidden and the file is
  not; a null `campus_id` there means every campus.
  **`log_visit()` and `close_visit()` MUST stay SECURITY INVOKER** — that is what
  makes campus scoping apply inside them, and a DEFINER rewrite would punch a
  hole straight through the boundary. The meeting-gate and presence triggers are
  SECURITY DEFINER and bypass RLS by design; leave them alone.
  A join against an unreadable institute returns **null, not an error**, so
  `institute-scope.ts` logs it and prints "Not in your campus" rather than
  "Unknown institute" — a scoping fault must not read like a deleted row.
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
