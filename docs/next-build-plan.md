# Next build — reports, institute details, daily plan & follow-ups, notifications

**Plan only. No code, no migration, no deploy.** Written against the tree at
`3df3e09`, grounded in the files named throughout. Read alongside `CLAUDE.md`
(the rules), `docs/phase2-flow-rework-plan.md` (the plan style this follows) and
`docs/rep-owned-institutes-plan.md` (the boundary B1 touches).

Scope confirmed by the client: **C** (totals, date filter, sorting), **B**
(one-time rep edit, counsellors), **A** (daily plan split, tick-list, next
action, Pending filter), **E** (timed notifications). Parked and not planned
here: slabs, and "+ customise any table" custom columns.

---

## 0. The one-sentence summary

> **C is read-side only and needs no migration at all; B is two small additive
> migrations against a boundary that already permits what B1 wants; A is the
> expensive one because a follow-up CALL is not a visit and must not become a
> `daily_plans` row; and E is two features wearing one name — a materialised
> record the app computes, and a delivery channel nobody has chosen.**

Everything below follows from that sentence. The single most consequential
finding is in §2 item 6: **a Total column that sums every column in the .xlsx is
arithmetically wrong**, because the export keeps the six DASHBOARD ACTIVITIES
columns whose Meetings figure comes from `daily_plans` while the status columns
come from `visits`.

---

## 1. Your assumptions, checked against the code

| | Assumption | Verdict |
| --- | --- | --- |
| 1 | Totals also show a count line | **Fits**, with one wording trap. The status report's rows are not all reps — `getInstituteStatusModel()` appends non-rep owners ("Not a rep") and an "Unassigned" row (`src/lib/institute-status-report.ts:116-150`). "N reps" must count profile rows only, or say "N rows". And decide whether "M statuses" counts the NO STATUS column: it should not — null is "the absence of a stage, not a stage" per `GridInput.unsetColumn` — and the line should say so. |
| 2 | The report date filter keys on `status_updated_at` | **Works, with two real problems.** (a) `touch_institute_status()` (`0001_init.sql:507`) stamps it **only when `status` is non-null**, so every "No status yet" institute has `status_updated_at IS NULL` and any range filter silently drops the whole NO STATUS band — which is also the band that makes the grand total reconcile with "T institutes in all". (b) It is a `timestamptz`, not a `date`, so a `YYYY-MM-DD` string comparison is wrong at both ends; it needs Asia/Kolkata day boundaries. Both have concrete answers in §4.2. |
| 3 | One-time edit = create + one correction, then lock | **Fits, and is cheaper than it looks in one way and more dangerous in another.** Cheaper: `institutes_update` has permitted the owning rep on *both* halves since 0028 (`campus_id = my_campus() and registered_by = auth.uid()`), so **no RLS widening is needed** — only `ADMIN_ONLY_PATTERNS` in `src/lib/nav.ts:160` and `requireAdmin()` in `updateInstitute()` stand in the way. More dangerous: `log_visit()` is **SECURITY INVOKER** and runs `update public.institutes set status = …` *as the rep* (`0033:303`). A trigger that burns the one edit on "any rep UPDATE" would consume it on that rep's first visit. The guard must be column-scoped. |
| 4 | Counsellor fields are name / phone / email | **Fits.** One ambiguity to settle: there is no "owner" column. `principal_name` / `principal_mobile` is the field the detail page labels **"Principal / owner"** (`institutes/[id]/page.tsx:319`), and `decision_maker_*` is a second contact pair. Confirm "alongside owner and principal" means those existing fields rather than a new one — and note `institutes.registered_by` is a different "owner" entirely (the rep who holds the row). |
| 5 | *(not in your list)* "/institutes/report … and their Excel exports" | **Wrong as stated.** `/institutes/report` **has no Excel export.** There is exactly one export endpoint, `src/app/api/export/activity/route.ts`, and one control, `ExportExcel`, both wired to the *activity* report. Adding totals to "their exports" therefore means either (a) the activity export only, or (b) building a second export — new route, new filename, new range schema, new admin gate — which is its own M-sized piece of work. **Decision needed before C1 starts.** |
| 6 | *(not in your list)* A Total column spans all columns | **Arithmetically wrong in the .xlsx.** `activitySheet()` never passes `showActivities`, so the export takes the default `true` and keeps all six activity columns (`activity-grid.ts` `GridInput.showActivities`, and the test that pins it). Meetings there comes from `daily_plans where meetings_actual = 1`; the status columns come from `visits.status_set_to`. Summing both bands counts every visit twice and adds a number from a different table. Your wording ("across all status columns/bands") is already right — §4.1 makes it structural so it cannot be got wrong. |
| 7 | *(not in your list)* "team lead" role | **Does not exist.** `profiles_role_valid check (role in ('rep','admin'))` (`0001:41`). `profiles.created_by` (0034) and `/team/hierarchy` record *which admin created which account*, which is a hierarchy but not a role. E's "visible to team lead, admin and rep" needs either a third role (a migration, and it ripples through `is_admin()`, `ADMIN_ONLY_PATHS`, every policy that says `is_admin()`) or a reading as "admin, scoped by `created_by`". **Recommend the second** and say so to the client. |

---

## 2. Phase order and dependencies

```
  C  (reports)          ── no migration, no dependency on anything else
  │
  B1 (one-time edit)    ── 0036.  Independent.
  B2 (counsellors)      ── 0037.  Independent. After B1 only because both
  │                               touch institute-form.tsx.
  A1 (plan sections)    ── no migration. Needs A3's data to have two
  │                               sections worth splitting, so: A3 → A1.
  A3 (next action)      ── 0038 (additive) + 0039 (close_visit overload)
  A2 (tick-list)        ── no migration if a purpose is chosen per batch
  A4 (Pending filter)   ── no migration under the recommendation in §6.4
  │
  E1 (in-app + record)  ── 0040.  HARD dependency on A3 (the follow-up rows
  │                               it counts) and on A2/A4 (what "the auto
  E2 (a channel)        ──        plan" means in the 10:00 condition).
```

**Recommended order: C → B1 → B2 → A3 → A1 → A2 → A4 → E1 → E2.**

Reasons for that order specifically:

* **C first** because it is the only block that touches no table, no policy and
  no RPC. It can ship and be verified while the migration-bearing work is still
  being reviewed, and it re-baselines the .xlsx guard once rather than twice.
* **A3 before A1.** A1 splits the plan into "Meetings" and "Follow-up calls".
  Until A3 exists there are no calls, so A1 would ship a section that is empty
  by construction — and an empty section an admin cannot explain is worse than
  no section. A3 is also the only part of A that needs a migration pair, so it
  wants the longest review.
* **A2 and A4 after A1** because both write into the structure A1 draws.
* **E last and not negotiable.** Every one of E's six alerts is a predicate over
  rows A creates. The 10:00 "day plan not set" alert in particular is defined
  against "nothing beyond the auto plan", and what "the auto plan" *is* is
  decided by A2/A4 (§6.4 argues it should be nothing at all, which makes the
  predicate trivially `count = 0`).

**Two things can run in parallel safely:** C and B1 touch disjoint files. A3's
migration 0038 is purely additive and can be applied to the database days
before any of its code ships.

---

## 3. Migration ledger

| № | Feature | What it is | Deploy coupling |
| --- | --- | --- | --- |
| — | **C1, C2, C3** | **No migration.** `institutes.status_updated_at` exists since 0001; everything else is read-side. | none |
| **0036** | B1 | `institutes.rep_edits_used` + `rep_edited_at` + `rep_edited_by`; `guard_rep_institute_edit()` → **FO030**, column-scoped. | Additive. Apply any time **before** the deploy. Applied early it refuses nothing, because no rep can reach the editor yet. |
| **0037** | B2 | `public.institute_counsellors` table + 4 policies + grants + CHECKs. | Additive, standalone. Apply any time. |
| **0038** | A3 | `public.follow_up_tasks` table + 4 policies + grants + `enforce_task_institute_owned()` → **FO031**; `visits.next_action` column + CHECK. | Additive. Apply any time before the deploy. |
| **0039** | A3 | `close_visit()` gains `p_next_action`, `p_follow_up_kind`, `p_follow_up_due`, `p_follow_up_note` — the 0019 / 0022 overload ceremony. | **APPLY BEFORE DEPLOY.** All params defaulted, so the live 19-arg named call still resolves against the new function; the reverse does not (PostgREST answers PGRST202). |
| **0040** | E1 | `public.alert_events` (the materialised record) + `targets.calls` + extend `targets_non_negative`; `materialise_daily_alerts()` → cron. | Additive. Apply before the deploy. The cron jobs can be scheduled after. |

Next free error code is **FO030** (FO001–FO029 are taken; FO029 is 0035's).

Every file follows the house shape: forward-only, idempotent, `security
definer` + `set search_path = ''` + `public.is_admin()` as the **first**
statement for anything boundary-crossing, explicit `revoke all … from public /
anon` then `grant execute … to authenticated`, and a closing `do $$ … $$`
assertion block that `raise exception`s with every problem it found. 0035 is the
template to copy; its §2 is the best worked example of the assertion block,
including the `search_path` `LIKE 'search_path=%'` trap that bit both 0032 and
0035.

`scripts/check-schema.mjs` gains one `PROBES` entry per column-bearing
migration: `0036 → institutes.rep_edits_used`, `0037 →
institute_counsellors.id`, `0038 → visits.next_action`, `0040 → targets.calls`.
**0039 adds no column and cannot be probed** — note it in the "what this check
cannot see" comment alongside 0023 and 0027–0030.

---

# Phase C — reports & tables

## C.1 Totals on both reports and in the export

### What exists now

| | |
| --- | --- |
| `src/lib/exports/activity-grid.ts` | The whole layout. `buildActivityGrid(input)` returns `{ rows, merges, hrefs }`; `activitySheet(input, name)` wraps it for the workbook. Pure, no database. |
| `src/components/report/activity-grid-table.tsx` | Draws exactly those arrays. Destructures `[groupRow, labelRow, ...bodyRows]` and renders every remaining row as a rep row in `<tbody>`. |
| `src/lib/exports/activity-export.ts` | `getActivityReportModel()` — the activity report's rows and columns, plus the `statusesWithoutColumns()` **orphan guard** that refuses a report which would not add up. |
| `src/lib/institute-status-report.ts` | `getInstituteStatusModel()` — the pipeline report. Carries `total: institutes.length`, which is the "T institutes in all" header on `/institutes/report`. **Has no orphan guard.** |
| `src/lib/xlsx.ts` | `buildWorkbook(spec)`. Deterministic ZIP (pinned DOS timestamps), which is what makes the byte-identity test possible. |
| `tests/unit/activity-grid-bands.test.ts:188` | `BASELINE_SHA256 = 968356ff…`, `BASELINE_BYTES = 6404`, plus a test that asserts the body rows "sum to the number of institutes behind it". |

Three callers of `ActivityGridTable`: the admin Overview card
(`(app)/page.tsx`, `compact`), `/team/report`, `/institutes/report`. All three
pass `showActivities: false`; only `activitySheet()` takes the `true` default.

### The proposed change

**Totals ride on the same return value, not appended into `rows`.**
`buildActivityGrid()` grows a fourth field:

```
totals: {
  perRow:    number[]              // parallel to the body rows
  perColumn: (number | null)[]     // parallel to one body row
  grand:     number
}
```

and an input `showTotals?: boolean` defaulting to **`true`**, so the screen and
the download stay two renderings of one computation — the invariant stated at
the head of `activity-grid-table.tsx`. No caller has to remember a flag.

Appending a total row into `rows` instead would be wrong three ways, and each
one is already visible in the code: `ActivityGridTable` would render it as an
ordinary rep row with rep styling and a sticky name cell; `hrefs` would have to
grow a parallel null row or go out of alignment; and the existing "sums to the
number of institutes behind it" test iterates every body row, so a total row
would double its answer. Keeping totals in their own field leaves every current
test valid.

**The band scoping, which is the load-bearing decision:**

* **Row total** = the status columns only (closed + open + NO STATUS). It gets
  its own single-column band, `TOTAL`, at the **far right, after NO STATUS** —
  the same placement rule NO STATUS itself follows, so the client's template
  columns keep the positions their formulas and pivots are written against.
* **The six activity columns get no row total.** Deliberately, and said on the
  page: Meetings comes from `daily_plans` and the other five fold eight
  `visits`-sourced metrics into five columns, so a figure spanning the activity
  band and the status band would count each visit twice over and add a number
  from another table. This is §2 item 6.
* **Total row** = a column sum for **every** column, activity band included. A
  team-wide Meetings total is a real number and is the same arithmetic
  `/team` already does.
* **Grand total** = the bottom-right cell = the sum of the status-band column
  sums = the sum of the per-row totals. Two routes to one number; the test
  asserts they agree.
* **No total cell is ever a link.** `hrefFor` is not consulted for them. A
  total has no single cohort behind it, and CountLink's rule — "a link that
  lands on an empty list is a broken promise" — generalises: a cell that is not
  one cohort is not a door.

**The reconciliation requirement forces a second change.** For `grand ===
model.total` to hold on `/institutes/report`, every status an institute holds
must have a column. It does today *unless* `listStatusCatalogue()` fell back to
`SEED_STATUS_CATALOGUE` because its read failed — in which case every
admin-added status loses its column and those institutes vanish from the bands
while still being counted in the header. So `getInstituteStatusModel()` must
gain the `statusesWithoutColumns()` guard `getActivityReportModel()` already
has, and refuse with the same shape of sentence rather than show a report that
contradicts its own header.

**The count line.** On `/institutes/report`: `N reps · M statuses · T
institutes`, where N counts profile-backed rows only (not "Unassigned", not
"Not a rep" — both get their own clause when present), M counts closed + open
columns and **excludes** NO STATUS, and T is `model.total`. On `/team/report`
the third figure is **not** "visits" — pre-0027 visits can carry a null
`status_set_to`, so the grand total is "visits that recorded a status", and the
line must say that rather than imply it is every visit.

### Exact files to touch

* `src/lib/exports/activity-grid.ts` — `GridInput.showTotals`, the `totals`
  return field, a `TOTAL` band in `GROUP_HEADERS` and in `bands`, the merge
  arithmetic, and `activitySheet()` appending the total row to `rows`/`merges`
  and `widthsFor()` sizing the new column.
* `src/components/report/activity-grid-table.tsx` — a `<tfoot>` for the total
  row, an extra header cell and per-row cell for the total column, and a
  `font-semibold` + top-border treatment so a total never reads as a rep.
* `src/lib/institute-status-report.ts` — the orphan guard; a `counts` field for
  the summary line (reps / statuses / institutes), computed here rather than in
  the page so the page cannot disagree with the grid.
* `src/lib/exports/activity-export.ts` — a `counts` field for the same reason.
* `src/app/(app)/institutes/report/page.tsx`, `src/app/(app)/team/report/page.tsx`
  — render the summary line; no change to how either calls the grid.
* `src/app/(app)/page.tsx` — nothing, if `showTotals` defaults true. Confirm
  the compact card reads acceptably with the extra column (it scrolls already).
* `tests/unit/activity-grid-bands.test.ts` — **re-baseline** `BASELINE_SHA256`
  and `BASELINE_BYTES`, and add the reconciliation tests.
* `src/lib/xlsx.ts` — **no change.** Totals are plain numbers; the writer
  already handles those, and it deliberately does not do formulas.

### Data-model changes

**None. No migration.**

### UI touchpoints

A `TOTAL` header band and column at the right edge of three tables; a `<tfoot>`
total row on all three; a muted summary line under each report's section title.
The total column and row are `tabular-nums` and never underlined.

### Test & live-verify

* **Unit** — extend `activity-grid-bands.test.ts`: `perRow[i]` equals the sum of
  that row's status cells and **excludes** the activity cells; `perColumn`
  covers the activity band too; `grand` equals both the sum of `perRow` and the
  sum of the status half of `perColumn`; totals carry no hrefs; the NO STATUS
  reconciliation test still passes against `perRow` rather than by re-summing;
  `showTotals: false` reproduces today's bytes exactly (keep the old hash under
  that flag — it proves the change is confined to the new field).
* **Unit, new file** — `tests/unit/institute-status-report.test.ts`. There is no
  test for this module today, which is a gap C1's reconciliation requirement
  closes: the orphan guard refuses, the owner tally is by `registered_by`, and
  Unassigned sorts last.
* **Live** — signed in as admin: `/institutes/report` grand total equals the
  header's "T institutes in all" exactly; then add a status in Settings, assign
  an institute to it, and confirm the figure still reconciles. Download the
  .xlsx and open it: the TOTAL column sums the status band only, the activity
  band has no row total, and the bottom-right cell matches the screen.
  Signed in as rep: `/institutes/report` still 307s away (it is in
  `ADMIN_ONLY_PATTERNS`).

### Risks, unknowns, RLS, .xlsx

* **The .xlsx template changes.** This is the deliberate re-baseline you named.
  The client has formulas and pivots written against column positions
  (`TEMPLATE_COLUMN_ORDER` exists for that reason), so placing TOTAL at the far
  right after NO STATUS is not cosmetic — it is what keeps every existing
  column where it was. Tell the client the file has one new column and one new
  row, and that nothing moved.
* **Unknown, blocking C1's scope:** does `/institutes/report` need its own
  Excel export (§2 item 5)? If yes, that is a second route
  (`/api/export/pipeline`), its own filename, its own schema, and its own M of
  work — and it should be its own stage, not folded in here.
* **No RLS change.** Both reports already run as the signed-in admin under
  existing policies.

**Size: M** — L if the new pipeline export is in scope.

---

## C.2 Date filter on the status report

### What exists now

`/institutes/report` is a pure server component that reads **no `searchParams`
at all** and renders `getInstituteStatusModel()`, which takes no arguments. Its
own header comment says, at length, that it has no date controls *on purpose*
("an institute has one current status; 'where was it in March' is
`institute_status_history`, which is a different report").

`institutes.status_updated_at` is a `timestamptz` maintained by
`touch_institute_status()` (`0001:507`): stamped at insert only if `status` is
non-null, and re-stamped on every change of `status`.

The two filter patterns in the repo are **not interchangeable**:

* `institutes-browser.tsx` — filtering runs in the browser over the array the
  server sent; the **URL is an output**, mirrored from state, never read after
  the seed. Right for a registry where every keystroke must be instant.
* `/review/page.tsx` + `RangeControls` — **`searchParams` are the source of
  truth**, the server filters, and a small client control navigates. Right for
  a server-rendered aggregate.

`/institutes/report` is the second shape. **Follow `/review` + `RangeControls`,
not `institutes-browser`** — this corrects the pattern named in the brief.

### The proposed change

`?from=` / `?to=`, both optional, parsed in the page and passed into
`getInstituteStatusModel({ from, to })`, which adds two `.gte()` / `.lt()`
clauses to its `listInstitutes()` read.

**Four decisions, each with a reason:**

1. **The default is no range — all time.** The report's contract is "where
   every institute stands *right now*". A default window would silently hide
   every institute whose status has not moved this month, which is precisely
   the stalled pipeline an admin opens this screen to find. `todayISO()` is
   still used — as the `max` on the To input and for a "to today" shortcut —
   and `new Date()` is never used anywhere. If the client insists on a default
   window, it must be named in the header *and* in the summary line, and the
   header figure must become "T of N".
2. **Parameter names `from` / `to`**, matching `/review`'s filter vocabulary.
   `/team/report` uses `start` / `end` because it shares `exportRangeSchema`;
   this report cannot share that schema (different defaults, an optional
   range), and `/institutes/report` has no existing bookmarks to honour. Name
   the inconsistency in the page comment so the next reader does not "fix" it.
3. **Asia/Kolkata day boundaries, not string comparison.** `status_updated_at`
   is a `timestamptz`, so `.lte(to)` would cut the To day off at its own
   midnight UTC and lose most of it. The clauses are
   `.gte(istDayStart(from))` and `.lt(istDayStart(dayAfter(to)))`. Two small
   helpers belong in **`src/lib/dates.ts`** — the only module permitted to know
   the timezone — and **not** in `weeks.ts`, which does its arithmetic in UTC on
   purpose so a stored `YYYY-MM-DD` cannot drift. India has no DST, so the
   `+05:30` offset is fixed; say so, because that is what makes a literal offset
   safe here where it would not be elsewhere.
4. **NO STATUS is excluded by a range, and the screen says so.** Those rows have
   a null `status_updated_at` by construction. Including them would be claiming
   they moved inside the window; dropping them silently would break the
   reconciliation C1 just built. So: when a range is active the NO STATUS
   column renders as an em dash with a `title`/footnote, the header reads
   "T of N institutes", the summary line says "statuses that moved between X
   and Y", and the C1 reconciliation test asserts `grand === filteredTotal` and
   `filteredTotal <= model.total`.

### Exact files to touch

* `src/app/(app)/institutes/report/page.tsx` — read `searchParams`, parse,
  render the control, pass the range down, adjust the header and the footnote.
* `src/lib/institute-status-report.ts` — accept an optional range; filter the
  read; return `filteredTotal` alongside `total`; drop the unset column when a
  range is active.
* `src/lib/validation/` — a new `pipelineRangeSchema` (both ends optional, each
  a real date, `from <= to`, no `MAX_RANGE_DAYS` cap since all-time is the
  default). Mirror `exportRangeSchema`'s real-date refinement rather than
  re-inventing it.
* `src/lib/dates.ts` — `istDayStart(iso)` and `istDayAfter(iso)`.
* `src/components/report/range-controls.tsx` — reuse as-is if it can carry
  empty ends and a "Clear" action; otherwise a sibling `OptionalRangeControls`.
  Prefer extending it: one control, no drift, same reason `ExportExcel` is one
  component for two buttons.
* `src/lib/institutes.ts` — `listInstitutes()` grows an optional range
  argument, or the report reads `institutes` directly. **Prefer the argument**:
  a second query against that table would be a second place the column list and
  the owner-name join could drift.

### Data-model changes

**None. No migration.** `status_updated_at` is 0001's.

### UI touchpoints

A From / To / Apply / Clear bar above the table, matching `/team/report`'s
`RangeControls`. The header figure becomes "T of N institutes" while a range is
active. The NO STATUS column shows an em dash with one line of explanation.

### Test & live-verify

* **Unit** — `pipelineRangeSchema`: both ends absent is valid; an inverted range
  is refused with a sentence; `2026-02-31` is refused.
  `dates.test.ts` gains `istDayStart` / `istDayAfter` under the five timezones
  that file already reloads itself in — the boundary case that matters is
  23:45 IST on the To day, which must be inside the range.
* **Integration** (live DB) — insert institutes whose statuses were set either
  side of a boundary, then assert the filtered count. This is the half that
  cannot be proven in TypeScript, because the predicate is a `timestamptz`
  comparison the database performs.
* **Live** — as admin: apply a range, confirm the NO STATUS column goes to an
  em dash and the header switches to "T of N"; clear it and confirm the report
  returns byte-for-byte to its current form. As rep: still 307.

### Risks, unknowns, RLS, .xlsx

* **The biggest risk is semantic, not technical:** a range over
  `status_updated_at` answers "whose status *moved* in this window", which is a
  different question from "where the pipeline stands". Both are useful; only one
  is what the screen is titled. The header and summary line are what keep them
  apart, and they are not optional polish.
* **`institute_status_history` (0011) is the better source for a true
  as-of-date report** and is already RLS-scoped through the parent institute.
  If the client's real ask is "what did the pipeline look like on 31 March",
  this filter will not answer it and a history-sourced report would. Worth
  asking before building.
* **No RLS change. No .xlsx change** (unless the pipeline export in §C.1 is in
  scope, in which case the range rides in its query string too).

**Size: M**

---

## C.3 Column sorting on the status report

### What exists now

Row order is fixed in `getInstituteStatusModel()`: `listReps()` order (which is
`profiles … .eq("role","rep").order("name")`, so A–Z), then any non-rep owner,
then "Unassigned". That last placement is documented as a rule, not a
coincidence: "it sits after the people because it is not one."

`ActivityGridTable` emits plain `<th>` cells with no links.

### The proposed change

`?sort=` and `?dir=`, server-rendered, default `sort=rep&dir=asc` — **today's
order exactly**, so an unparameterised URL renders what it renders now.

* `sort` accepts `rep`, `total`, `__none__` (the NO STATUS column), or any
  status string present as a column. `dir` accepts `asc` / `desc`.
* **Unknown values fall back to the default silently.** That is `/institutes`'s
  documented stance for presentation parameters ("a stale bookmark lands on a
  readable answer, not an error page"), and it is deliberately *unlike*
  `/team/report`, which hard-errors on a bad range because a wrong range
  produces wrong *numbers*. A wrong sort produces the right numbers in a
  different order. Say this in the page comment; the inconsistency is reasoned,
  not accidental.
* **Sorting happens in `getInstituteStatusModel()`**, over `model.reps`, and
  **the pinned rows stay pinned under every sort**: reps sort among themselves,
  then non-rep owners, then Unassigned, always. Letting Unassigned sort into
  the middle would discard the one rule the file states about it.
* **Ties break by rep name, ascending, always** — so the order is stable and two
  renders of the same data cannot differ.
* Header cells become links built by one shared helper that carries the current
  `from` / `to` through, so sorting composes with C2 and the two parameter sets
  cannot drift. `ActivityGridTable` grows optional `sortHrefFor(columnIndex)`
  and `sortState` props; when they are absent it renders exactly as now, so the
  Overview card and `/team/report` are untouched.

**Tap targets.** A sortable `<th>` in a grid this dense cannot reach 44px — the
same constraint `CountLink`'s `mdOnly` documents. So: header links are
`hidden md:inline`, and below `md` a "Sort by…" `Select` that navigates gives
the thumb-reachable equivalent. Flagging this rather than quietly shipping a
26px tap target.

### Exact files to touch

* `src/app/(app)/institutes/report/page.tsx` — parse `sort` / `dir`, pass down,
  render the mobile Select.
* `src/lib/institute-status-report.ts` — the comparator and the pinning rule.
* `src/components/report/activity-grid-table.tsx` — optional sort props,
  `aria-sort` on the active header, a sort affordance reusing
  `COUNT_LINK_CLASS` so it cannot look like a third kind of link.
* `src/lib/validation/` — the sort parameters, beside C2's range schema.

### Data-model changes

**None. No migration.**

### UI touchpoints

Clickable column headers from `md` up with an `aria-sort` and a direction
caret; a "Sort by…" Select below `md`; the active column's header emphasised.

### Test & live-verify

* **Unit** — the comparator: default order is unchanged; `desc` on a status
  column orders by that count; Unassigned and non-rep owners stay last in every
  one of the orders; ties break by name; an unknown `sort` returns the default
  order rather than throwing.
* **Live** — as admin, sort by a status descending, confirm the top row really
  does hold the most, confirm Unassigned is still last, then add `?from=`/`?to=`
  and confirm both parameters survive each other. As rep: still 307.

### Risks, unknowns, RLS, .xlsx

* **The .xlsx is unaffected**, and should stay so: `activitySheet()` must keep
  receiving rows in the model's own order, because a saved pivot written against
  last month's file does not expect the rows to have moved. If the client wants
  the export to honour the on-screen sort, that is a separate decision with a
  stated cost.
* **No RLS change.** Ordering changes nothing about which rows exist.

**Size: S/M**

---

# Phase B — institute details

## B.1 A rep may edit an institute once, then it locks

### What exists now

| | |
| --- | --- |
`src/lib/institute-actions.ts` | `createInstitute()` (any signed-in user; writes `registered_by = user.id` because `institutes_insert` demands it) and `updateInstitute()` (**`requireAdmin()` on the first line**). Its doc comment lists the three things an edit must not touch: `registered_by`, `campus_id`, `status`.
`src/app/(app)/institutes/[id]/edit/page.tsx` | Admin-only three times over: `proxy.ts` via `ADMIN_ONLY_PATTERNS`, then `isAdmin()` → `redirect("/")`, then the action's own gate.
`src/lib/nav.ts:160` | `ADMIN_ONLY_PATTERNS = [/^\/institutes\/[^/]+\/edit(?:\/|$)/, /^\/institutes\/report(?:\/|$)/]`.
`src/components/institutes/institute-form.tsx` | One form, two jobs. `editing = initial !== undefined`; `campuses` empty in edit mode is what takes the campus field off.
`institutes_update` (0028) | `using` **and** `with check`: `is_admin() or (campus_id = my_campus() and registered_by = auth.uid())`.
`institutes/[id]/page.tsx:173` | The Edit button is `{admin && …}`.

**The RLS already permits this.** The owning rep has passed `institutes_update`
on both halves since 0028. Nothing about the boundary needs to widen — which is
the single most useful fact about B1.

### The proposed change

Three columns and one **column-scoped** trigger, plus unlocking the three app
layers for the owner.

**Why column-scoped is the whole feature.** `log_visit()` is `security invoker`
and does `update public.institutes set status = p_status_set_to` *as the rep*
(`0033:303`). A trigger that consumed the one edit on any rep UPDATE would burn
it on that rep's first logged visit, and the symptom would be "I was never
allowed to edit anything" with nothing on screen to explain it. Two mechanisms,
stacked the way this schema stacks everything:

1. `create trigger … before update of <detail columns> on public.institutes` —
   the `UPDATE OF` list fires only when one of those columns is in the SET list.
   `log_visit()` sets `status` alone, so it never reaches the trigger.
   `guard_institute_owner` (`before update of registered_by`) and
   `correct_member_campus()` (`campus_id`) are likewise untouched — three
   triggers on one table, three disjoint column lists.
2. Inside the body, `new.<col> is distinct from old.<col>` across the detail
   columns, so a no-op save does not spend the edit either.

The detail columns are exactly `instituteSchema`'s minus the three the editor
already refuses: `name, type, pincode, address, area, city, state, boards,
principal_name, principal_mobile, decision_maker_name,
decision_maker_designation, decision_maker_mobile, class11, class12`. **Not**
`status`, `status_updated_at`, `status_updated_by`, `registered_by`,
`campus_id`.

The trigger **stamps the counter itself** and refuses a client that tries to.
That is `guard_checkout_missing()`'s shape (FO020) and its lesson verbatim:
deleting a button does not close the path behind it, and `institutes_update`
would otherwise let a rep reset their own allowance by hand.

An **admin is exempt and does not consume the allowance** — `if
public.is_admin() then return new; end if` before anything else. "Admin keeps
full edit" is the client's words, and it also means an admin correcting a typo
does not spend the rep's one chance.

### Exact files to touch

* `supabase/migrations/0036_rep_edits_once.sql` — new.
* `src/lib/nav.ts` — **remove** `/^\/institutes\/[^/]+\/edit(?:\/|$)/` from
  `ADMIN_ONLY_PATTERNS`. It has to go: the list is static and cannot express
  "admin, or the owner who has an edit left". The page then carries the gate,
  which drops `/institutes/[id]/edit` from three layers to two —
  **a real reduction in defence, and it must be called out loudly in both the
  page comment and `nav.test.ts`.** The remaining two are the page's own server
  check and the action's, with RLS and FO030 under them.
* `src/app/(app)/institutes/[id]/edit/page.tsx` — replace `if (!isAdmin(user))
  redirect("/")` with: admin → allow; owner with an edit left → allow; owner
  with none → `redirect(`/institutes/${id}`)`; anyone else → the institute is
  not readable to them at all, so `getInstitute()` already returns null and
  `notFound()` fires. Keep `redirect` rather than `notFound()` for the role
  refusal, for the reason this file already states (a streamed `notFound()`
  answers 200).
* `src/lib/institute-actions.ts` — `updateInstitute()`'s gate becomes
  "admin **or** the owning rep with an allowance", and it must map **FO030** to
  a sentence the way every other FO code is mapped (by code, never by message
  text). The `campus_id` refusal and the `registered_by` omission stay exactly
  as they are.
* `src/components/institutes/institute-form.tsx` — a notice in edit mode when
  the submitter is a rep: "this is your one correction; after saving, ask an
  admin for further changes". Not a disabled state — the rep can still cancel.
* `src/app/(app)/institutes/[id]/page.tsx` — the Edit button shows for an admin
  **or** an owner with an allowance left; and for an owner who has spent it,
  a muted line saying so, because a button that silently disappears reads as a
  bug.
* `src/lib/institutes.ts` — add the three columns to `COLUMNS` and to the
  `Institute` interface.
* `src/lib/errors.ts` — nothing; FO030 is mapped at the action, like FO022.
* `scripts/check-schema.mjs` — one `PROBES` entry.
* `tests/unit/nav.test.ts` — assert the pattern list is now one entry and that
  `/institutes/report` is still in it.

### Data-model changes — **migration 0036**

```
institutes.rep_edits_used  smallint not null default 0
institutes.rep_edited_at   timestamptz
institutes.rep_edited_by   uuid references public.profiles (id) on delete set null
constraint institutes_rep_edits_used_valid check (rep_edits_used between 0 and 1)
function public.guard_rep_institute_edit()  -- security definer, search_path '', FO030
trigger  institutes_rep_edit_guard
         before update of <the 15 detail columns> on public.institutes
```

`smallint` with a `0..1` CHECK rather than a boolean, so raising the allowance
to two later is a CHECK change and not a column rename — and so the column reads
as a count, which is what it is.

`on delete set null` on `rep_edited_by`, following `registered_by` and
`status_updated_by`: removing a departed rep must never be blocked by an audit
stamp.

**Assertion block must prove:** exactly one `guard_rep_institute_edit`
overload; it is DEFINER with `search_path` pinned (`LIKE 'search_path=%'`, per
0035's recorded trap); its body calls `public.is_admin()`; the trigger exists,
is `BEFORE UPDATE`, and its `tgattr` column list **does not include `status`**
— that last one is the whole point of the file and the one thing a careless
edit would break invisibly; `institutes_update` still carries the owner
predicate on both halves (B1 leans on it and does not restate it);
`guard_institute_owner` (FO010/FO025) and `institutes_touch_status` are both
still attached.

### UI touchpoints

An Edit button on the institute detail page for the owning rep; a one-time
notice on the form; a spent-allowance line where the button was. Nothing on
`/institutes` changes.

### Test & live-verify

* **Unit** — the gate predicate (admin / owner-with-allowance /
  owner-without / stranger) as a pure function, so all four branches are
  provable without a database; `nav.test.ts` for the pattern removal.
* **Integration (live DB) — the four that matter, and none can be proven in
  TypeScript:**
  1. rep updates `name` once → succeeds, `rep_edits_used` becomes 1;
  2. the same rep updates `name` again → **FO030**;
  3. **the regression this whole design exists to prevent** — a rep logs a
     visit via `log_visit()` and `rep_edits_used` stays **0**;
  4. a rep who has spent their edit sets `rep_edits_used` back to 0 by hand →
     refused; and an admin's edit does not increment it.
* **Live render** — as a rep: open your own institute, Edit, save a name change,
  confirm the button is replaced by the explanation, confirm `/log` still works
  afterwards. As an admin: edit the same institute twice and confirm neither
  touched the counter.

### Risks, unknowns, RLS, .xlsx

* **Three layers become two.** The honest cost of removing the
  `ADMIN_ONLY_PATTERNS` entry. Mitigated by the page gate, the action gate, RLS
  and FO030 — four checks, one fewer *edge* check. Record it in the page
  comment the way that file already records why it needed the pattern at all.
* **No RLS widening.** `institutes_update` is unchanged. Worth stating to the
  client, because "let reps edit" sounds like a permissions change and is not.
* **Unknown:** does "once" mean once ever, or once per institute? The plan
  assumes **per institute** (the column is on `institutes`), which matches "edit
  an institute's details exactly once after first creating them". Confirm.
* **Unknown:** should the allowance reset when an admin reassigns the institute
  to a different rep? A new owner inheriting a spent allowance can correct
  nothing. **Recommend: reset on reassignment** — add it to
  `guard_institute_owner`'s existing body rather than a fourth trigger. Confirm
  with the client; it is a one-line addition now and a second migration later.
* **No .xlsx change.**

**Size: M**

---

## B.2 Counsellors — several per institute

### What exists now

Contacts are two fixed pairs of columns on `institutes`: `principal_name` /
`principal_mobile` (rendered as "Principal / owner") and `decision_maker_name` /
`decision_maker_designation` / `decision_maker_mobile`. Both are flat columns
with `*_mobile_valid check (… ~ '^[0-9]{10}$')` from 0001, both optional, both
rendered by `institutes/[id]/page.tsx`'s "Contacts" `FormSection` and the
`keyContact()` helper in `institutes-browser.tsx`.

There is **no repeating child collection on `institutes` anywhere**, so B2
introduces the first one. The closest precedent for the RLS shape is
`institute_status_history` (0011, re-scoped by 0028): a child table whose policy
reaches **through the parent institute** rather than duplicating
`registered_by` onto the child. 0028 §2 calls that table "the quiet one" and
explains the trap exactly: scoping only the parent *moves* a leak instead of
closing it, because a rep can read the child without ever selecting the parent.

### The proposed change

A child table, `public.institute_counsellors`, with name / phone / email, and a
`+` control on both the institute form and the detail page, for admin and for
the owning rep.

**A child table, not an array column and not three more flat columns.** An
array of JSON would put a contact's phone outside the reach of the CHECK that
every other phone in this schema has to satisfy, and three more columns caps the
count at three and names the cap in the schema.

**RLS reaches through the parent, both halves, for all four verbs.** `select`
mirrors `institute_status_history_select` verbatim. `insert` / `update` /
`delete` get the same predicate on `using` **and** `with check` — 0020b's lesson
and 0027's, restated: `using` decides which rows may be targeted, `with check`
decides what they may become, and scoping one leaves a door on the other side.

**The write predicate is the institute's own update predicate**, so "who may add
a counsellor" is the same question as "who may edit this institute":
`is_admin() or exists (select 1 from public.institutes i where i.id =
institute_id and i.campus_id = public.my_campus() and i.registered_by = (select
auth.uid()))`.

**A counsellor is NOT part of B1's one-time allowance**, and this needs deciding
rather than assuming. The recommendation: **adding or removing a counsellor is
always allowed for the owner**, uncapped. A counsellor list is a working record
that changes as staff change, not a registration detail being corrected; capping
it at one change would make the feature useless within a term. That is also why
the trigger in 0036 is scoped to a column list on `institutes` — a child table
never touches those columns, so the two features do not interact at all. Say so
in both migrations.

**Deleting is a real delete, not a retirement** — unlike a status or a purpose,
and for the reason those two are retired: nothing else references a counsellow
row. No visit, no plan, no history points at one, so removing it strands
nothing. (If the client later wants "who did we speak to in March", that is a
`created_at` / `removed_at` pair, and it is a different feature.)

### Exact files to touch

* `supabase/migrations/0037_institute_counsellors.sql` — new.
* `src/lib/validation/institute.ts` — `counsellorSchema` (name required,
  `max(120)`; phone `optionalMobile` — reuse the existing one, do not write a
  second 10-digit rule; email optional via `z.email().max(254)`, matching
  `newMemberSchema`'s), and a `counsellorsFormDataToInput()` for the repeating
  rows. Keep it in this file so the browser and the server read the form
  identically, as `instituteFormDataToInput()` already does.
* `src/lib/institutes.ts` — a `Counsellor` interface and a batched read. **One
  query for the whole list, not one per institute**, following
  `withOwnerNames()`'s shape — and `listInstitutes()` must **not** start
  fetching them, because the registry loads whole and already carries a few
  hundred rows.
* `src/lib/institute-actions.ts` — `addCounsellor()` / `updateCounsellor()` /
  `removeCounsellor()`. Each `requireAdmin()`-or-owner, each re-parsing
  server-side ("the client check is a courtesy, this one is the rule"), each
  `revalidatePath("/institutes", "layout")`.
* `src/components/institutes/counsellors-panel.tsx` — new. A list with a `+`
  that appends a row, mirroring `PurposesPanel`'s add-and-list shape and
  `RemoveButton`'s confirm. 44px targets; `tel:` links on phones, matching the
  existing `Phone` component on the detail page.
* `src/app/(app)/institutes/[id]/page.tsx` — a Counsellors block inside or
  beside the Contacts `FormSection`.
* `src/components/institutes/institute-form.tsx` — in **edit** mode only.
  In **create** mode the institute has no id yet, so a counsellor row has no
  parent to reference; adding them on the create form would mean either a
  client-side staging array posted alongside (and a second write path through
  `createInstitute()`) or a redirect-then-add. **Recommend: edit/detail only, and
  the create flow already redirects to the detail page** (`redirect(
  \`/institutes/${data.id}\`)`), which is exactly where the `+` lives. Simpler,
  one write path, no staging.
* `src/components/institutes/institutes-browser.tsx` — **no change.**
  `keyContact()` stays `decision_maker_name ?? principal_name`; adding a
  counsellor to the registry row would mean fetching them for every institute.
* `scripts/check-schema.mjs` — one `PROBES` entry.

### Data-model changes — **migration 0037**

```
create table public.institute_counsellors (
  id            uuid primary key default gen_random_uuid(),
  institute_id  uuid not null references public.institutes (id) on delete cascade,
  name          text not null,
  phone         text,
  email         text,
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),

  constraint institute_counsellors_name_present check (btrim(name) <> ''),
  constraint institute_counsellors_phone_valid  check (phone is null or phone ~ '^[0-9]{10}$'),
  constraint institute_counsellors_email_valid  check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
)
index institute_counsellors_by_institute on (institute_id)
alter table … enable row level security
revoke all … from authenticated, anon
grant select, insert, update, delete … to authenticated
4 policies: institute_counsellors_{select,insert,update,delete}
```

`on delete cascade`, unlike `visits.institute_id`'s `restrict`: a visit is
evidence that must outlive a tidy-up, a contact card is not, and an admin
deleting an institute should not be blocked by one. `institutes_delete` is
admin-only and `visits`' `restrict` still refuses an institute with history, so
cascade here cannot destroy anything that matters.

The email CHECK is deliberately loose — it is a backstop against garbage, not
the rule. `z.email()` in the schema is the rule, and email is not load-bearing
for anything, so it does not get the three-places treatment Rule 12 gets.

**Assertion block must prove:** the table exists with all three contact columns;
RLS is enabled; **all four policies exist and every one of them reaches through
`public.institutes`** (check the policy expression contains `registered_by` and
`my_campus`, the way 0027 §3 walks its policies); `authenticated` has no
`select` grant left from any blanket statement; the FK is `on delete cascade`;
and — because this file leans on it without restating it —
`institutes_select` still carries the 0028 owner predicate.

### UI touchpoints

A Counsellors list with a `+` on the institute detail page (admin and owner),
each row name / phone / email with a remove control; the same panel in the edit
form. Tappable `tel:` and `mailto:`. Empty state: "No counsellors recorded."

### Test & live-verify

* **Unit** — `counsellorSchema`: a blank name is refused; a 9-digit phone is
  refused; an absent phone and an absent email are both fine; a 300-character
  name is refused. Plus `counsellorsFormDataToInput()` round-tripping several
  rows, which is where an off-by-one in the repeating-field naming would hide.
* **Integration (live DB) — this is where B2's risk lives, and all five are
  about RLS:** rep A adds a counsellor to their own institute → ok; rep B reads
  it → **zero rows** (this is the 0028 §2 trap, one table along); rep B inserts
  one against rep A's institute → refused; an admin reads and writes both →
  ok; deleting the institute cascades the counsellors away.
* **Live render** — as an owning rep: add two counsellors, confirm both appear
  on the detail page and in the edit form, remove one. As an admin: same, on
  another rep's institute. As a second rep: confirm that institute is not even
  reachable (0028 already hides it).

### Risks, unknowns, RLS, .xlsx

* **This widens the RLS surface — a new table with four new policies.** It is
  the only item in this whole plan that does. The predicate is copied from an
  existing policy rather than written fresh, and the integration tests above are
  what make "copied correctly" a fact rather than a claim.
* **Unknown (§2 item 4):** "alongside owner and principal" — confirm that means
  the existing `principal_*` ("Principal / owner") and `decision_maker_*`
  fields, and that neither is being replaced.
* **Unknown:** should a counsellor carry a designation, the way
  `decision_maker_designation` does? Cheap to add now, a migration later.
* **Unknown:** does a counsellor's phone need to appear in the closing report's
  "person met" question? That question is `met_name` / `met_phone` on `visits`,
  and CLAUDE.md records it as **withdrawn** ("#17: the decision-maker lives on
  the institute, not on the visit") with the parameters passed as explicit
  nulls. Wiring counsellors into it would be un-withdrawing that question —
  out of scope, and worth confirming it stays out.
* **No .xlsx change.**

**Size: M**

---

# Phase A — daily plan & follow-ups

## The one decision that shapes all of A

**A follow-up CALL must not be a `daily_plans` row.** This is the structural
call, and it is worth the space.

`daily_plans` is the most heavily loaded table in the schema. It is read in
**22 places in `src/`** and referenced **~145 times across the migrations**. It
is specifically:

* the table **Rule 2's meeting gate** checks a visit against
  (`enforce_meeting_gate()`), which is why CLAUDE.md says the Dashboard owning
  the plan flow is "load-bearing, not a layout preference";
* **Rule 7's Meetings source** — `daily_plans where meetings_actual = 1`, in
  `week-summary.ts`, `activity-report.ts` **and** `activity-export.ts`;
* the **denominator of the admin Overview's "Visits today" tile**
  (`plannedToday`, counted as every `daily_plans` row for today);
* the row **five triggers** are attached to: `enforce_checkin_located` (FO012),
  `enforce_checkin_before_visit` (FO009), `guard_checkin_cycle_final` (FO014),
  `guard_checkout_missing` (FO020), `enforce_plan_institute_owned` (FO026);
* constrained by `daily_plans_one_open_visit`, the partial unique index that
  **is** FO013 — one open visit per rep, keyed on `(member)` alone.

A call has no arrival, no photograph, no location, no check-out and no activity.
Putting it in this table means every one of those readers and triggers has to
learn to exclude a kind of row it was not written for — and the failure mode is
not a crash. It is the Overview tile quietly counting phone calls as planned
visits, and `getTodayPlan()` returning rows the check-in flow cannot handle.
That is precisely the class of bug 0033's own comments were written to prevent
("not a crash; a quietly wrong column, which is worse").

So: **a new table, `public.follow_up_tasks`.** It costs one migration and buys
total isolation — Rule 7, the meeting gate, the eight metrics, the .xlsx and
every trigger above are untouched by the whole of Phase A.

---

## A.3 Log Visit gains "Next action" (planned first; everything else builds on it)

### What exists now

`src/components/visits/log-visit-form.tsx` (603 lines) — the single status-driven
`FormSection`: Status, then (conditionally) Follow-up Date, Event date, then
`FeedbackFields`. Submission goes to `logAndFileVisit()` in
`src/lib/feedback-actions.ts`, which calls **two** RPCs: `log_visit()` then
`close_visit()`.

`close_visit()` is 19 defaulted parameters. `visits.follow_up_date` is written
by `log_visit()`, never by `close_visit()` — CLAUDE.md is explicit that
`close_visit()` "never wrote `follow_up_date`", which was a live bug once.

The overload ceremony for `close_visit()` is established: 0019 and 0022 both
`drop function public.close_visit(<old signature>)`, create the new one, and
assert `count(*) = 1` overloads. 0030 asserts the same with nothing to drop.

### The proposed change

* `visits.next_action text` — `null | 'call' | 'meeting'`, nullable because
  every visit already logged has no answer and a NOT NULL could not be built
  against them (0027's lesson, pointing the other way).
* A "Next action" control on Log Visit, in the status-driven section after the
  follow-up date, because it is the same question one step on.
* Choosing one creates a `follow_up_tasks` row of that `kind`, **in the same
  transaction as the report**, which means inside `close_visit()` — it already
  writes two tables for exactly this reason ("a check-out is not a thing you
  want half of"). A third RPC from the action would add a third seam.
* `kind = 'meeting'` creates a **prompt, not a plan row.** It does not satisfy
  the meeting gate. Converting it into an actual visit is one tap that goes
  through `daily_plans` exactly as `startFollowUp()` already does. Otherwise A3
  would be a second writer in front of the row Rule 2 checks — the thing screen
  ownership exists to prevent.
* A `meeting` task carries a `purpose_id`, because the eventual plan row needs
  one (see A.2's problem below). A `call` task carries none.

### Exact files to touch

* `supabase/migrations/0038_follow_up_tasks.sql` — table + `visits.next_action`.
* `supabase/migrations/0039_close_visit_next_action.sql` — the overload.
* `src/lib/validation/visit.ts` — `next_action` in `baseVisitSchema` and in
  `visitFormDataToInput()`; a `superRefine` tying `follow_up_kind` to a due date
  the way `followUpRequired()` ties an open status to one.
* `src/lib/validation/feedback.ts` — if the task fields ride on the report half.
  **Decide once**: the follow-up pair lives in `visitSchema` alone, deliberately
  (CLAUDE.md: "The follow-up is NOT part of this form"), so the next action
  belongs there too, with `close_visit()` receiving it from `visit.*` rather
  than `feedback.*`. Mirror the comment `logAndFileVisit()` already carries at
  `p_follow_up_date`.
* `src/lib/feedback-actions.ts` — pass the four new params at **both** call
  sites, and add the new FO code to `RPC_MESSAGES` (mapped by code, never by
  message text).
* `src/components/visits/log-visit-form.tsx` — the control, in the existing
  section, with its draft key wired through `patchDraft` like every other field.
* `src/components/visits/feedback-only-form.tsx` — **the recovery path must ask
  it too**, or the one route that skips Log Visit becomes the route that files a
  report with no next action. `submitFeedback()` has the same requirement, for
  the reason its own comment gives about the status-driven fields.
* `src/lib/visits.ts` — `listFollowUpTasks(memberId, date)`.
* `src/lib/drafts.ts` / `use-draft.ts` — the new field in the visit draft shape.

### Data-model changes — **migrations 0038 and 0039**

**0038 (additive, apply any time):**

```
create table public.follow_up_tasks (
  id            uuid primary key default gen_random_uuid(),
  member        uuid not null references public.profiles (id) on delete cascade,
  institute_id  uuid not null references public.institutes (id) on delete restrict,
  kind          text not null,
  due_date      date not null default public.app_today(),
  purpose_id    uuid references public.purposes (id) on delete set null,
  from_visit_id uuid references public.visits (id) on delete set null,
  note          text,
  outcome       text,
  done_at       timestamptz,
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),

  constraint follow_up_tasks_kind_valid    check (kind in ('call', 'meeting')),
  constraint follow_up_tasks_outcome_valid check (outcome is null or outcome in ('done','no_answer','rescheduled')),
  constraint follow_up_tasks_note_length   check (note is null or length(note) <= 300),
  constraint follow_up_tasks_purpose_for_meetings check (kind = 'meeting' or purpose_id is null)
)
index follow_up_tasks_open on (member, due_date) where done_at is null

alter table public.visits add column if not exists next_action text
constraint visits_next_action_valid check (next_action is null or next_action in ('call','meeting'))

function public.enforce_task_institute_owned()  -- FO031, mirrors FO026
trigger  follow_up_tasks_institute_owned before insert or update on public.follow_up_tasks

4 policies, all `member = (select auth.uid()) or public.is_admin()`
```

**`default public.app_today()`, never `current_date`.** This is the
`todayISO()` / `app_today()` lockstep rule (0008), and it is not optional: a
task created at 23:00 IST must be dated that day, not the next. `daily_plans.date`
already has this exact default (`0008:93`).

The partial index is keyed `(member, due_date) where done_at is null` because
every read is "what is open for this rep", the same shape
`daily_plans_one_open_visit` uses.

**FO031 mirrors FO026 rather than reusing it.** A task against an institute the
rep does not own would be a task they can never act on — and reps DO see
institutes a colleague left open on Pending (`getOpenFollowUps()` is scoped by
institute RLS, and a row "says whose it is rather than hiding it"). So the
trigger must refuse with a sentence naming the owner, not silently.

**0039 (apply before deploy):** `drop function public.close_visit(<the 19-arg
signature>)`, create the 23-arg version with `p_next_action`,
`p_follow_up_kind`, `p_follow_up_due`, `p_follow_up_note` all defaulted,
inserting the task inside the same transaction. Assertion: exactly one
`close_visit` overload, `log_visit` still exactly one, `security invoker`
preserved (a DEFINER rewrite would punch through campus scoping — CLAUDE.md is
explicit), and FO015/FO017/FO018/FO019 still raised.

### UI touchpoints

One "Next action" control (Call / Meeting / nothing) with a due date, on Log
Visit and on the recovery form. On the Dashboard, A1's second section.

### Test & live-verify

* **Unit** — `visitSchema` with each `next_action` value and with none; a
  `meeting` next action requires a purpose; a `call` refuses one;
  `feedback.test.ts`'s existing invariant extended: **every field the form
  collects is one `close_visit()` writes** (the test that currently asserts the
  whole shape).
* **Integration (live DB)** — `close_visit()` writes visit, task and check-out
  in one transaction, and a deliberately-failing task insert rolls the report
  back too; FO031 refuses a task against a colleague's institute; exactly one
  `close_visit` overload exists; **and the regression guard: Rule 7's eight
  numbers and `institutesCovered` are unchanged by a day that contains tasks**
  — which is the claim the whole "separate table" decision rests on.
* **Live** — as a rep, log a visit choosing Call, confirm it appears in the
  plan's Follow-up calls section and nowhere in the Meetings section; confirm
  `/targets` and the admin Overview tile are both unmoved.

### Risks

* **0039 is deploy-coupled** — apply before deploy. Defaulted parameters make
  that direction safe; the reverse answers PGRST202.
* **Unknown:** can a call be logged as *done* with an outcome, or is it just a
  reminder? The `outcome` column assumes the first. E's 16:00 / 19:00 alerts
  need "still pending", which needs `done_at`, so some completion action is
  required. Confirm the wording the client wants on it.

**Size: M/L**

---

## A.1 The plan splits into Meetings and Follow-up calls

**What exists now.** `src/components/dashboard/daily-plan.tsx` already splits
`entries` into `open` and `done` by `visitStatusOf()` and numbers repeat visits
"visit 2 of 3". `TodaySnapshot` carries Planned / Held above it.

**Proposed change.** Two labelled sections inside the same Card: **Meetings**
(today's `daily_plans`, keeping the existing open/done split and the
Check-in → Continue chain untouched) and **Follow-up calls** (today's
`follow_up_tasks where kind='call' and done_at is null`, each with a `tel:`
link and a "Done / No answer" control). A `kind='meeting'` task renders in a
third, quieter place — "coming up" — with one tap that adds it to the plan.

**Files.** `daily-plan.tsx`; `(app)/page.tsx` (fetch the tasks, wrapped in
`settled()` like every other fetch on that screen — "this is the screen a rep
lands on"); `today-snapshot.tsx` only if the client wants a Calls tile, which
would need the same argument the deleted "Open loops" tile lost (two numbers
under one word is how a team stops trusting both).

**Data model.** None — A3's table.

**Test.** Unit: the splitter, including a day with calls and no meetings and the
reverse. Live: as a rep with both kinds on one day.

**Risk.** Keep the Meetings section's markup as-is. It carries the stacking fix
documented in that file (the `sm:flex-row` comment about `CheckInButton`'s
256px guidance box), and a rewrite would silently reintroduce the clipped
button on a 360px phone.

**Size: S**

---

## A.2 Morning institute tick-list

**What exists now.** `DailyPlan`'s add form: one institute `Select`, one purpose
`Select`, a conditional note, one `addToDailyPlan` submit per entry.
`listInstitutesForPicker()` returns the rep's own institutes (RLS-narrowed since
0028).

**The problem the brief does not mention.** `daily_plans.purpose` is **NOT
NULL** and `purpose_id` is what derives the visit's activity, which decides
which weekly metric it feeds, whether the meeting gate applies, and whether
Rule 3's CHECK will accept it. `addToDailyPlan()` resolves the purpose
server-side and refuses without one. **So a tick-list that collects institutes
and no purpose cannot produce a plan row that can ever be logged** — the rep
would reach `/log` and hit the "This visit needs its purpose set again" dead end
that `plannedActivityIsValid()` guards.

**Three options, with a recommendation:**

| | |
| --- | --- |
| **(a) One purpose for the batch** ⭐ | A purpose `Select` above the tick-list; every ticked institute gets it. One tap per institute, one purpose decision for the morning. Matches how a rep actually plans ("I'm doing first meetings today"). |
| (b) A purpose per tick | Correct but defeats the point — it is the current form with checkboxes. |
| (c) A default purpose | Rejected, for `PurposesPanel`'s stated reason: a picker pre-set to "Meeting" lets the wrong metric be chosen silently, for ever. |

**Recommend (a)**, with a per-row override after ticking for the rep who wants
one, and the purpose picker mounting **empty and required** — the rule that file
already states.

**Proposed change.** A new `morning-plan.tsx` sheet or panel: purpose at the
top, the rep's institutes as a multi-select list with search, a count
("4 selected"), one submit. A new `addManyToDailyPlan()` action: parse, resolve
the purpose once, and insert the rows. **One insert of many rows, not a loop** —
PostgREST takes an array, so it is one round trip and one transaction, and a
partial failure cannot leave half a morning planned.

**Files.** `src/components/dashboard/morning-plan.tsx` (new);
`src/lib/visit-actions.ts` (`addManyToDailyPlan`, reusing the existing
purpose lookup and the unstarted-duplicate check per institute);
`src/lib/validation/visit.ts` (a batch schema); `daily-plan.tsx` (the entry
point); `(app)/page.tsx` (nothing new to fetch — it already has `institutes` and
`purposes`).

**Data model.** **None.** `addToDailyPlan` is already an INSERT, not an upsert
(0033 made it so), so several rows are exactly what the table now permits.

**Test.** Unit: the batch schema (empty selection refused, duplicates
collapsed, a missing purpose refused). Integration: a 10-institute batch inserts
10 rows; a batch containing a colleague's institute is refused **as a whole** by
FO026, which is the behaviour to verify rather than assume. Live: as a rep, tick
five, submit, confirm five entries, then check in at one.

**Risks.** The duplicate courtesy in `addToDailyPlan()` ("already on today's
plan and you have not checked in yet") is per-institute and non-transactional;
across a batch it needs to report which institutes were skipped rather than
refusing the lot. And a rep with many institutes needs search in the list — it
is the same list `institutes-browser` filters, but this one must stay in the
browser (no round trip per keystroke), so reuse that component's reasoning, not
its code.

**Size: M**

---

## A.4 Pending gains a "today's follow-ups" filter

**What exists now.** `/pending` renders two blocks: `getUnreportedVisits()`
("Finish these first" — **must not be deleted**, it is the only route to an
orphaned report) and `getOpenFollowUps()` → `FollowUpList`. The follow-up rows
are **one per institute whose current status is OPEN**, sorted soonest-first by
`followUpDate` with undated rows last, and overdue rows get a red left border.
A rep's row may belong to a colleague (`mine: false`), because `institutes` is
institute-RLS-scoped and `visits` is member-scoped, and the row "says whose it
is rather than hiding it". Admin Pending is read-only (D10);
`startFollowUp()` refuses an admin itself.

**Proposed change — and a correction to the brief.** A filter is
straightforward: `?due=today` (plus `overdue`, `all`) as a server-side
`searchParams` filter on `followUpDate`, composing with nothing else because
Pending has no other parameters. That is **S**.

**"Auto-syncs into today's plan task" should not be an automatic insert.** Three
reasons from the code:

1. An automatic `daily_plans` INSERT is a **second writer in front of the row
   the meeting gate checks**, created without the rep's say-so. That is exactly
   what the screen-ownership rule exists to prevent, and it is why
   `startFollowUp()` is allowed to exist at all: "it seeds a row and never
   tracks one… from the redirect onwards it is the ordinary chain."
2. **It would fail silently for a large share of the rows.** FO026 refuses a
   plan row for an institute the rep does not own, and Pending deliberately
   shows institutes a colleague left open. A background sync would refuse those
   with nowhere to say so.
3. **It would break E's 10:00 alert.** That alert fires "if the rep added
   nothing beyond the auto plan" — so an auto-sync needs a provenance marker to
   tell "the rep planned this" from "the sync did". With no auto-sync, any
   `daily_plans` row for today with `assigned_by is null` **is** the rep's own,
   and the predicate is simply `count = 0`. One less column, one less way to be
   wrong.

**Recommend instead:** the filtered Pending list is the view, and each row keeps
its existing explicit one-tap `startFollowUp()`. If the client wants less
friction, add **"Add all of today's to my plan"** — one explicit tap, one batch
insert reusing A.2's action, and a plain report of which rows were skipped and
why. Explicit, auditable, and it cannot fail in the dark.

**Files.** `src/app/(app)/pending/page.tsx` (parse `?due=`, pass down);
`src/lib/visits.ts` (`getOpenFollowUps` takes an optional due filter — filter
**in the query**, not after the sort, or the "soonest first, undated last" order
has to be re-reasoned); `src/components/visits/follow-up-list.tsx` (the filter
chips, navigating like `RangeControls`); plus `follow_up_tasks` from A3 if calls
are to appear here as well as on the Dashboard — **recommend they are not**,
because the Dashboard owns today and Pending owns what is owed, and showing
calls in both invites them to disagree.

**Data model.** **None** under this recommendation.

**Test.** Unit: the due-filter predicate against `todayISO()`, including an
overdue row, a today row, a future row and an undated row, and the sort order
preserved under each filter. Live: as a rep, with rows in all four states; as an
admin, confirm the filter works and the list stays read-only.

**Size: S** (**M** if the "add all" batch action is included)

---

# Phase E — notifications

## What exists now

**Scheduling: pg_cron and pg_net are already enabled and already carry two
production jobs.**

| job | schedule | IST | source |
| --- | --- | --- | --- |
| `purge-visit-photos` | `30 19 * * *` | 01:00 | 0004 |
| `sweep-open-checkins` | `0 20 * * *` | 01:30 | 0018 |

0004 also stores `project_url` and `service_role_key` in **Vault**, and
`public.health_cron_jobs()` (0031) already reports whether both jobs are active
to a token-presenting monitor. `docs/BACKUP-RESTORE.md` already lists the cron
schedule as one of the four things migrations cannot carry.

**Delivery: nothing exists.** No email sender, no service worker in `public/`
(only `_headers` and `brand/`), no push subscription table, no WhatsApp
provider, no `Notification` API use anywhere. `src/app/manifest.ts` does declare
`display: "standalone"` with icons — which is the prerequisite for iOS web
push, and the only piece of groundwork already in place.

**Reps are reachable two ways:** `auth.users.email` (every member is created
with one, `newMemberSchema`) and `profiles.mobile` — **10 digits, no country
code** (`profiles_mobile_valid check (mobile ~ '^[0-9]{10}$')`).

**Constraints that bear on the choice:** 15 runtime dependencies with a
documented lock; every env var read in `src/lib/env.ts` and nowhere else; and
"no host-specific API may appear in application code… if a platform needs
something, it goes in config or a thin adapter module — one file, named for the
platform."

**Two findings that change E's shape:**

* **There is no "team lead" role** (§2 item 7). Read it as "admin, scoped by
  `profiles.created_by`" or accept a third role and its ripple through
  `is_admin()` and every policy that calls it.
* **A "total calls" target must NOT join `METRICS`.** Seven of the eight metrics
  are counted by `(activity, lifecycle_status)`; `public.targets` has one
  integer column per metric; `ACTIVITY_COLUMNS` folds all eight into six export
  columns; and `metricsMissingFromExport()` plus the byte-identity test assert
  that mapping is exhaustive. A ninth `METRICS` entry would either fail that
  test or add a column to the client's template. **`targets.institutes_covered`
  is the precedent**: a column on `targets` that is deliberately not in
  `METRICS`. `targets.calls` follows it — a column, a `targets_non_negative`
  extension, a row on `/targets` marked optional, and **no** entry in `METRICS`,
  `ACTIVITY_COLUMNS`, `tallyVisitMetrics()` or the .xlsx.

## The six alerts, as predicates

| Alert | IST | UTC cron | Predicate |
| --- | --- | --- | --- |
| Day plan not set | 10:00 | `30 4 * * *` | rep has 0 `daily_plans` rows for `app_today()` with `assigned_by is null` (see A.4 — no auto-sync makes this trivial) |
| Morning follow-up reminder + count | **09:00?** | `30 3 * * *` | count of `follow_up_tasks` where `due_date = app_today() and done_at is null` — **time not specified in the brief; needs a decision** |
| Follow-ups still pending | 16:00 | `30 10 * * *` | same count, still > 0 |
| Follow-ups missed | 19:00 | `30 13 * * *` | same count, still > 0 → write the miss to the record |
| Weekly plan set | Sun 19:00 | `30 13 * * 0` | no `targets` row for next week's `mondayOf()`, or one not submitted |
| Admin record: misses per day, days-missed | — | — | an aggregate over the rows the 19:00 job writes |

India has **no DST**, so the fixed `+05:30` offset makes these cron expressions
permanently correct — which is exactly why a literal offset is safe here and is
not elsewhere.

## The delivery channel — options, honestly costed

### In-app (a materialised record the app reads)

* **Needs:** one table + RLS + one `pg_cron` job to materialise each day's
  alerts. No dependency, no provider, no new env var, no platform coupling.
* **Timing:** the *evaluation* is exact and server-side; the *seeing* happens
  when the rep next opens the app. It is a state, not an interruption.
* **Portability:** perfect — pure Postgres plus app code.
* **Cost:** zero.

### Email (Resend / Postmark / SES)

* **Needs:** a provider account, a verified sending domain with SPF/DKIM, one
  new env var in `env.ts`, and a sender. No npm dependency — a `fetch()` to the
  provider's REST API, which is also what keeps it inside the 15-dep lock.
* **Sender:** `pg_net` POSTing from the existing cron job to a token-gated route
  handler (the `/api/health` + `HEALTH_CHECK_TOKEN` pattern is the worked
  example), keeping the schedule in Postgres beside the two jobs already there.
* **Timing:** exact.
* **Reality check:** reps are on phones at school gates. A 10:00 email will not
  be read.

### Web push (VAPID)

* **Needs:** a service worker (none today), a `push_subscriptions` table, two
  VAPID env vars, and per-message JWT signing **plus** `aes128gcm` payload
  encryption. The usual answer is the `web-push` npm package — **Node-only
  (`crypto`, `http`), so it breaks both the dependency lock and the Worker
  runtime.** Hand-rolling it on WebCrypto is possible and is real work.
* **iOS:** requires the PWA be added to the home screen (the manifest is ready)
  and iOS 16.4+. **A rep who has not added it gets nothing, silently** — the
  worst failure mode available for an alerting feature.
* **Timing:** exact. **Best UX match, highest build and support cost.**

### WhatsApp (Cloud API or a BSP)

* **Needs:** a Meta Business account, business verification, a sending number,
  and **an approved message template per alert** — reminders sent outside a
  24-hour customer-service window must be templates, and every wording change
  needs re-approval. Plus per-message cost.
* **Schema:** `profiles.mobile` is 10 digits with no country code, so it needs
  either a convention (`+91`) written down in one place or a column.
* **Privacy:** rep phone numbers and activity would flow through Meta —
  `/privacy` must be updated, and that is a public-surface change.
* **Reality check:** it is the one channel a rep standing at a school gate in
  India will actually read, and it is almost certainly what the client will ask
  for.

### Cloudflare Cron Triggers, specifically

A `triggers: { crons: [...] }` block in `wrangler.jsonc` plus a `scheduled()`
export. **The OpenNext adapter's generated `.open-next/worker.js` exports a
`fetch` handler and offers no supported way to add `scheduled` from app code.**
It could be patched — `scripts/trim-worker.mjs` already post-processes that
file — but that is platform coupling in exactly the place CLAUDE.md forbids it,
and it would not survive the move to a Node host the portability rule exists to
keep open. **pg_cron is already here, already proven, and travels with the
database.** Use it.

## Recommendation

> **E1: build the in-app record on pg_cron now, and design the sender interface
> while you do. E2: if one outbound channel is added, make it WhatsApp — but
> only after E1 exists, and with its real costs on the table.**

Four reasons for that order:

1. **In-app is not a lesser version of the feature — it is the feature's data
   layer.** The brief already asks for "an admin record of missed follow-ups per
   day and days-missed, visible to team lead, admin and rep." That is an in-app
   screen by definition, and it is the *same rows* every other channel would
   send. Build it once; any channel becomes a sender over those rows.
2. **It costs none of the four things this codebase guards hardest:** no new
   dependency against the 15-dep lock, no provider account, no privacy-notice
   change, no platform coupling.
3. **It is the only option verifiable end-to-end with the machinery that already
   exists** — pg_cron, a migration assertion block, and the integration suite.
4. **Then WhatsApp**, because email will not be read and push reaches only the
   reps who added the PWA, silently. Its blockers are external and slow (Meta
   verification, five template approvals, a country-code decision, a `/privacy`
   update), which is a second reason to start them in parallel with E1 rather
   than ahead of it.

## E1 — data model (**migration 0040**)

```
create table public.alert_events (
  id          uuid primary key default gen_random_uuid(),
  member      uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  for_date    date not null,
  payload     jsonb not null default '{}'::jsonb,   -- e.g. {"due": 4}
  seen_at     timestamptz,
  created_at  timestamptz not null default now(),

  constraint alert_events_kind_valid check (kind in (
    'day_plan_not_set', 'follow_ups_due', 'follow_ups_pending',
    'follow_ups_missed', 'weekly_plan_not_set')),
  constraint alert_events_unique_per_day unique (member, kind, for_date),
  constraint alert_events_payload_is_object check (jsonb_typeof(payload) = 'object')
)
index alert_events_unseen on (member, for_date desc) where seen_at is null

alter table public.targets add column if not exists calls integer not null default 0
-- and extend targets_non_negative to include it (drop + re-add; a CHECK cannot be patched)

function public.materialise_daily_alerts(p_kind text)  -- definer, search_path '', service-role only
cron: 5 jobs at the UTC times tabled above
4 policies: select `member = auth.uid() or is_admin()`; no insert/update/delete
            grant at all except an UPDATE of `seen_at` by the owner
```

`alert_events_unique_per_day` is what makes the job idempotent — a cron run that
fires twice writes one row, which matters because a re-run after a failure must
not double-count a miss. The `payload` jsonb carries the count the brief asks
for ("a morning follow-up reminder **with a count**") without a column per
alert kind. `materialise_daily_alerts()` is **service-role only** — `revoke all
… from public, anon, authenticated` — exactly as `sweep_open_checkins()` and
`health_cron_jobs()` are.

**Admin record screen:** "misses per day" and "days-missed" are both aggregates
over `alert_events where kind = 'follow_ups_missed'`, so the record needs no
second table. Render it with `CountLink` so each count opens the rows behind it,
following `3df3e09`'s own rule ("names open hubs, counts open the rows behind
them"), reached from Settings or the Overview rather than from the nav bar — the
same call `/data`, `/team/report` and `/materials/manage` got.

**`health_cron_jobs()` must learn the five new job names**, or the monitor goes
on reporting a healthy cron subsystem while the alerts have silently stopped —
which is the exact partial-failure 0031 was written to catch.

## E — files, tests, risks

**Files.** `supabase/migrations/0040_*.sql`; `src/lib/alerts.ts` (reads);
`src/lib/alert-actions.ts` (mark seen); a banner component on the Dashboard; an
admin record screen under `/team` or Settings (plus `ADMIN_ONLY_PATHS` if it is
admin-only — and note a rep must see *their own* record per the brief, so it is
probably two views of one module, not one admin page);
`src/lib/validation/weekly.ts` + `target-actions.ts` + `targets-form.tsx` +
`metric-list.tsx` for the optional `calls` target; `src/app/api/health/route.ts`
for the cron names; `scripts/check-schema.mjs`; `docs/BACKUP-RESTORE.md` (the
cron list grows from two jobs to seven).

**Tests.** Unit: each predicate as a pure function over fixture rows; the
`calls` target is optional and absent-means-no-bar; and — the guard that
matters — **`metricsMissingFromExport()` is still `[]` and the .xlsx hash is
unchanged by `targets.calls`**. Integration: `materialise_daily_alerts()` is
idempotent across two runs; it is not callable by `authenticated`; a rep reads
only their own `alert_events`; an admin reads everyone's; the five cron jobs are
registered and `health_cron_jobs()` reports them. Live: as a rep with an empty
plan, confirm the banner; as an admin, confirm the record reconciles with
Pending.

**Risks.** The `targets_non_negative` CHECK must be dropped and re-added, which
is the one statement in 0040 that is not purely additive — guard it the way
0014 guards its own CHECK additions (`if not exists (select 1 from
pg_constraint …)`). "Team lead" needs resolving before the record screen's
visibility can be built. The alert *times* are a client decision and one (the
morning reminder) is unspecified. And nothing in E touches the .xlsx or widens
RLS beyond one new own-rows-only table.

**Size: L** (E1 alone is M; E2 is M plus an external dependency measured in
weeks)

---

## 4. Verification, every phase

```
npm run lint
npm run typecheck          # runs `next typegen` first — PageProps/LayoutProps
npm test                   # unit everywhere; integration skips without the key
npm run check:schema       # per-environment, after each migration
npm run build && npx wrangler deploy --dry-run --outdir /tmp/out   # "Total Upload:"
```

Record the measured bundle size after each phase rather than trusting
CLAUDE.md's **3067 KiB** line — that figure has been wrong in both directions
before, and on the Workers Paid plan (10 MiB gzipped) it is now a fact worth
noting rather than a gate to clear.

**Live render is not optional for anything interaction-shaped**, and each
feature above names its own passes. Every one needs both roles:

* **as an admin** — C1/C2/C3 in full, B1's and B2's admin paths, E's record;
* **as a rep** — B1's one-time edit and what it looks like afterwards, B2's
  counsellor panel, every part of A, E's banner — and in each case confirm the
  admin-only routes still 307 and that `/log` still works, since B1 and A3 both
  touch the path a visit travels.

---

## 5. Open decisions, collected

Nothing below is blocking the first phase, but each one changes work downstream.

1. **Does `/institutes/report` need its own Excel export?** (§C.1) — blocking
   C1's size.
2. **Confirm the pipeline report's date filter has no default range** (§C.2),
   and that "statuses that moved in a window" is the question being asked.
3. **Is "once" per institute or once ever, and does an admin reassignment reset
   the allowance?** (§B.1)
4. **"Alongside owner and principal"** — the existing `principal_*` and
   `decision_maker_*` fields, unchanged? (§B.2) Should a counsellor carry a
   designation?
5. **One purpose per tick-list batch, or one per tick?** (§A.2) Recommendation:
   per batch, with an override.
6. **Is Pending's "auto-sync" acceptable as an explicit "add all" tap?**
   (§A.4) Recommendation: yes, and no background insert.
7. **"Team lead"** — admin scoped by `created_by`, or a third role? (§E)
8. **The morning follow-up reminder's time** — unspecified. (§E)
9. **Delivery channel** — in-app first; WhatsApp second if one outbound channel
   is funded, with Meta verification and template approval started early. (§E)
