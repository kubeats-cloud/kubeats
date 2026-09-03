@AGENTS.md

# Field Ops

Mobile-first field reporting for an education sales team. Reps log activity
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

## Engineering notes

- Next.js 16: `cookies()` is async-only, and middleware is now `proxy.ts`
  (Node runtime, no edge).
- `npm run typecheck` runs `next typegen` first — `LayoutProps`/`PageProps` are
  generated into `.next/types` and `tsc` alone cannot see them.
- Load-bearing rules (meeting gate, weekly lock, role visibility) belong in the
  database as RLS and triggers, not only in the UI.
- Validate every input on both client and server. Never surface stack traces,
  SQL or secrets to users.
