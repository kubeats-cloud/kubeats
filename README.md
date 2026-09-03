# Field Ops

Mobile-first field reporting for an education sales team. Reps log meetings,
sessions, campus visits, olympiad registrations, application forms and
admissions against registered institutes; admins oversee the whole team.

## Stack

| Piece | Choice |
| --- | --- |
| App | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 |
| Components | shadcn/ui (Radix primitives), Inter via next/font |
| Database / Auth / Storage | Supabase (Postgres + Row Level Security) |
| Geo-tagging | Browser Geolocation API |
| Pincode lookup | api.postalpincode.in, cached in our own table |

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the three Supabase values
npm run dev
```

The app reads three environment variables. Any that is missing or malformed
produces a single clear error naming the variable (see `src/lib/env.ts`) — it
never prints the value.

| Variable | Where it may be used |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | anywhere |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anywhere — constrained by Row Level Security |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** — bypasses Row Level Security |

## Scripts

```bash
npm run dev        # dev server
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run build      # production build
npm run check      # lint + typecheck + build
```

## Layout

```
src/
  app/                    routes (App Router)
  components/ui/          shadcn/ui components (ours, editable)
  lib/
    utils.ts              cn() class merger
    env.ts                validated, cached environment access
    supabase/
      client.ts           browser client   — anon key, RLS applies
      server.ts           server client    — anon key + session cookies, RLS applies
      admin.ts            service-role     — bypasses RLS, server-only
supabase/
  migrations/             SQL migrations (0001_init.sql lands here)
docs/
  field-ops-demo.tsx      validated prototype — behaviour reference only, not built
```

### Which Supabase client?

Reach for `lib/supabase/server.ts` (or `client.ts` in a client component) by
default — both run as the signed-in user, so Row Level Security is doing the
access control. `admin.ts` is only for work that genuinely cannot run as the
user, such as an admin creating a rep's login. It is guarded by `server-only`,
so importing it from client code fails the build.

## Design

Tokens live in `src/app/globals.css`: white surfaces on a light slate ground,
indigo brand colour, slate neutrals, and semantic status colours (green done,
amber scheduled, red overdue, slate neutral). Prefer the semantic utilities —
`bg-card`, `text-muted-foreground`, `<Badge variant="success">` — over raw
Tailwind colours so the palette stays in one file. Dark mode is out of scope
for v1.

The prototype in `docs/` is a behaviour reference; its visuals are not used.
See the Design & UI section of `CLAUDE.md`.
