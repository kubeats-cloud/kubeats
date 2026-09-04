@AGENTS.md

# KUbeats

"For a smarter KU." Mobile-first field reporting for an education sales team. Reps log activity
against registered institutes; admins oversee the whole team.

## The prototype is a behaviour reference, not a visual one

`docs/field-ops-demo.tsx` is the validated click-through prototype. Match it for
**behaviour, field names and flows only** — activity keys, the weekly metric
set, the "open for today" meeting gate, the Set → Done lifecycle, the follow-up
visibility rules, the weekly lock.

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
- The six institute status badges and the target-progress bars are colour-coded
  per the semantic palette above.

### Screen ownership

Six screens, and no others: Dashboard, Institutes, Log Visit, Pending, Weekly,
plus Settings for admins only.

**The Dashboard owns the daily-plan create-and-track flow.** There is no Daily
tab. On the Dashboard a rep adds today's planned visits (institute + purpose
from the admin-managed purposes list), sees each entry's held / not-held state,
and moves from an unheld entry into Log Visit.

This is load-bearing, not a layout preference: the meeting gate (rule 2) checks
a visit against that member's `daily_plans` rows for that date, so a meeting
cannot be logged at all unless the Dashboard flow put it on the plan first.

Weekly targets stay on their own Weekly tab.

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

## Engineering notes

- Next.js 16: `cookies()` is async-only, and middleware is now `proxy.ts`
  (Node runtime, no edge).
- `npm run typecheck` runs `next typegen` first — `LayoutProps`/`PageProps` are
  generated into `.next/types` and `tsc` alone cannot see them.
- Load-bearing rules (meeting gate, weekly lock, role visibility) belong in the
  database as RLS and triggers, not only in the UI.
- Validate every input on both client and server. Never surface stack traces,
  SQL or secrets to users.
- A write that touches more than one table goes through a Postgres function so
  it is one transaction. Saving a visit is `public.log_visit()` (migration
  0002); it runs SECURITY INVOKER, so RLS and every trigger still apply. It
  raises `FO001`-`FO007` for the cases a rep can cause, and `src/lib/visit-actions.ts`
  maps those codes — never the message text — to sentences.
- Every visit must carry a photo (Rule 12, migration 0006). The rule is stated
  three times on purpose: the shared zod schema, `log_visit()` raising `FO007`,
  and the `visits_photo_required` CHECK, which is the one that holds against a
  direct insert. The geo-tag beside it is deliberately NOT required — a denied
  GPS permission still saves, because a rep with no signal must not be stuck.
- The photo arrives one of two ways, both in `CaptureFields`: the in-app camera
  (`getUserMedia`, rear-facing by default, in `camera-capture.tsx`) or a file
  from the device. Whichever it is, the coordinates stamped into the image are
  read **at the moment of attaching**, not at page load — browsers strip EXIF
  geotags, so a live reading is both the only option and the harder one to fake.
  If `getUserMedia` is unavailable or refused, it falls back to the native
  `capture="environment"` input; there is no desktop webcam path beyond that.
- `photo_url` is written once and never again — the `visits_photo_final` trigger
  (0006) raises `FO008` on any UPDATE that changes it, for the service role too.
  Written as "any change at all" rather than "any change after `closed_at`" on
  purpose: a meeting never gets a `closed_at`, so the narrower rule would leave
  every meeting's evidence editable forever.
- A locked week freezes the COMMITTED TARGETS, nothing else. The achieved
  column stays live: it is recomputed from `daily_plans` and `visits` on every
  read, so closing an old "Set" loop moves that row from Sessions Set to
  Sessions Done in the week it was originally logged — including in a week that
  is already submitted. `locked` therefore means "this rep can no longer change
  what they promised", not "these numbers are a frozen historical record".
  Any later reporting that needs a fixed snapshot has to take one itself.
- A week runs Monday to Saturday for reporting, but counts Monday through
  Sunday: a Sunday's work folds into the week that just ended rather than
  falling out of every total. `weekEnd()` is the Saturday shown to the rep;
  `weekCountEnd()` is the Sunday every rollup query uses.
- Visit photos are deleted automatically after
  `public.visit_photo_retention_days()` days (migration 0003, scheduled in
  0004). The visit rows, coordinates and timestamps are kept forever, so a row
  older than the window still has a `photo_url` whose file is gone: anything
  that displays a photo must treat a missing object as "expired", not an error.
