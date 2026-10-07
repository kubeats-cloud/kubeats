# Three-tier roles — implementation plan

Admin → Team Lead → Rep. Planning only: no code, no migration, no push.

---

## 0. The one-sentence summary

Add one role, one self-referencing column and **one helper function**, then
rewrite every `member = auth.uid() or is_admin()` predicate in terms of that
helper — after which the middle tier appears in the data layer and most of the
admin screens scope themselves without being touched, because they already
delegate scoping to RLS.

---

## 1. Your brief, checked against the code

Seven things in the brief meet something specific in this codebase. Five hold;
two needed a decision and both are now settled — see the end of this section.

| # | The brief says | The code says |
| --- | --- | --- |
| 1 | A team lead is "allocated to exactly ONE campus, like a rep" | `enforce_profile_campus()` (FO021, 0020b) has exactly two branches: `role = 'rep'` demands a campus, `role = 'admin'` forbids one. **A `team_lead` row falls through both** and could be created with a null campus — which silently makes them a supervisor with no campus. FO021 must gain a third branch, and it is the cheapest correctness win in the whole change. |
| 2 | "the rep→team-lead link is explicit, not 'whole campus'" | Correct, and necessary: `my_campus()` returns one uuid and several team leads share a campus, so campus cannot identify a team. A column is the only shape that works. |
| 3 | "an admin assigns reps to team leads" | `profiles_update` is `using (id = (select auth.uid()) or public.is_admin())` — **a rep may update their own row.** Without a guard, a rep could set their own `team_lead_id` to anyone, or clear it. `guard_profile_created_by()` (FO028, 0034) exists for precisely this hole on `created_by`, and says so; the new column needs the identical treatment. This is the single most important trigger in the plan. |
| 4 | "can see and do everything an admin can … but ONLY for their own reps" | Survivable because of one architectural fact: `admin-workspace.ts` states that everything in it "runs as the signed-in admin, not as the service role… RLS already says an admin may read the whole team's work". **Review, Assign, Overview and the activity report therefore scope themselves the moment RLS learns about team leads.** This is what makes the change tractable rather than a rewrite of every query. |
| 5 | "does NOT log visits and does NOT own institutes" | Both need explicit work, neither is free. `visits_insert` is `member = (select auth.uid())` and `institutes_insert` allows `registered_by = auth.uid() and campus_id = my_campus()` — a team lead has a campus, so **as written they could register institutes and log visits.** Two policies must learn to say "rep only". |
| 6 | "Existing reps stay directly under admin … no day-one disruption" | Achievable and it is also what makes the phasing safe — see §7. A nullable `team_lead_id` with no rows set means the new predicate reduces to the old one exactly. |
| 7 | "whether `profiles.created_by` (0034) can seed existing assignments" | **No, and the migration that added it says why.** 0034: `created_by` "decides nothing. It records something", is null for ~39 pre-0034 rows with a deliberate no-backfill decision, and FO028 refuses a rep parent specifically so it does not become "the reports-to chain the model deliberately does not have". Seeding from it would (a) leave every pre-0034 rep unassigned anyway, (b) assign reps to *admins*, who cannot be team leads, and (c) retrospectively make a record into a permission — the exact thing E1 declined to do. **Seed nothing. Every rep starts unassigned.** |

### The two decisions, now settled

**D1 — a team lead is a READER, NOT A SUBJECT. SETTLED.**
No weekly targets, no daily plan, no `alert_events` of their own. They read
their reps' numbers and nothing counts them. Two pieces of the code are already
correct for this and must be left alone rather than "fixed":
`materialise_daily_alerts()` (0040) evaluates `role = 'rep'`, and
`activity-export.ts` lists subjects with `.eq("role", "rep")`. Consequences:
`/targets` renders a supervision view for a team lead (their reps' weeks,
openable and reopenable) and never a commitment form of their own; the Dashboard
renders the admin's supervision layout, not the rep's plan; and the alert banner
is empty for them because no predicate selects a non-rep.

**D2 — a team lead is a SMALL ADMIN: everything an admin can do, for their team
only. SETTLED, with one boundary the code forces and this plan must name.**

The instruction is the right default and it is wider than the recommendation it
replaced: **the `.xlsx` export opens** (`requireAdmin()` → `requireStaff()` on
`/api/export/activity`; RLS already scopes the rows, and the byte-identity guard
is untouched because the workbook *shape* does not change, only which reps are
in it), and so does every screen in §6.

⚠ **Three surfaces cannot be made "their team only", because what they manage
has no team dimension at all.** This is not a restriction chosen over the
instruction — it is the instruction applied honestly:

| Surface | What it actually manages | Why "for their team only" has no meaning |
| --- | --- | --- |
| `/settings` — statuses, purposes, locations, sign-in security | `institute_statuses`, `purposes`, the location tree, MFA | These are the **vocabulary the whole company shares**. A status one team lead retires disappears from every rep in every campus; a purpose they add becomes a metric for everyone (0025's assertion block refuses a metric with no purpose behind it). There is no per-team copy to scope to, and giving one team lead the power means their edit lands on every other team — the exact opposite of "their team only". |
| `/data` | Backup and restore of the whole database | Scoping a backup to a team would produce a backup that cannot restore. |
| `/materials/manage` | `materials`, scoped by **campus**, with `campus_id is null` meaning every campus | Campus is not team. Two team leads share a campus (the brief's own case), so a "scoped" upload would land on the other lead's reps as well, cutting across the boundary everything else in this change draws. |

**The resolution — split `/settings`, do not simply close it.** Settings already
has separate panels, and exactly one of them *is* team-shaped: the **team
panel**, which is where "a team lead can add their own reps" has to live anyway.
So:

- A team lead reaches a **team-management view** — add a rep to their own team,
  see their own reps — carved out of the Settings team panel and reached from
  `/team`, which they already have.
- The global panels (statuses, purposes, locations, sign-in security), `/data`
  and `/materials/manage` stay **admin-only**, and the team lead's workspace
  simply does not show them.

That gives a team lead every power an admin has over **their team's data and
people**, and withholds only the three things that are not their team's at all.
If you would rather a team lead could also edit the shared vocabulary, say so —
it is a one-line gate change, but it is a company-wide write and should be a
deliberate yes, not a side effect of this sentence.

---

## 2. What exists now, precisely

The numbers that set the blast radius:

- **139 occurrences of `is_admin()`** across `supabase/migrations/`.
- **23 tables carry policies**, `storage.objects` among them.
- `is_admin()` and `my_campus()` are both `SECURITY DEFINER` + `stable` +
  `set search_path = ''`, granted to `authenticated`. Definer specifically "to
  avoid RLS recursion on profiles" — the new helpers must copy that exactly.

The predicates that matter, in their **authoritative** (last-defined) form:

| Table | Policy shape today | Defined in |
| --- | --- | --- |
| `visits` | select/delete `member = auth.uid() or is_admin()`; insert/update `member = auth.uid()` | 0001 |
| `daily_plans` | select `member or is_admin()`; insert `member or (is_admin() and assigned_by = auth.uid())`; update both halves `member or is_admin()`; delete `member or is_admin()` | 0001, 0005, 0014 |
| `targets` | select `member or is_admin()`; insert `member`; update both halves `member or is_admin()`; delete `is_admin()` | 0013 |
| `alert_events` | select/update `member = auth.uid() or is_admin()`; **no insert, no delete** (`with check (false)` / `using (false)`); grants are `select` + `update (seen_at)` only | 0040 |
| `institutes` | select/insert/update `is_admin() or (campus_id = my_campus() and registered_by = auth.uid())`; delete `is_admin()` | 0028 |
| `institute_status_history` | `is_admin()` or the same predicate reached **through the parent institute** | 0028 |
| `follow_up_tasks` | 4 policies, all through the parent institute | 0038 |
| `institute_counsellors` | 4 policies, all through the parent institute | 0037 |
| `materials` | `is_admin() or campus_id is null or campus_id = my_campus()` | 0020b |
| `profiles` | select `id = auth.uid() or is_admin()`; insert `is_admin()`; update `id or is_admin()`; delete `is_admin()` | 0001 |
| `storage.objects` (visit-photos) | `foldername[1] = auth.uid()::text or is_admin()` | 0001 |

Two kinds of predicate, and the distinction runs through the whole plan:

- **Member-keyed** — `visits`, `daily_plans`, `targets`, `alert_events`. The row
  names a person.
- **Institute-keyed** — `institutes` and its three children. The row names a
  place, owned by a person via `registered_by`.

Both reduce to the same question — *may I see this person's work?* — which is
why one helper serves both.

### The app layer

- `src/lib/auth.ts` — `export type Role = "rep" | "admin"` and
  `profileSchema` uses `z.enum(["rep", "admin"])`. **A `team_lead` row fails that
  parse**, returns `profileStatus: "unavailable"` and falls back to
  `role: "rep"`. Since a team lead *has* a campus, they would degrade into a
  working rep — able to reach `/log`. This is the deploy-ordering hazard (§7).
  Note also that `getCurrentUser()` does not select `campus_id` at all.
- `src/proxy.ts` — reads `profiles.role` and computes `const admin = data?.role === "admin"`, then
  `if (wantsAdminArea && !admin) redirect("/")` and
  `if (wantsRepArea && admin) redirect("/")`. A team lead is bounced off every
  admin screen **and let into `/log`** — both wrong, from one boolean.
- `src/lib/nav.ts` — `REP_ONLY_PATHS = ["/log"]`; `ADMIN_ONLY_PATHS` is six
  entries; `ADMIN_ONLY_PATTERNS` is one regex (`/institutes/report`);
  `navItemsFor(showAdmin: boolean)` is binary.
- `src/lib/admin.ts` — `requireAdmin()` refuses unless `user.role === "admin"`.
- `src/lib/admin-workspace.ts` — the reading side of Review/Overview/Assign.
  Runs as the signed-in user. **Delegates scoping entirely to RLS.**
- `src/app/(app)/missed/page.tsx` (E1) — the only place a "team" exists today,
  as `.eq("created_by", user.id)`, deliberately a screen filter and not a
  boundary.
- `src/app/(app)/team/hierarchy/page.tsx` — the `created_by` chart, whose own
  description says it "does not decide what anyone can see".

### Two scars to respect

1. **PGRST200 on a profiles self-embed.** `listTeamMembers()` carries a long
   note: `creator:profiles!profiles_created_by_fkey(name)` took *every admin
   screen* down, because PostgREST disambiguates a self-relation by the
   **referencing column** (`profiles!created_by`), not the constraint name — and
   the fix was to drop the embed and resolve it in TypeScript.
   **`team_lead_id` is a second self-referencing FK on the same table and walks
   straight into this.** Rule for this plan: *never embed `team_lead_id`; join it
   in TypeScript from the profile list already in hand.*
2. **0035's assertion trap.** `search_path` must be checked with
   `LIKE 'search_path=%'` against `pg_proc.proconfig`, never array containment —
   an empty `search_path` flattens to `search_path=""`. Copy 0035 §2.

---

## 3. DATA MODEL — migration 0041

Next free number after `0040_alert_events.sql`. Proposed name:
`0041_team_leads.sql`. House shape: forward-only, idempotent, assertion block
copying 0035 §2.

**Additive and behaviour-neutral.** It widens a CHECK, adds a nullable column,
adds two functions and two triggers. It changes **no policy** — that is 0042's
job — so applying it alters nothing anyone can observe.

### 3a. The role

```
profiles_role_valid  check (role in ('rep', 'team_lead', 'admin'))
```

Dropped and re-added; a CHECK cannot be patched. Guard it with
`if not exists (… pg_get_constraintdef … like '%team_lead%')`, the same shape
0040 §2 uses for `targets_non_negative`, and assert afterwards that all three
values survive — dropping `rep` by accident while editing the list is the way
this goes wrong, and nothing would fail until the next insert.

### 3b. The link

```
alter table public.profiles
  add column if not exists team_lead_id uuid
    references public.profiles (id) on delete set null;

create index if not exists profiles_team_lead_idx
  on public.profiles (team_lead_id) where team_lead_id is not null;
```

- **Nullable, and no backfill.** That is what "existing reps stay directly under
  admin" means, and it is also what makes §7's phasing safe.
- **`on delete set null`**, mirroring `created_by`. Deleting a team lead returns
  their reps to admin-only supervision rather than refusing the delete or
  orphaning rows. State it in the column comment, because the alternative
  (`restrict`) is a defensible choice somebody will later wonder about.
- **Partial index**, mirroring `profiles_created_by_idx` (0034) and
  `profiles_campus_idx` (0020a), for the same reason: every supervision query
  asks "who reports to me".

### 3c. FO021 learns the third role

`enforce_profile_campus()` gains the branch it currently falls through:

```
if new.role in ('rep', 'team_lead') and new.campus_id is null then
  raise … 'A rep and a team lead each belong to one campus.' FO021
```

The admin branch is unchanged. Assert the three-way outcome in the block.

### 3d. FO033 — the integrity of the link *(new)*

One trigger, `enforce_team_lead_link()`, `before insert or update of
role, campus_id, team_lead_id`, raising `FO033`. Five refusals, each a different
mistake:

1. **Only a rep may have a team lead.** `role <> 'rep' and team_lead_id is not
   null` → refuse. An admin or a team lead reporting to a team lead is a chain
   this model does not have.
2. **The parent must be a team lead.** Mirrors FO028's "never a rep" check, for
   the same stated reason.
3. **Same campus.** `rep.campus_id = lead.campus_id`, or refuse. The brief's
   "reps must be on the team lead's campus" is a cross-row rule, so it cannot be
   a CHECK. ⚠ It must also fire when the **lead's** campus moves —
   `correct_member_campus()` (0035) can move a team lead and strand their whole
   team on another campus. Covered in §8.
4. **No self-reference.** `team_lead_id = id` → refuse.
5. **Only an admin, or the owning team lead, may set it.** The FO028 pattern
   exactly: `caller is null` (service role, SQL editor, restore) passes;
   otherwise `is_admin()`, or `is_team_lead() and new.team_lead_id = auth.uid()`
   — which is what lets a team lead add a rep to *their own* team and nobody
   else's. **Without this a rep edits their own row into any team they like**,
   because `profiles_update` permits a self-update.

Also extend `guard_profile_role()` (0001): creating or becoming a `team_lead`
is an admin's act, like creating an admin.

### 3e. The helpers

Two functions, both `SECURITY DEFINER` + `stable` + `set search_path = ''` +
`revoke all … grant execute to authenticated` — copying `is_admin()` exactly,
and definer for the reason 0001 gives: *to avoid RLS recursion on profiles*.

```
public.is_team_lead() returns boolean
  -- mirrors is_admin()

public.supervises(p_member uuid) returns boolean
  select p_member = (select auth.uid())
      or public.is_admin()
      or exists (select 1 from public.profiles r
                  where r.id = p_member
                    and r.team_lead_id = (select auth.uid()));
```

**`supervises()` is the whole plan in one function**, and three properties
decide everything downstream:

- It **replaces** `member = (select auth.uid()) or public.is_admin()` rather
  than extending it. The predicate gets *shorter*, which matters when it is
  about to be written into a dozen policies.
- With **no `team_lead_id` set anywhere it is exactly equivalent** to today's
  predicate. That is what lets 0042 ship before anybody is promoted, and it is
  the safety property the whole phasing rests on (§7).
- `supervises(null)` is false for a non-admin and true for an admin — identical
  to today's `registered_by = auth.uid()` against a null owner. An ownerless
  institute does not become visible to a team lead.

A `my_team()` returning `setof uuid` is the obvious alternative and is **not**
recommended: it forces `member in (select …)` at every call site, which is
harder to read and, on the institute-keyed tables, has to be nested inside an
`exists` that already exists.

### 3f. Assertion block

Copying 0035 §2 — `array_append()` throughout, never `||`. It must prove:

- `profiles_role_valid` lists all three values and still lists `rep` and `admin`.
- `profiles.team_lead_id` exists, is nullable, and its FK is `on delete set null`.
- Exactly one overload each of `is_team_lead` and `supervises`; both
  `prosecdef`; both pinning `search_path` via `LIKE 'search_path=%'`.
- Both executable by `authenticated` (unlike 0040's function, these are
  *called by policies in the caller's session* and must be).
- `profiles_campus_required` and the new `profiles_team_lead_link` triggers are
  attached.
- **The rules this file leans on are still standing** — the closing move 0038
  and 0040 both make: `daily_plans_one_open_visit` still unique,
  `guard_profile_role` still attached, FO028 still attached.

---

## 4. Permission model

### 4a. In the database

Mechanical, and that is the point: **every member-keyed predicate becomes
`public.supervises(member)`**, and every institute-keyed one becomes
`public.supervises(registered_by)` reached through the parent exactly as today.

Writes do **not** all follow reads. Three separations to hold:

| Verb | Today | Proposed | Why |
| --- | --- | --- | --- |
| `visits_select` | `member or is_admin()` | `supervises(member)` | A team lead reads their reps' visits — this is Review. |
| `visits_insert` | `member = auth.uid()` | `member = auth.uid() and public.is_rep()` | Unchanged for a rep. The added clause is what makes "a team lead does not log visits" true in the database rather than only in the UI. |
| `institutes_insert` | `is_admin() or (registered_by = auth.uid() and campus_id = my_campus())` | add `and public.is_rep()` to the second branch | "Does NOT own institutes". A team lead has a campus, so without this they can register one. |

(`is_rep()` is a third one-line helper, or inline `role = 'rep'`; a helper is
better — it is the same recursion problem and deserves the same definer.)

### 4b. In the app

`src/lib/auth.ts`:

- `Role` becomes `"rep" | "team_lead" | "admin"` and `profileSchema`'s enum
  gains the value. **This must ship before any row uses it** (§7).
- Add `isTeamLead(user)` and — more useful — `isStaff(user)`, true for admin or
  team lead, which is what most call sites actually want.
- `isAdmin()` keeps its exact current meaning. Nothing that is admin-only today
  should silently widen because a predicate got renamed.

`src/lib/nav.ts` — the six-entry list splits in two. Under D2 the staff list is
everything that can be team-scoped, which is everything except the three
surfaces that have no team dimension:

```
STAFF_PATHS      = ["/review", "/assign", "/team"]    // admin + team lead
ADMIN_ONLY_PATHS = ["/data", "/settings", "/materials/manage"]
```

`/institutes`, `/institutes/report`, `/pending`, `/targets` and `/missed` are
not in either list: they are shared routes that scope themselves by role, which
is the shape they already have for rep-vs-admin. The team lead's add-a-rep view
hangs off `/team`, NOT off `/settings` — which is what keeps the global
vocabulary panels behind a single unchanged gate rather than behind a new
per-panel check inside a route a team lead can now enter.

- `ADMIN_ONLY_PATTERNS` — `/institutes/report` moves to a `STAFF_PATTERNS`
  equivalent, since a scoped pipeline report is exactly what a team lead needs.
  Keep the anchoring (`^…(?:/|$)`) and keep `nav.test.ts`'s pin on the count.
- `REP_ONLY_PATHS` stays `["/log"]`, but the **gate inverts**: today it refuses
  *admins*; it must refuse *everyone who is not a rep*.
- `navItemsFor(showAdmin: boolean)` becomes `navItemsFor(role: Role)` with a
  third bar. A team lead's bar is the admin's minus Settings, which leaves five
  — comfortably inside the "six tabs" rule CLAUDE.md states.

`src/proxy.ts` — the one boolean becomes three-way:

```
const role = data?.role ?? "rep";        // least privilege, unchanged
if (wantsAdminArea && role !== "admin")              redirect("/");
if (wantsStaffArea && role === "rep")                redirect("/");
if (wantsRepArea   && role !== "rep")                redirect("/");
```

`src/lib/admin.ts` — `requireAdmin()` stays as-is for the things that are
genuinely admin-only (the export route, Settings actions). Add
`requireStaff()` alongside it, returning the role so a caller can branch.
**Do not loosen `requireAdmin()` in place** — it gates every Settings mutation,
and widening it by rename is how a team lead quietly gains the status
vocabulary. Move call sites to `requireStaff()` ONE AT A TIME and name each:
under D2 exactly one moves today, `/api/export/activity`. Every Settings action
keeps `requireAdmin()`.

---

## 5. RLS REWORK — migration 0042

Separate from 0041 deliberately: 0041 is additive and reversible by neglect,
0042 rewrites 30-odd policies and is the one to review line by line.

**It is a no-op on the day it lands.** With no `team_lead_id` set,
`supervises(x)` ≡ `x = auth.uid() or is_admin()`. Every policy below computes
exactly what it computes today until an admin assigns the first rep.

### Member-keyed

| Table | Policy | Change |
| --- | --- | --- |
| `visits` | select, delete | `supervises(member)` |
| | insert, update | `member = auth.uid()` **+ `is_rep()`** on insert |
| `daily_plans` | select, delete, update (both halves) | `supervises(member)` |
| | insert | `member = auth.uid() or (public.supervises(member) and not public.is_rep() and assigned_by = auth.uid())` — this is what lets a team lead **assign** work to their reps, which the brief asks for. Note 0005's `guard_daily_plan_assignment` trigger stamps `assigned_by` and must learn that a team lead is a legitimate assigner. |
| `targets` | select, update (both halves) | `supervises(member)` — a team lead sees and **reopens** a rep's locked week, which is the Rule 6 admin power the brief grants them. ⚠ `enforce_target_lock` (0013) hard-codes "only an admin may reopen" — it must learn the middle tier or the policy is widened and the trigger still refuses. |
| | delete | stays `is_admin()` |
| `alert_events` | select, update | `supervises(member)` |
| | insert, delete | **unchanged — still refused to everyone.** E1's guarantee is that nobody may manufacture or erase a miss, and a team lead is emphatically included. |

### Institute-keyed

All four tables keep their existing shape and swap the owner test:

```
public.is_admin()
or exists (select 1 from public.institutes i
            where i.id = institute_id
              and i.campus_id = public.my_campus()      -- ⚠ see below
              and i.registered_by = (select auth.uid()))
```

becomes

```
public.supervises( <the owner> )
```

- `institutes` — `supervises(registered_by)` on select/update; insert gains
  `is_rep()`; delete stays `is_admin()`.
- `institute_status_history`, `follow_up_tasks`, `institute_counsellors` —
  `exists (select 1 from public.institutes i where i.id = institute_id and
  public.supervises(i.registered_by))`.

⚠ **`campus_id = my_campus()` must come out of these predicates, not stay
alongside.** A team lead's `my_campus()` is their own campus and their reps are
on it, so it would *appear* harmless — but it is a second, weaker boundary that
now decides nothing, and leaving it invites the belief that campus is still the
scope. Ownership is the scope. 0028's own comment already notes the campus
clause "happens to be exactly the ownership rule as well"; after this change it
is strictly redundant, and FO010/FO025 keep owner and campus aligned.

### The two everybody forgets

- **`storage.objects` / `visit-photos`** — `foldername[1] = auth.uid()::text or
  is_admin()`. Review renders photographs; a team lead with table access and no
  storage access gets a screen of broken images and no error. It becomes
  `… or public.supervises(((storage.foldername(name))[1])::uuid)`. ⚠ The cast
  can raise `22P02` on a malformed folder name, so it needs the
  `is_admin() or` short-circuit kept first and a defensive cast. **Verify by
  opening a real photo as a team lead**, not by reading the policy.
- **`profiles_select`** is `id = auth.uid() or is_admin()`. A team lead must read
  their reps' profiles or every name on every screen resolves to "Unknown" —
  `admin-workspace.ts` falls back to exactly that string in five places, so the
  failure is silent and cosmetic-looking. It becomes `supervises(id)`.
  `profiles_update` likewise needs `supervises(id)` **only if** a team lead may
  rename a rep; if not, leave it admin-only and let FO033 handle the one column
  they may write.

### Cross-team leak risks — the full list

1. **`profiles_select`** — too narrow leaks nothing but breaks names; too wide
   (`is_team_lead()` alone, say) exposes every colleague's roster. Must be
   `supervises(id)`.
2. **Storage** — above. The only leak path that is not a table.
3. **`institute_status_history`** — 0020b and 0028 both flag it as "the quiet
   one": it reaches through the parent, so scoping only `institutes` *moves* the
   leak instead of closing it. Same trap, one tier up.
4. **A shared campus.** Two team leads on one campus is the brief's own example
   and is the sharpest test: anything still keyed on `my_campus()` shows each
   lead the other's reps. This is why campus comes out of the institute
   predicates rather than staying as "extra safety".
5. **A rep whose institute was registered before they joined a team** — ownership
   is `registered_by`, which does not move, so the institute follows the rep into
   the team. Correct, but it means a team lead inherits history they did not
   supervise. State it; do not "fix" it.
6. **Reassignment.** Moving a rep between teams moves *all* their history at
   once, retroactively. The old lead loses sight of work they supervised. This
   is inherent to a current-state link and should be a stated product decision,
   not a surprise.
7. **`assigned_by`** on `daily_plans` — if a team lead may assign, the insert
   policy must pin `assigned_by = auth.uid()` or one lead can forge an
   assignment in another's name.
8. **`supervises()` must be `SECURITY DEFINER`** — it selects from `profiles`,
   which is RLS-protected and whose policy will itself call `supervises()`.
   Invoker would recurse. This is the exact reason 0001 gives for `is_admin()`.
9. **The service role bypasses all of it.** `materialise_daily_alerts()` (0040)
   and the two cron jobs are unaffected and must stay that way.

---

## 6. UI

### Admin — promoting and dividing

- **Settings → Team.** `ROLES` in `src/lib/validation/admin.ts` gains
  `team_lead`; `newMemberSchema`/`memberUpdateSchema`'s `superRefine` gains the
  third campus branch (team lead *requires* a campus, like a rep).
  ⚠ `memberUpdateSchema` deliberately excludes `role` today, with a written
  rationale ("it deserves its own decision, not a dropdown beside a name").
  **Honour that**: promotion is its own control with its own confirmation, not a
  new option in the editor's dropdown.
- **Assign reps to leads.** Best placed on `/team` as a per-rep control
  ("Team lead: —▾"), with the existing member editor untouched. An admin may
  reassign; the action calls one RPC that writes `team_lead_id` under FO033.

### Team lead — adding their own reps

Reuses the existing member-creation form, with two fields fixed and not
offered: campus (theirs) and team lead (themselves). The server action must
re-derive both rather than trust the form — FO033 refuses a bad value anyway,
but a form that can only express one answer should not ask the question.
⚠ Creating a profile currently needs `profiles_insert` = `is_admin()`; a team
lead creating a rep needs either a widened policy or — better — a
`SECURITY DEFINER` RPC with `is_team_lead()` first, matching the house rule for
boundary-crossing writes and keeping `profiles_insert` closed.

### The hierarchy view

`/team/hierarchy` exists and renders `created_by` as "a record of how the team
was set up — **it does not decide what anyone can see**". Two honest options:

- **Recommended:** keep that chart and add a second, `team_lead_id`-based chart
  on the same page under a heading that says which one is the real boundary.
  The contrast is the documentation.
- Replace it. Cheaper, but throws away the one place the "records ≠ permissions"
  distinction is currently visible.

⚠ **Do not embed.** Resolve `team_lead_id` → name in TypeScript from the
profile list already fetched. `listTeamMembers()` carries the PGRST200 scar at
length; a second self-FK is the same trap with a different column.

### Each admin screen, as a team lead sees it

| Screen | What changes |
| --- | --- |
| Review `/review` | Nothing in the code. RLS narrows the rows; `listTeamVisits`'s `count: "exact"` then reports the team's true total, and the pager follows. The rep filter should list only their reps — a cosmetic fix, since choosing another rep's id already returns nothing. |
| Assign `/assign` | Rep list narrows; needs the `daily_plans_insert` + `assigned_by` work above. |
| Overview `/` | `getOverview()` is RLS-scoped throughout, so the tiles become team tiles. "Still checked in" likewise. |
| Team `/team`, `/team/[memberId]` | Lists their reps. The member editor should be read-only or absent for a team lead unless D2 says otherwise. |
| Institutes + pipeline report | Scoped by owner. `/institutes/report` moves to the staff pattern. |
| Targets | `viewingOther = isAdmin(user) && …` must become `isStaff(user) && …`, or a team lead cannot open a rep's week. |
| Pending | Already has an admin read-only branch (D10); a team lead takes the same branch. `startFollowUp()` refuses non-reps already. |
| Activity export `/api/export/activity` | **Opens** (D2). `requireAdmin()` → `requireStaff()`; RLS scopes the rows. The `.xlsx` shape is unchanged, so the byte-identity guard stays green — assert that, because "the export now returns different rows" and "the export now writes different bytes" are one careless change apart. |
| Team lead's add-a-rep | New, off `/team`. A `SECURITY DEFINER` RPC with `is_team_lead()` first — campus and `team_lead_id` derived server-side, never read from the form. |
| Settings, Data, Manage materials | **Not reachable** — the three surfaces with no team dimension (§1 D2). The team lead's bar does not show them and `proxy.ts` 307s. |

---

## 7. Interaction with C, B, A and E1

| Phase | What must change |
| --- | --- |
| **C** (totals, date filter, sorting) | Nothing structural. The pipeline report and activity grid read RLS-scoped rows, so a team lead's totals are their team's. **Verify the TOTAL row reconciles against the scoped count** — a grand total computed over a narrowed set is right, but it is exactly the kind of number nobody re-checks. The `.xlsx` byte-identity guard is untouched; `/api/export/activity` keeps `requireAdmin()` unless D2 widens it. |
| **B1** (one-time rep edit) | `rep_edits_used` / FO030 is about the *owner*, not the supervisor. Decide whether a team lead's edit consumes the rep's single allowance — **recommendation: a team lead edits as an admin does, without consuming it**, so FO030's column-scoped trigger needs to treat them as it treats an admin. This is a one-line change in the trigger and easy to miss. |
| **B2** (counsellors) | Policy swap only — it is institute-keyed and follows the parent. |
| **A** (next action, follow-up tasks) | `follow_up_tasks` policies follow the parent institute, so the swap covers it. FO031 ("a task's institute must belong to the member it is for") is about the rep and stays exactly as it is — a team lead must not be able to create a task *for themselves* against a rep's institute. |
| **E1** (alerts + missed record) | **The biggest beneficiary and the one real deletion.** `/missed` currently scopes "My team" with `.eq("created_by", user.id)` as an explicit *screen filter*, and 0040's header argues at length that `created_by` must not be a boundary because it is null for pre-0034 rows. `team_lead_id` is the real thing: for a team lead the My team / Everyone switch **disappears entirely** — RLS already returns exactly their reps — and for an admin it becomes a genuine grouping *by team lead* rather than by who happened to create the account. `missedFollowUpRecord(from, to, memberIds?)` keeps its signature; the admin branch stops reading `created_by`. `materialise_daily_alerts()` evaluates `role = 'rep'`, so team leads correctly receive no alerts of their own (confirm against D1). |

---

## 8. Phasing

Four steps. The ordering is chosen so that **each step is observable-behaviour-neutral until the one after it**, which is the only way to land a change of this
blast radius safely.

> **H0 — the deploy-ordering rule, before anything.**
> `auth.ts`'s `z.enum(["rep","admin"])` rejects a `team_lead` row, degrading that
> user to `role: "rep"` — *with a campus*, so they become a working rep who can
> reach `/log`. **Ship the code that tolerates the value before any row carries
> it.** The migration itself is safe to apply at any time (it only widens a
> CHECK); what must not happen early is an admin *promoting* somebody. This is
> the reverse of 0027's deploy-coupling and the same shape as 0033's.

**H1 — the role and the link (migration 0041 + app tolerance).**
Role value, `team_lead_id`, FO021's third branch, FO033, `is_team_lead()`,
`is_rep()`, `supervises()`. App: `Role` union, schema enum, `isStaff()`, the
three-way proxy gate, the nav split. **No policy changes.** Nobody is a team
lead yet, so nothing observable moves. Ships and sits.

**H2 — RLS (migration 0042).**
The ~30 policy rewrites, storage included. **Still a no-op**: with no
`team_lead_id` populated, every rewritten predicate computes what it computed
before. This is the step to review hardest and the one that *looks* like it did
nothing — which is precisely the evidence that it is safe.

**H3 — assignment UI.**
Promotion control, admin's assign-reps-to-leads control, the team lead's own
add-a-rep RPC, the hierarchy's second chart. **The first time a team lead exists
is the first time H2's predicates do anything.** Promote exactly one person, on
a staging campus, and run §9 before assigning a second.

**H4 — the scoped screens and E1's boundary move.**
Rep-filter narrowing, `isStaff()` at the Targets call site, `enforce_target_lock`
and FO030 learning the middle tier, `/missed` dropping `created_by`.

Why not fold H1 and H2 together: a single migration that both introduces the
helper and rewrites every policy has no safe rollback — reverting it means
restoring 30 policies by hand while the app is live. Split, H2 can be reverted
by re-running the policy blocks from 0001/0005/0013/0014/0020b/0028/0037/0038/0040,
which is a mechanical recovery with a known-good source.

---

## 9. Risks and verification

### The ranked risks

1. **A rep assigns themselves to a team.** `profiles_update` allows a
   self-update; without FO033 clause 5 this is a one-line PostgREST call.
   *Highest severity, lowest effort to prevent, exact precedent in FO028.*
2. **`supervises()` written as INVOKER** → infinite recursion on `profiles`, or
   a policy that silently returns nothing. Assert `prosecdef` in 0041.
3. **Storage forgotten** → Review shows broken images for every team lead, with
   no error anywhere. Not a leak; a very visible break.
4. **`profiles_select` left alone** → every name renders "Unknown". Silent, and
   looks like a data problem rather than a policy one.
5. **Two leads on one campus see each other's reps**, because a `my_campus()`
   clause was left in "for safety". The §5 removal is the fix.
6. **A team lead's campus is corrected** by `correct_member_campus()` (0035) and
   their reps are now cross-campus. FO033 clause 3 fires on the rep's row, not
   the lead's — so 0035 needs either a refusal when the member has reps, or a
   cascade. **Decide this explicitly; it is the least obvious hole in the plan.**
7. **`enforce_target_lock` / FO030** widened in policy but not in trigger → a
   team lead sees a reopen button that always fails.
8. **PGRST200** from embedding the new self-FK → every admin screen empty, as it
   was once before.
9. **`delete_member()` (0032)** on a team lead with reps — `on delete set null`
   handles the column, but the function's own checks should say what happens, and
   the reps should surface somewhere afterwards rather than quietly becoming
   admin-only.

### Verification — mandatory, as all three roles

This is the highest-blast-radius change in the project and **a passing test
suite is not sufficient evidence.** The fixture set must be:

- 2 campuses; **2 team leads on the SAME campus** (TL-A, TL-B) plus one on the
  other; 2 reps under each; **1 rep left unassigned** (the day-one case).
- Institutes, visits, daily plans, follow-up tasks, counsellors, targets and
  alert rows under every rep, including the unassigned one.

Then, signed in as each real role through the browser — not via the service
role, which bypasses every policy under test:

| Claim | How it is proven |
| --- | --- |
| **No team sees another team's data** | As TL-A, every screen (`/review`, `/assign`, `/`, `/team`, `/institutes`, `/institutes/report`, `/missed`, `/pending`, `/targets?member=`) shows TL-A's reps only. Then **request TL-B's rep by id in the URL on each** — the count must be 0 or a 404, never a row. |
| Photos | Open an actual visit photo as TL-A for their own rep (loads) and construct the URL of TL-B's rep's photo (refused). The one check that cannot be done from the table layer. |
| Names resolve | No "Unknown" anywhere on a team lead's screens. |
| A rep is unchanged | Every Phase A/B/C/E1 behaviour as a rep: check-in, log, report, Pending, Targets, alert banner. Diff against the same run on `main`. |
| An admin is unchanged | Totals across *all* teams equal the pre-change totals, including the unassigned rep. |
| The unassigned rep | Visible to the admin, invisible to **both** team leads. |
| Writes are scoped | TL-A assigns a plan to their rep (succeeds) and to TL-B's rep (refused). TL-A reopens their rep's week (succeeds) and TL-B's (refused). |
| A team lead is not a rep | `/log` 307s. No visit row can be created with `member` = the lead. No institute can be registered in their name. |
| Alerts | TL-A sees their reps' missed record and not TL-B's; neither lead can insert, delete or edit an alert (expect `42501`, as E1's verification showed). |
| Rule 7 is unmoved | The eight weekly figures and the `.xlsx` byte-identity guard, before and after. |

Plus the standing gate: `lint` / `typecheck` / `build:next` / full `vitest`
including the live-DB suite, `npm run check:schema` (adding probes for
`profiles.team_lead_id`), the `.xlsx` guard green, and **fixtures fully reverted
with `MATCHES SNAPSHOT: true`** — noting E1's lesson that a verification run
which calls a cron function writes rows for *every* rep in the database, not
only the fixtures.

---

## 10. Open decisions, collected

~~D1~~ and ~~D2~~ are **settled** — see §1. A team lead is a reader, not a
subject; and a team lead is a small admin with every team-scopable power,
including the `.xlsx` export, with only the three un-scopable surfaces withheld.

Six remain, none of them blocking H1:

1. **Shared vocabulary** — the one piece of D2 left genuinely open: should a
   team lead be able to add or retire a status or a purpose? It is a one-line
   gate change and a **company-wide write**, so it wants a deliberate yes rather
   than being inferred from "everything an admin does".
2. **Reassignment semantics** — moving a rep moves all their history
   retroactively, and the former lead loses sight of work they supervised. Is
   that the intended reading of "can reassign"?
3. **A team lead's campus change** (risk 6) — refuse while they have reps, or
   cascade the reps with them?
4. **B1's allowance** — does a team lead's institute edit consume the rep's one
   edit, or not?
5. **Hierarchy screen** — keep both charts (recommended) or replace `created_by`?
6. **May a team lead rename or delete one of their reps**, or only add and view?
   (Decides whether `profiles_update`/`delete_member` widen at all.)

---

## 11. Size

**XL.** 0041 is M; 0042 is L and is the review-intensive one; the UI is M; the
verification in §9 is itself a day's work and is not optional. The phasing in §8
is what makes it shippable in four reviewable pieces rather than one.
