# Current implementation map

Read-only recon of the repo as it stands. Paths are from disk. Quotes are from the files named. Nothing here was inferred from memory of an older build.

**Not found, stated once:** the handoff names **User / Plus / Land / Zero Hold** do not exist. The rep dashboard renders two counters, **Planned** and **Held**, plus a **Today’s plan** card.

**Schema ceiling:** the highest migration in `supabase/migrations/` is `0044_institute_slabs.sql` (966 lines). `save_slabs` has no `DROP FUNCTION`.

---

## 1. Rep dashboard

**Page:** `src/app/(app)/page.tsx`  
`export default async function DashboardPage()`

A rep gets `TodaySnapshot` then `DailyPlan`. An admin gets `AdminOverview` on the same route (see §7).

**Counters:** `src/components/dashboard/today-snapshot.tsx`

```ts
export function TodaySnapshot({
  planned,
  held,
}: {
  planned: number;
  held: number;
}) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 md:mb-6 md:max-w-md">
      <Tile label="Planned" value={planned} />
      <Tile label="Held" value={held} valueClassName={heldTone} />
    </div>
  );
}
```

Fed from the page:

```ts
const entries = plan.ok ? plan.entries : [];
const held = entries.filter((entry) => entry.meetings_actual !== null).length;
// ...
<SectionTitle>Today</SectionTitle>
<TodaySnapshot planned={entries.length} held={held} />
```

`planned` is the number of today’s `daily_plans` rows. `held` is how many of those have `meetings_actual !== null` (meetings only; a finished non-meeting still counts as planned and not held).

**Today’s plan card:** `src/components/dashboard/daily-plan.tsx`

```tsx
<Card>
  <CardHeader>
    <CardTitle className="text-base">Today’s plan</CardTitle>
  </CardHeader>
  <CardContent className="space-y-6">
```

A comment in `today-snapshot.tsx` says an older **Open loops** tile was removed. There is no third counter.

---

## 2. Today’s plan

| Surface | Path | Signature |
| --- | --- | --- |
| Card and “Add to today’s plan” | `src/components/dashboard/daily-plan.tsx` | `export function DailyPlan({ institutes, purposes, entries, catalogue, tasks })` |
| Add action | `src/lib/visit-actions.ts` | `addToDailyPlan` (form `action`) |
| Batch add (behind the Phase A flag) | `src/components/dashboard/morning-plan.tsx` | `export function MorningPlan({ institutes, purposes, catalogue, plannedIds })` |
| Follow-up calls (behind the flag) | `src/components/dashboard/follow-up-calls.tsx` | `export function FollowUpCalls({ tasks }: { tasks: FollowUpTask[] })` |
| Pending “Visit again” | `src/components/visits/follow-up-list.tsx` | `export function FollowUpList(...)`, inner `StartFollowUp` |
| Start action | `src/lib/visit-actions.ts` | `export async function startFollowUp(_prev: FormState, formData: FormData): Promise<FormState>` |
| Pending page | `src/app/(app)/pending/page.tsx` | `export default async function PendingPage` |

**How today’s plan reads `daily_plans`:** `getTodayPlan` in `src/lib/visits.ts`

```ts
export async function getTodayPlan(
  memberId: string,
): Promise<{ ok: true; entries: PlanEntry[] } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_plans")
    .select(
      "id, institute_id, purpose, purpose_note, meetings_actual, follow_up_date, assigned_by, checkin_at, checkin_lat, checkin_lng, checkout_at, checkout_lat, checkout_lng, checkout_missing, checkin_location_manual, checkin_manual_reason, purposes(activity, lifecycle)",
    )
    .eq("member", memberId)
    .eq("date", todayISO())
    .order("created_at", { ascending: false });
```

**Add button** (`daily-plan.tsx`):

```tsx
<Button type="submit" className="h-11 w-full" disabled={isPending}>
  <PlusIcon className="size-4" aria-hidden />
  {isPending ? "Adding…" : "Add to today's plan"}
</Button>
```

**Pending “Visit again”** opens `StartFollowUp`, which posts to `startFollowUp`. That inserts a `daily_plans` row and redirects to the dashboard. The opened panel’s submit label is also “Add to today’s plan” (`follow-up-list.tsx`).

```tsx
<Button type="button" className="h-11 w-full" onClick={() => setOpen(item.instituteId)}>
  Visit again
</Button>
```

The open-institute list itself comes from `getOpenFollowUps()` (`institutes` whose `status` is in the open catalogue). That list is not `follow_up_tasks`.

**Where `follow_up_tasks` is read:** `listFollowUpTasks` in `src/lib/visits.ts`

```ts
export async function listFollowUpTasks(
  memberId: string,
  upTo: string,
): Promise<{ ok: true; tasks: FollowUpTask[] } | { ok: false }> {
  const { data, error } = await supabase
    .from("follow_up_tasks")
    .select(
      "id, institute_id, kind, due_date, note, done_at, outcome, institutes(name, principal_mobile)",
    )
    .eq("member", memberId)
    .is("done_at", null)
    .lte("due_date", upTo)
    .order("due_date", { ascending: true });
```

Callers:

- Dashboard (`page.tsx`) — the query is skipped while `PHASE_A_DAILY_PLAN` is false.
- Pending “Due today” (`pending/page.tsx`) — not behind the flag.
- The bell (`notifications.ts`) — due today only (`eq("due_date", today)`), not overdue.

---

## 3. Phase A flag

**File:** `src/lib/features.ts` (57 lines). The constant:

```ts
export const PHASE_A_DAILY_PLAN = false;
```

The rest of the file is the comment that the flag hides surfaces and does not delete data: `follow_up_tasks`, `visits.next_action`, and `daily_plans` stay. Pending’s “Due today” block is deliberately not gated.

**Every hit**

| File | Lines |
| --- | --- |
| `src/lib/features.ts` | 57 (definition) |
| `src/app/(app)/page.tsx` | 24 import, 93 comment, **99** query gate |
| `src/components/dashboard/daily-plan.tsx` | 45 import, 267 comment, **275**, **411**, 581 comment, **585** |
| `src/components/visits/log-visit-form.tsx` | 51 import, 578 comment, **586** |
| `src/components/visits/feedback-only-form.tsx` | 6 import, 140 comment, **149** |
| `src/lib/notification-kinds.ts` | 1 import, 67 comment, **86** `kindIsEnabled` |
| `tests/unit/features.test.ts` | 5, 26, 49, 60, 99, 188 |
| `tests/unit/notifications.test.ts` | 4, 267, 277, 297 |

**JSX the flag currently hides** (all dark while it is `false`)

Meetings heading, `daily-plan.tsx`:

```tsx
{PHASE_A_DAILY_PLAN && (
  <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
    Meetings
  </h3>
)}
```

“Plan the morning” is `MorningPlan`, mounted only when the flag is on:

```tsx
{PHASE_A_DAILY_PLAN && canAdd && (
  <MorningPlan
    institutes={institutes}
    purposes={purposes}
    catalogue={catalogue}
    plannedIds={entries
      .filter((entry) => entry.checkinAt === null)
      .map((entry) => entry.institute_id)}
  />
)}
```

The button label “Plan the morning” is inside `MorningPlan` (`morning-plan.tsx`).

Follow-up calls section:

```tsx
{PHASE_A_DAILY_PLAN && (
  <section className="space-y-3">
    <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
      Follow-up calls
    </h3>
    <FollowUpCalls tasks={tasks} />
  </section>
)}
```

“Next action” is `NextActionFields` in `src/components/visits/next-action-fields.tsx`:

```ts
export function NextActionFields({
  value,
  onChange,
  fieldErrors,
  defaultDue,
}: {
  value: NextActionValue;
  onChange: (patch: Partial<NextActionValue>) => void;
  fieldErrors: Record<string, string>;
  defaultDue: string;
})
```

The on-screen label is **“What happens next?”** with Call / Meeting. Wired behind the flag in `log-visit-form.tsx` (~586) and again in `feedback-only-form.tsx` (~149).

---

## 4. Notification bell

**Bar:** `src/components/layout/top-bar.tsx`

```ts
export function TopBar({
  name, role, showRole, items, notifications, showBell,
}: { /* ... */ })
```

Renders `{showBell && <NotificationBell items={notifications} />}`.

**Widget:** `src/components/layout/notification-bell.tsx`  
`export function NotificationBell({ items }: { items: NotificationItem[] })`

**Who computes it:** `src/app/(app)/layout.tsx` calls `bellFor(user, role)` and passes `showBell={role !== "admin"}`.

**Deriver:** `export async function bellFor(user: CurrentUser, role: Role, now: Date = new Date()): Promise<BellState>` in `src/lib/notifications.ts` (lines 157–287).

What the body does:

- An admin returns empty before any query.
- One `follow_up_tasks` query: `due_date = today`, `done_at` is null, `member` in the roster. The latest kind the clock has reached wins, so a rep does not get three lines for one set of calls. Order tried newest-first: `follow_ups_missed`, `follow_ups_pending`, `follow_ups_due`.
- `day_plan_not_set` reads `daily_plans` for today with `assigned_by` null. Members with no such row get a line. `count` is set to null.
- `weekly_plan_not_set` reads `targets` where `period = 'weekly'`, `period_start` is next Monday, and `submitted_at` is not null. Members missing that row get a line.

**Kinds** (`ALERT_KINDS` in `src/lib/alert-kinds.ts`):

1. `day_plan_not_set`
2. `follow_ups_due`
3. `follow_ups_pending`
4. `follow_ups_missed`
5. `weekly_plan_not_set`

`PHASE_A_KINDS` contains only `day_plan_not_set`, so that kind stays dark while the flag is false.

Visible-from hour (Asia/Kolkata), `src/lib/notification-kinds.ts`:

| Kind | From hour | Day limit |
| --- | --- | --- |
| `follow_ups_due` | 0 | any |
| `follow_ups_pending` | 16 | any |
| `follow_ups_missed` | 19 | any |
| `day_plan_not_set` | 10 | any |
| `weekly_plan_not_set` | 19 | Sunday only (ISO day 7) |

Links: follow-ups due/pending → `/pending`; missed → `/missed`; day plan → `/`; weekly plan → `/targets`.

---

## 5. Slabs

**Migration:** `supabase/migrations/0044_institute_slabs.sql` (966 lines).

Also in that file, besides the three functions below: `institute_is_empanelled()`, RLS, indexes, grants, and an assertion block from about line 701. There is **no `DROP FUNCTION`** anywhere in 0044. `save_slabs` is `CREATE OR REPLACE`.

### `guard_slab_decision()` — lines 304–388

`BEFORE INSERT OR UPDATE OR DELETE`. `SECURITY DEFINER`.

- `DELETE` of an `approved` row by a non-admin raises **FO035**.
- No caller (`auth.uid()` null): return, so restore/seed/service role pass.
- GUC `kubeats.deciding = 'on'`: return (set only by `decide_slabs`).
- `INSERT`: force `status = 'pending'`, clear `note`, `decided_by`, `decided_at`.
- A status change outside that GUC raises **FO035**.
- An `approved` row cannot be edited (**FO035**).
- Any other update keeps the old decision columns.

### `save_slabs` — lines 417–582

```sql
create or replace function public.save_slabs(
  p_institute uuid,
  p_scope     text,
  p_college   text,
  p_program   text,
  p_slabs     jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
```

Refuses a bad scope (**FO036**), refuses an already-approved set (**FO035**) before deleting, requires `p_slabs` to be a non-empty jsonb array, walks the array in the order given (contiguous, last slab open-ended), then `DELETE` + `INSERT` for that scope. Grants:

```sql
revoke all on function public.save_slabs(uuid, text, text, text, jsonb) from public;
revoke all on function public.save_slabs(uuid, text, text, text, jsonb) from anon;
grant execute on function public.save_slabs(uuid, text, text, text, jsonb) to authenticated;
```

### `decide_slabs` — lines 617–688

```sql
create or replace function public.decide_slabs(
  p_institute uuid,
  p_scope     text,
  p_college   text,
  p_program   text,
  p_status    text,
  p_note      text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
```

`is_admin()` or **FO037**. `p_status` must be `approved` or `rejected`. Sets `kubeats.deciding = 'on'` and updates every row in the set. Revoke is `rejected`. There is no `revoked` status.

### App

`src/lib/slab-actions.ts` (165 lines).

```ts
export async function saveSlabs(_prev: AdminState, formData: FormData): Promise<AdminState>
export async function decideSlabs(_prev: AdminState, formData: FormData): Promise<AdminState>
```

Save call:

```ts
const { error } = await supabase.rpc("save_slabs", {
  p_institute: parsed.data.institute_id,
  p_scope: parsed.data.scope,
  p_college: parsed.data.scope === "total" ? null : parsed.data.college,
  p_program: parsed.data.scope === "total" ? null : parsed.data.program,
  p_slabs: parsed.data.slabs.map((s) => ({ start: s.start, end: s.end })),
});
```

Decide call: `p_institute`, `p_scope`, `p_college`, `p_program`, `p_status`, `p_note`. Admin-only in the action; the function checks `is_admin()` again.

### `validateSlabSet` — `src/lib/validation/slabs.ts` lines 96–167

```ts
export function validateSlabSet(input: SlabSetInput): SlabProblem[]
```

Rules, in order, every problem returned:

- `total` must have empty college and program.
- `program` must have both.
- Each start is a non-negative integer.
- Only the last row may have a blank end, and the last row must.
- End, when present, is an integer and `end >= start`.
- Next start is `previousEnd + 1`. Walked in the given order, not sorted.

### UI

One component, not two: `src/components/institutes/slabs-panel.tsx`

```ts
export function SlabsPanel({
  instituteId, sets, canEdit, canDecide,
}: {
  instituteId: string;
  sets: SlabSet[];
  canEdit: boolean;
  canDecide: boolean;
})
```

Mounted from `src/app/(app)/institutes/[id]/page.tsx`.

- Anyone with `canEdit`, while status is not `approved`: the range form and **Submit for approval**.
- Admin (`canDecide`), same card:
  - `pending`: **Approve** (`status=approved`) and **Send back** (`status=rejected`).
  - `approved`: **Revoke** (still posts `status=rejected`).
  - `rejected`: Send back is disabled.

There is no separate Pending / Approved screen.

---

## 6. Institutes

**Registry query:** `export async function listInstitutes(statusChanged?: StatusChangedRange)` in `src/lib/institutes.ts` (lines 105–161).

```ts
let query = supabase
  .from("institutes")
  .select(COLUMNS)
  .order("created_at", { ascending: false });
```

`/institutes` (`src/app/(app)/institutes/page.tsx`) calls `listInstitutes()` with no date range. A rep’s rows are whatever RLS returns (`registered_by`). There is no SQL `count`.

**The “2 of 2” line** is client-side, `src/components/institutes/institutes-browser.tsx`:

```tsx
<p className="text-muted-foreground text-xs">
  {filtered.length} of {institutes.length} institute
  {institutes.length === 1 ? "" : "s"}
</p>
```

“2 of 2” means the filtered list is the same length as the array `listInstitutes()` returned. Nothing hardcodes that pair.

**Dropdown:** `export async function listInstitutesForPicker(): Promise<PickerInstitute[]>` in `src/lib/visits.ts` (lines 39–51).

```ts
.from("institutes")
.select("id, name, city, status, registered_by")
.order("name");
```

Used by the dashboard plan picker and by Assign.

---

## 7. Admin Overview

**Page:** the admin branch of `src/app/(app)/page.tsx`.  
**Component:** `export function AdminOverview({ data, today, weekStart, weekEnd })` in `src/components/admin/overview.tsx`.

There is **no component or table named “Overview table”**. The screen is tiles plus card lists.

Tiles (lines 69–124), four cells in `grid-cols-2 md:grid-cols-4`:

| Tile | Value |
| --- | --- |
| Visits today · of planned | `visitsToday / plannedToday`, sub-line `institutesToday` |
| Visits this week | `visitsThisWeek` |
| Reports filed | `reportsThisWeek`, hint `of {visitsThisWeek}` |
| Photos in | `photosThisWeek` |

Side rail: **Latest from the team**, **Out today**, **Still checked in** (`OpenCheckIns`), **Open loops**, and a **Go to** list (Assign, Follow-ups owed, Team progress, Pipeline by rep, Data, Activity report, Materials).

**Pipeline at `/institutes/report`:** `src/app/(app)/institutes/report/page.tsx`, `export default async function InstituteStatusReportPage`. Data from `getInstituteStatusModel()` in `src/lib/institute-status-report.ts`. Rendered as:

```tsx
<CustomisableGrid
  viewKey="pipeline-report"
  reps={result.model.reps}
  columns={result.model.columns}
  showActivities={false}
  unsetColumn={result.model.unsetColumn ?? undefined}
  linkCohorts
  sort={result.model.sort}
  range={range}
  caption="Institutes by current status, per owning rep"
/>
```

`CustomisableGrid` (`src/components/report/customisable-grid.tsx`) renders `ActivityGridTable` (`src/components/report/activity-grid-table.tsx`):

```ts
export function ActivityGridTable({
  data, compact = false, caption, sortHrefFor, sortState,
}: { data: GridInput; compact?: boolean; caption: string; /* ... */ })
```

---

## 8. “Activity by This Month”

The exact string **“Activity by This Month” is not in the repo.**

What the admin dashboard renders (`src/app/(app)/page.tsx`):

```tsx
<SectionTitle className="mt-8">
  Activity this month
  <span className="text-muted-foreground ml-2 text-xs font-normal">
    {formatDate(range.start)} – {formatDate(range.end)}
  </span>
</SectionTitle>
<ActivityGridTable
  data={{
    reps: report.model.reps,
    columns: report.model.columns,
    showActivities: false,
  }}
  compact
  caption="Activity by rep this month"
/>
```

Model: `getActivityReportModel(range, null)` with `defaultExportRange()`. `showActivities: false` drops the activity band, so this card is status columns only.

**Totals:** `export function buildActivityGrid(input: GridInput)` in `src/lib/exports/activity-grid.ts`. Each status cell is `rep.statuses[column.status] ?? 0`, summed into `perRow`. Column sums and the grand total:

```ts
const perColumn: (number | null)[] = Array.from({ length: width }, (_, c) => {
  if (c === 0) return null;
  return bodyRows.reduce<number>(
    (sum, row) => sum + (typeof row[c] === "number" ? (row[c] as number) : 0),
    0,
  );
});
totals = {
  perRow,
  perColumn,
  grand: perRow.reduce((sum, n) => sum + n, 0),
};
```

**Open / closed:** column `institute_statuses.category`. Allowed values are `"open"` and `"closed"` (`STATUS_CATEGORIES` in `src/lib/validation/institute.ts`).

Read by `listStatusCatalogue()` in `src/lib/statuses.ts`:

```ts
.from("institute_statuses")
.select(
  "status, category, tone, sort_order, is_active, asks_expected_date, asks_session_detail, asks_head_count",
)
```

`statusCategory(catalogue, status)` and `isOpenStatus(...)` in `src/lib/validation/institute.ts` (lines 156–167) read that row’s `category`. A null status is neither.

---

## 9. Assign tab

**Route:** `src/app/(app)/assign/page.tsx`  
`export default async function AssignPage()`

Loads `listReps()`, `listInstitutesForPicker()`, `listPurposes()`, `listAssignments()`. Renders `AssignVisit` (“New assignment”) and an “Outstanding / today onwards” table.

**Nav:** `src/lib/nav.ts` (350 lines, read in full). Assign is on both staff bars and not on the rep bar.

```ts
export const ADMIN_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: "dashboard" },
  { href: "/review", label: "Review", icon: "review" },
  { href: "/assign", label: "Assign", icon: "assign" },
  { href: "/team", label: "Team", icon: "team" },
  { href: "/institutes", label: "Institutes", icon: "institutes" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export const TEAM_LEAD_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: "dashboard" },
  { href: "/review", label: "Review", icon: "review" },
  { href: "/assign", label: "Assign", icon: "assign" },
  { href: "/team", label: "Team", icon: "team" },
  { href: "/institutes", label: "Institutes", icon: "institutes" },
];
```

`export const STAFF_PATHS = ["/review", "/assign", "/team"] as const;`

Rep bar (`REP_NAV`): Dashboard, Institutes, Log Visit, Pending, Targets, Materials.

Also in that file: `PUBLIC_PATHS`, `AUTH_PATHS`, `MFA_VERIFY_PATH`, `REP_ONLY_PATHS` (`["/log"]`), `ADMIN_ONLY_PATHS` (`/data`, `/settings`, `/materials/manage`), `navItemsFor(role)`, `isActive`, `isStaffOnlyPath`, `isAdminOnlyPath`, `isRepOnlyPath`, `isPublicPath`, `isAuthPath`. Staff pattern: `/^\/institutes\/report(?:\/|$)/`.

---

## 10. Who created whom, and team-lead assignment

**Not a Settings tab.** Settings only links out. `src/components/settings/team-panel.tsx`:

```tsx
<Link href="/team/hierarchy">Who created whom</Link>
```

**Page:** `src/app/(app)/team/hierarchy/page.tsx`  
`export default async function HierarchyPage()`

Two charts, both fed by `listTeamMembers()`:

| Chart | Component | Column |
| --- | --- | --- |
| Teams (who supervises whom) | `src/components/admin/team-structure.tsx` — `export function TeamStructure({ members, canAssign })` | `profiles.team_lead_id` |
| Who created which account | `src/components/admin/hierarchy-chart.tsx` — `HierarchyChart` | `profiles.created_by` |

`created_by` is written by hand only through `export async function setMemberCreator(...)` in `src/lib/admin-actions.ts` (line 997). The chart’s own comment says the column decides nothing.

**`assign_rep_to_team`** — `supabase/migrations/0043_team_assignment.sql` lines 44–47:

```sql
create or replace function public.assign_rep_to_team(
  p_rep  uuid,
  p_lead uuid default null
)
returns jsonb
language plpgsql
security definer
```

App: `export async function assignRepToTeam(_prev, formData)` in `src/lib/admin-actions.ts`:

```ts
const { error } = await gate.supabase.rpc("assign_rep_to_team", {
  p_rep: parsed.data.member,
  p_lead: parsed.data.team_lead,
});
```

**Reps per lead** are not a SQL aggregate. `listTeamMembers()` (`src/lib/admin.ts` line 391) selects:

```ts
"id, name, role, created_at, campus_id, campuses(name), created_by, team_lead_id"
```

`TeamStructure` counts in memory:

```tsx
{leads.map((lead) => {
  const theirs = reps.filter((r) => r.teamLeadId === lead.id);
  // ...
  <span>{theirs.length} rep{theirs.length === 1 ? "" : "s"}</span>
```

---

## 11. Team panels

The `/team` index (`src/app/(app)/team/page.tsx`) has **neither** panel. Both live on the member hub, `src/app/(app)/team/[memberId]/page.tsx`.

| What you asked for | What the screen says | Component | How many rows | Pagination |
| --- | --- | --- | --- | --- |
| Field Presence / `open-checkins.tsx` | **Still checked in** | `export function OpenCheckIns({ visits }: { visits: OpenCheckIn[] })` in `src/components/admin/open-checkins.tsx` | Every row from `listOpenCheckIns(memberId)`. Overview passes the whole team, with no member filter. | None. `visits.map`, no slice, no page size. |
| Follow-up Owed | **Follow-ups owed** | `FollowUpList` with `theirFollowUps` (`item.owner === memberId`) | All of them | None. On this same page, institutes are capped at `INSTITUTES_SHOWN = 8` and recent visits at `RECENT_VISITS = 10`. Follow-ups are not capped. |
| Field presence (the literal heading) | **Field presence** | `ActivitySummary` in `src/components/report/activity-summary.tsx` (~405), inner `PresencePanel` / `PresenceCard` | Every `plannedVisits` row for the selected period | None |

`listOpenCheckIns` (`src/lib/admin-workspace.ts` line 604) selects `daily_plans` where `checkin_at` is set, `checkout_at` is null, and `checkout_missing` is false. No `limit`.

`OpenCheckIns` is not titled “Field Presence”. That heading is the `ActivitySummary` section. The test comment that says `listTeamMembers()` feeds “Field Presence” is describing the old outage, not a panel of that name on `/team`.

Missed follow-ups are a different route: `src/app/(app)/missed/page.tsx`. Window is 30 days. All rows in that window are mapped. No pagination.

---

## 12. Conventions

**`CLAUDE.md`** at the repo root. Opened in full: **695 lines**. It begins `@AGENTS.md` and the KUbeats design spec (screen ownership, RLS, purposes vs activities, the weekly lock, dates, photos). The file on disk is the source; it is not duplicated in this note.

**Latest migration number present:** `0044_institute_slabs.sql`. Confirmed highest. Neighbours: `0043_team_assignment.sql`, `0042_team_lead_scoping.sql`, `0041_team_leads.sql`. `0020a` and `0020b` exist and are lower.

**How numbers are validated today.** There is no currency or decimal amount field.

Weekly targets, `src/lib/validation/weekly.ts` (~269). Empty means 0. Digits only, 0–999:

```ts
const count = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? String(v) : v.trim()))
  .transform((v) => (v === "" ? "0" : v))
  .refine((v) => /^\d{1,3}$/.test(v), "Whole numbers from 0 to 999.")
  .transform(Number);
```

Head count, `src/lib/validation/feedback.ts` (~110). Optional. Blank is null. Up to 6 digits. Message “Whole numbers only.” Bound as `students_attended: count`.

Class 12 approximate count, `src/lib/validation/institute.ts` (~350): `z.number().int().min(0).max(100000)`. The form does `Number(raw)` in `instituteFormDataToInput`.

Slab bounds, `slabs-panel.tsx`: `inputMode="numeric"` and `replace(/\D/g, "")`, then integer checks in `validateSlabSet`.

A new whole-number Amount should follow the weekly `count` if blank means zero, or the feedback `count` if blank means “not answered”.

---

## 13. Slab amount groundwork

**`CREATE TABLE public.institute_slabs` columns** (`0044` lines 91–114):

| Column | Type |
| --- | --- |
| `id` | `uuid primary key default gen_random_uuid()` |
| `institute_id` | `uuid not null references public.institutes (id) on delete cascade` |
| `scope` | `text not null` (`program` or `total`) |
| `college` | `text` |
| `program` | `text` |
| `start_count` | `integer not null` |
| `end_count` | `integer` (null means the open-ended last slab) |
| `status` | `text not null default 'pending'` |
| `note` | `text` |
| `decided_by` | `uuid references public.profiles (id) on delete set null` |
| `decided_at` | `timestamptz` |
| `created_by` | `uuid references public.profiles (id) on delete set null default auth.uid()` |
| `created_at` | `timestamptz not null default now()` |

No amount, rate, or fee column.

**`save_slabs` signature, as written:**

```sql
create or replace function public.save_slabs(
  p_institute uuid,
  p_scope     text,
  p_college   text,
  p_program   text,
  p_slabs     jsonb
)
```

**`DROP FUNCTION` for `save_slabs`:** not present. The file uses `create or replace function`.

**How `slab-actions.ts` calls it:** one RPC. Arguments `p_institute`, `p_scope`, `p_college`, `p_program`, `p_slabs`. See the call in §5.

**A set is one array in one call.** The form posts repeated `name="start"` and `name="end"` fields. The action zips them:

```ts
const starts = formData.getAll("start").map(String);
const ends = formData.getAll("end").map(String);
const parsed = slabSetSchema.safeParse({
  institute_id: textOf(formData, "institute_id"),
  scope: textOf(formData, "scope"),
  college: textOf(formData, "college"),
  program: textOf(formData, "program"),
  slabs: starts.map((start, i) => ({ start, end: ends[i] ?? "" })),
});
```

**One row as the form holds and sends it** (`slabs-panel.tsx`):

```ts
{ start: string; end: string }
```

The last row’s end is forced to `""` by a hidden input, because a disabled input posts nothing. After `slabSetSchema`, `start` and `end` are still trimmed strings. The RPC payload is `{ start: string; end: string }[]` inside `p_slabs`. Postgres reads `(value ->> 'start')::integer` and `nullif(value ->> 'end', '')::integer`.

The type after a successful read is different. `SlabRow` in `src/lib/validation/slabs.ts`:

```ts
export interface SlabRow {
  start: number;
  /** Null is the open-ended LAST slab ("1200 and above"), never a missing value. */
  end: number | null;
}
```
