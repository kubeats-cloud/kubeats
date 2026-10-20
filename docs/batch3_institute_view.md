# Batch 3a — Institute-wise Activity Report (A1)

Scope: shared institute-wise data source + Admin screen. Rep screens (R1/R7)
come later and must call the same source. Local Supabase only. Branch:
`batch-3/institute-view` off local `main` (does not depend on batch-1 /
Not Interested).

---

## 1. What the coverage rows ask for

| # | Ask | Status today |
| --- | --- | --- |
| **A1** | Activity Report replaces Pipeline-by-Rep: **institute-wise**, Open/Closed, date filter, sort, Excel, clickable drill-downs | **Partial** |
| **R1** | Rep institute-wise activity table (sort + date filter) | **Missing** (out of scope for 3a; same source) |
| **R7** | Rep Activity Report institute-wise table | **Missing** (out of scope for 3a; same source) |

Root gap shared by all three: **every report today is rep-wise or aggregate;
there is no institute-wise activity table anywhere.**

---

## 2. What A1 already has (keep / reuse)

Surface: `/institutes/report` — `src/app/(app)/institutes/report/page.tsx`,
titled **"Pipeline by rep"**. Model:
`getInstituteStatusModel()` in `src/lib/institute-status-report.ts`.

| Already there | Where |
| --- | --- |
| Staff gate (admin + team lead) | `requireStaff()`; RLS via `supervises()` / `institutes_select` |
| Optional date-range filter | `RangeControls`, `?from=&to=`, `pipelineRangeSchema` — today on `institutes.status_updated_at` |
| Column sort | `?sort=&dir=`, `parsePipelineSort` |
| Clickable non-zero cells | `CustomisableGrid` + `linkCohorts` → `/institutes` cohorts |
| Open/Closed as **status-name** column bands | `statusColumnsFor()` / catalogue categories — pipeline of *current* `institutes.status`, not activity |
| Shared activity vocabulary | `ACTIVITY_COLUMNS` + `tallyVisitMetrics()` (Rule 7 visits half) |
| Excel export elsewhere | `ExportExcel` → `/api/export/activity` on `/report` and `/team` — **not** on this screen |
| Institute hub for name drill-down | `/institutes/[id]` (`institute-hub.ts` counts from visible visits) |
| Overview shortcut | Admin Overview links to `/institutes/report` (full pipeline embed lives on `lane-a/overview-pipeline-totals`, not on `main`) |

Related but **not** A1's table:

- `/report` (`getActivityReport`) — per-rep aggregates; has `byInstitute[]` as a
  simple visit-count list, not Open/Closed per activity, not a sortable grid.
- `/team/report` + `activity-export.ts` — **rep-wise** Excel with activity +
  status bands; same arithmetic we must not fork.

---

## 3. What A1 is missing

1. **Rows are reps, not institutes.** `RepRow[]` keyed by
   `institutes.registered_by`. Client wants one row per institute.
2. **No per-activity Open/Closed.** Pipeline columns are status *names*
   (First meeting done, Session scheduled, …). A1 wants, for each of the
   **six** activity types, Open and Closed **counts** (category of the status
   that visit set).
3. **No Excel on this screen** whose sheet matches the filtered/sorted table.
4. **Date filter axis is wrong for an Activity Report.** Pipeline filters
   “status last moved”. Activity counts must filter on the work’s `date`
   (`visits.date` / `daily_plans.date`), same as Rule 7 and `/report`.
5. **No follow-ups owned / pending or meetings-completed columns** on this
   grid (those exist in other shapes on Pending / weekly targets).
6. **No shared institute-wise model** R1/R7 can call later.

`reconcileActivityCounts()` (per-institute sum of six activity buckets =
visit rows, via `tallyVisitMetrics()`) exists on batch-1 WIP only. **Main does
not have it yet** — batch 3a brings that guard onto this branch as part of the
single counted path (no second counter).

---

## 4. Design locked for 3a (decisions)

These are the readings that keep one counting path and match Rule 7 / export
comments. Changing any of them would be a product decision, not a tidy-up.

### 4.1 Shape of one institute row

| Field | Source |
| --- | --- |
| Institute name (+ id) | `institutes` (RLS) |
| Per activity × {Open, Closed} | Visits in range: bucket by `ACTIVITY_COLUMNS` / `tallyVisitMetrics` fold; Open/Closed = category of `status_set_to` via `institute_statuses` / catalogue |
| Total activities | Sum of the six activity buckets (= visit rows that reconcile) |
| Meetings completed | `daily_plans` where `meetings_actual = 1` in the same date range (Rule 7 Meetings — **not** visit rows) |
| Follow-ups owned | `follow_up_tasks` with `done_at IS NULL` for that institute |
| Follow-ups pending | Owned tasks with `due_date <= app today` (due / overdue) |

Meetings in the six activity Open/Closed columns count **visit** rows with
`activity = 'meeting'` (same as `reconcileActivityCounts`). “Meetings
completed” stays the plan figure so Targets / Team / export cannot disagree.

### 4.2 Date filter

Optional `?from=&to=` on **`visits.date` / `daily_plans.date`** (inclusive,
Asia/Kolkata calendar days already stored as `YYYY-MM-DD`). Blank = all time
visible under RLS. Sort + export use the same filtered row set.

### 4.3 Server-side source — TypeScript function, not a SQL view

`getInstituteActivityModel()` in a new `src/lib/institute-activity-report.ts`
(server-only), same pattern as `getInstituteStatusModel` / `activity-export.ts`.

**Not** a Postgres view/RPC that re-implements Rule 7. `activity-export.ts`
already states why: a second copy in SQL drifts the first time a metric
changes. RLS still scopes every read (`visits`, `institutes`, `daily_plans`,
`follow_up_tasks`). Admin = all; team lead = `supervises()`; rep = own
(R1/R7 later; this screen stays `requireStaff()`).

Counting path (single):

1. Fetch visit rows `(institute_id, activity, lifecycle_status, status_set_to, date)`.
2. `reconcileActivityCounts(visits)` — refuse or soft-fail if drift (same
   stance as week-summary / export).
3. Fold with `ACTIVITY_COLUMNS` + catalogue category for Open/Closed.
4. Attach plan meetings + follow-up task counts.

### 4.4 Admin UI

- Replace the body of `/institutes/report`: title/description → institute-wise
  **Activity report**; remove Pipeline-by-Rep grid (`getInstituteStatusModel` /
  status-name bands). Keep the route so Overview / Institutes links keep
  working.
- Controls: date filter, column sort, **Download Excel** matching current
  filter/sort.
- Institute name → `/institutes/[id]`.
- Activity Open/Closed counts → filtered list of the visits behind the cell
  (reuse `/review` with query params where possible; otherwise a thin
  cohort page that lists the same rows the model counted).
- Pipeline-by-Rep model left in tree for now unused by this page (R1/R7 must
  not resurrect it as the activity grid). No requirement in 3a to delete
  `institute-status-report.ts`.

### 4.5 Out of scope for 3a

- R1 / R7 rep UI wiring (source must be ready for them).
- Batch-1 Not Interested (0045) — independent; category axis already works
  for any closed status once present.
- Overview embedded pipeline (`lane-a`) — not on `main`; Overview keeps its
  link to `/institutes/report`.

---

## 5. Acceptance (local only)

- Per-institute six-activity Open/Closed + total reconcile via
  `reconcileActivityCounts()`.
- RLS: admin sees all; team lead only supervised members’ institutes/visits;
  (rep path covered by unit/integration against the model with a rep client
  when easy — screen remains staff-gated).
- Excel bytes match the filtered/sorted table columns.
- Migrations: none required if counting stays in TS; if any DB object is
  added, ship a tested DOWN under `supabase/rollbacks/`.
- No push to dev/production.

---

## 6. Step status

| Step | Status |
| --- | --- |
| 1. This doc (A1 has vs missing) | **Done** |
| 2. Institute-wise data source + reconcile on main line | Next |
| 3. Admin `/institutes/report` UI + Excel | Pending |
| 4. Local tests + STOP | Pending |
