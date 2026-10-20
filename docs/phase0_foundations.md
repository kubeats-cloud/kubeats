# Phase 0 — Foundations: gap audit

Scope note (agreed with the client before writing this): this is **not** a
greenfield investigation. KUbeats is 224 commits in, phases 1–10 shipped, live
in production for Karnavati University's admissions team. The AGENTS.md task
that requested this document describes a system with none of activity typing,
status Open/Closed classification, or follow-up tracking in place yet — that
system does not match this repository. What follows audits the **existing**
implementation against each of that task's four steps, named what already
satisfies it, and lists only the parts that are genuinely missing or
mismatched. Nothing in the schema or app code was changed to produce this
document.

---

## 1. How things are stored today

**Activities.** Six values, fixed since migration `0001_init.sql`:
`visits.activity in ('meeting','session','campus_visit','olympiad',
'application','admission')`. `public.purposes` (0024/0025) is the
admin-managed layer on top — every purpose row declares which of the six
activities it feeds (`purposes.activity`, not null) and an optional
`lifecycle` (`Set`/`Done`) for the two activities that have one
(`visits_lifecycle_matches_activity`, 0001; `purposes_lifecycle_matches_activity`,
0025 — the same CASE expression written twice so the two tables cannot
disagree). A rep never types an activity; it is derived from the purpose they
planned under.

**Statuses.** `public.institute_statuses` (0026) holds the vocabulary as data,
not a CHECK list: `status, category ('open'|'closed'), tone, sort_order,
is_active, asks_expected_date, asks_session_detail, asks_head_count`.
`institutes.status`, `visits.status_set_to` and
`institute_status_history.status` are foreign keys into it
(`on update restrict on delete restrict`), so an admin can rename an unused
status or retire one, but never produce a status no table agrees on.

**Follow-ups.** Two separate mechanisms, not one:
- **Institute-level, derived, live.** `Pending` (`/pending`) is one row per
  institute whose *current* `institutes.status` is in the open category —
  no stored list, re-derived every request from `institute_status_is_open()`.
  An open status requires a follow-up `date` on the visit that set it
  (`enforce_follow_up_when_open`, FO016); a closed one does not.
- **Task-level, explicit, admin/rep-assignable.** `public.follow_up_tasks`
  (0038): `member, institute_id, kind, due_date, note, done_at, outcome`.
  Deliberately **not** a `daily_plans` row (see that migration's header) —
  `daily_plans` is Rule 7's Meetings denominator and five triggers' subject,
  and a phone call has none of a visit's shape.

**Targets.** `public.targets` (0001, re-enabled 0021) is a wholly separate
table from `institute_statuses` — one row per rep per week, eight integer
columns, a `locked` boolean and an `enforce_target_lock` trigger. Nothing
shares a table or a vocabulary with institute statuses; the two have never
been merged.

---

## 2. Where activity counts are computed — and the "Meeting as Session" bug

**One counting function, reused everywhere.** `tallyVisitMetrics()`
(`src/lib/validation/weekly.ts:119`) groups fetched `visits` rows by
`(activity, lifecycle_status)` into the eight Rule-7 metrics. It is called
from exactly two places — `week-summary.ts` (Weekly/Team screens) and
`exports/activity-export.ts` (the Excel export) — and both callers fill in
Meetings themselves from `daily_plans.meetings_actual = 1`, because
`tallyVisitMetrics()` deliberately refuses to count it. That split — Meetings
from the plan, the other seven from the log — **is** the fix for the bug this
task describes. It is not hypothetical: `docs/KUbeats-Test-Results.md` run 2,
scenario 26, specifically constructed "a held `daily_plans` row with no
separate meeting visit row" — exactly the shape that would double- or
mis-count — and both the Weekly and Team screens counted it correctly.
**There is no live Meeting-counted-as-Session bug in this codebase.**

**Is it "one server-side source of truth (a SQL view or function)"?**
Narrowly, no — `tallyVisitMetrics()` is TypeScript operating on rows the
caller already fetched, not a SQL view/function. Practically, yes for the
activity-type axis: every consumer (Weekly, Team, Excel export) calls through
the same function, and `metricsMissingFromExport()`
(`src/lib/exports/activity-grid.ts:72`) is a standing check — asserted by a
test — that every one of the eight metrics maps to exactly one of the six
export columns, so a ninth metric could not go silently uncounted.

For the **status-category axis** (Open/Closed pipeline totals, the feature on
this branch), there genuinely is one source: `pipelineTotals()`
(`src/lib/pipeline-totals.ts`) sums the same `StatusColumns` that
`getInstituteStatusModel()` (`src/lib/institute-status-report.ts`) builds for
the full `/institutes/report` grid — "OPEN AND CLOSED ARE THE COLUMN BANDS,
not a second reading of the catalogue," per that file's own comment. The
Overview card and the full report literally cannot disagree because they call
the same model.

**Gap, real:** there is no automated check that, *per institute*, the sum of
that institute's per-activity-type visit counts equals its total visit count.
`metricsMissingFromExport()` checks the metric vocabulary is complete; nothing
checks arithmetic per institute. This is the one piece of Step 1 not already
covered.

---

## 3. Status model — existing coverage vs. Step 2's asks

| Step 2 ask | Status |
| --- | --- |
| Open\|Closed on every status, built-in and custom | **Done.** `institute_statuses.category`, not nullable, FK-referenced everywhere a status is stored. |
| Admin must choose Open or Closed when creating a custom status | **Done.** `statusSchema` (`src/lib/validation/admin.ts:140`) requires `category: z.enum(STATUS_CATEGORIES)` with no default. |
| No empty/duplicate names | **Done.** Name validated non-empty by the shared `name()` zod helper; duplicate rejected explicitly — `"A status with that name already exists."` (`src/lib/admin-actions.ts:191,301`), backed by the DB `23505` mapping in `errors.ts`. |
| Target statuses kept separate from institute/lead statuses | **Done**, and has been since before this task — `targets` vs. `institute_statuses` are unrelated tables (§1). |
| "Not Interested" is a built-in Closed status | **Not present.** See §5 — this is a genuine gap. |

**The current seed vocabulary** (`SEED_STATUS_CATALOGUE`,
`src/lib/validation/institute.ts:94`) — nine statuses, applied to a fresh
database and the fallback if a read ever fails:

| Status | Category |
| --- | --- |
| First meeting done | open |
| Session scheduled | open |
| Session done | closed |
| Campus visit scheduled | open |
| Campus visit done | closed |
| Pending for management approval | open |
| Invited principal for event | open |
| RSVP received | closed |
| Will not come | closed |

**Distinct statuses actually read from the database** (confirmed live, via a
read-only query against `sdderuaukprwpctmvane.supabase.co` — the project
named in `.env.local`, confirmed as the right one to check):

```
select status, category, tone, sort_order, is_active
from public.institute_statuses order by sort_order;
```

returned **exactly the nine seed rows, nothing custom added** — the table
above, word for word, same categories. No admin has added a tenth status on
this project. `institutes.status` (5 rows, all `null`) and
`visits.status_set_to` (1 row: `"Session done"`) confirm the same — this is a
small dataset, consistent with a dev/test project rather than the client's
live production data (the file `flush-client.sql`, an unrelated housekeeping
script sitting in this repo's working tree, names a *different* Supabase
project — `oboxtnxscvewvdqlqrxd` — as "the client project," with a verified
backup recording 9 institutes / 4 visits / 13 daily plans at the time it was
taken. I have no credentials for that project and have not attempted to
reach it).

**No mapping proposal is needed.** Every status in the live catalogue already
carries a category, matches the seed exactly, and nothing is ambiguous. The
only status this task asks for that is **not** in the catalogue — on this
project or, per the backup manifest, the client's — is "Not Interested"
(§5), which needs a category decision for a *new* status, not a mapping of
existing ambiguous data.

---

## 4. RLS — current state for the tables this task touches

All as RLS policies (not app-level filters), consistent with CLAUDE.md's
"load-bearing rules belong in the database" rule:

- **`institutes`** — `institutes_select`/`institutes_update` are campus-scoped
  via `profiles.campus_id` (0020b), tightened again for rep ownership (0028).
- **`visits`** — `member = auth.uid() or is_admin()` for attribution; campus
  scoping applies through the institute join.
- **`daily_plans`** — `member = auth.uid() or is_admin()`, with
  `guard_checkout_missing()` (FO020) stopping a rep from setting the
  abandoned-checkout flag on their own row.
- **`institute_statuses`** — readable by everyone authenticated; writes
  (add/rename/retire) admin-only, enforced in the RPC layer and by the FK
  `restrict` behaviour, not a CHECK.
- **`follow_up_tasks`** — `enforce_task_institute_owned()` (0038, SECURITY
  DEFINER) refuses a task against an institute outside the assigning admin's
  or rep's reach.
- **`targets`** — rep sees and edits only their own row; a locked week's
  `UPDATE` is refused by `enforce_target_lock`, not by RLS alone; an admin
  reopens via a dedicated RPC, never a raw `UPDATE`.
- **Team-lead scoping** (0041–0043) layers `supervises(member)` on top of the
  above for `alert_events`, `/missed`, and team views — a lead sees exactly
  their reports, an admin sees everyone, a rep sees only themself.

No gap found here against this task's ask — RLS is already the enforcement
layer for every rule in scope, not the UI.

---

## 5. Follow-up lifecycle — where it actually diverges from Step 3

This is the step with the most real gaps.

**The task's three states (Owned / Missed / Closed) don't exist as a named
model.** What exists instead is three separate mechanisms that each cover
part of the same ground:

1. **Pending** (`/pending`) — live, derived from `institutes.status` category.
   This covers "Owned" for the institute-level open loop, but it is a
   *re-derived view*, not a per-follow-up record with its own state.
2. **`/missed`** — a **historical daily log**, not a live state. It records
   "a day that ended (7 PM check) with follow-ups still open," and closing
   them afterwards does not remove the day — "the record is of what happened,
   not of what is outstanding now" (the page's own copy). This answers "was
   anything missed," not "is this follow-up currently missed."
3. **`follow_up_tasks`** (0038) — has the right shape for a real three-state
   model (`due_date`, `done_at` null/set), but:

**Gap — the Daily Plan auto-population from follow-ups is built but
disabled.** `listFollowUpTasks()` (`src/lib/visits.ts`) already selects
`due_date <= today, done_at is null` — today's and every past-due task in one
query, which is most of what Step 3 asks for. But the Dashboard's call to it
is gated behind `PHASE_A_DAILY_PLAN` (`src/lib/features.ts:142`), which is
currently `false`. So **today, in production, a rep's Daily Plan is not
auto-populated from assigned follow-ups at all** — the feature exists in code
and is tested, but reps do not see it. The bell (`notifications.ts`) does
surface *due-today* tasks independent of the flag, but not past-due ones as
a distinct nudge.

**Gap — no dedupe check surfaced for auto-add.** Because the auto-add path is
flagged off, there is no current evidence (test or code) that adding the same
follow-up to the plan twice is prevented at the point of auto-population,
only that `addToDailyPlan` is an `INSERT` (not an upsert) per CLAUDE.md's own
note about migration 0033. This needs verifying once/if the flag is turned on.

**Gap — "Not Interested" does not exist as an institute status, so it cancels
nothing.** The string `"Not interested"` appears in the codebase today only
as a **retired closing-report vocabulary value** (`VISIT_OUTCOMES`,
`MANAGEMENT_RESPONSES` in `src/lib/validation/feedback.ts`) — fields the app
stopped collecting in Phase 2 stage 1 but kept for historical rows. It is
**not** in `SEED_STATUS_CATALOGUE`, so there is no institute status by that
name, and consequently no trigger that cancels or deletes an upcoming
follow-up when an institute is marked that way. This is the cleanest, most
concrete gap in the whole audit: the task's Step 3 assumes "Not Interested"
already exists as a built-in Closed status; it does not.

---

## 6. Migrations & reversibility — house convention vs. this task's ask

The project's own convention (44 migrations, none reverted) is **additive-only
forward migrations** with an explicit header stating safety
("✅ ADDITIVE. SAFE TO APPLY AT ANY TIME BEFORE THE CODE SHIPS.") plus an
assertion block at the foot of the file that fails the migration if an
invariant it depends on isn't actually true. Rollback is handled by
`docs/BACKUP-RESTORE.md` and the `backup`/`restore` npm scripts
(table/row-level logical backup + verification), not by a paired down-SQL
file per migration. That's a different mechanism than "every migration must
have a tested down-migration," not an absence of one — worth a decision from
you on whether to keep the house style (additive + backup/restore) for any
new migration this work produces, or introduce literal down-scripts to match
the letter of the brief.

---

## 7. Summary — what to actually do in Steps 1–4

Given the above, there are exactly **four real gaps**, not a system to build
from scratch:

1. No per-institute reconciliation check (type-counts sum to total) — Step 1.
2. "Not Interested" is missing as a built-in Closed institute status — Step 2/3.
3. Marking an institute "Not Interested" does not cancel its open follow-up —
   depends on #2 — Step 3.
4. The Daily-Plan auto-population from follow-up tasks exists but is dark
   behind `PHASE_A_DAILY_PLAN = false` — Step 3 (a flag/rollout decision, not
   a missing feature).

Everything else this task asked for — six-activity typing, Open/Closed status
classification with admin validation, target/institute status separation,
RLS enforcement, a single counted source feeding every screen — is already
built, live, and covered by the existing test suite.

**Not yet done, needs your decision before I touch anything:** running a
read-only status query against the real client project to get the true
distinct status list (§3), and whether to close gaps 1–4 with new additive
migrations in the house style, and whether turning on `PHASE_A_DAILY_PLAN` is
in scope here or a separate rollout decision.
