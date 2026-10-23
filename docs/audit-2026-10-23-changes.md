# Production-baseline audit fixes — 23 October 2026

## Baseline and plan

Branch `fix/audit-2026-10-23-live` starts at `client/main`, `aef8213`.
Original main, reconcile worktree and earlier audit branch are untouched.
`git cherry -v client/main main` reports `- 36e8334`: IQ6 is patch-equivalent
to the deployed implementation and is not ported. No prerequisite files were
taken from reconcile. Highest existing migration is 0054; new migrations start
at 0055. Existing 0047–0054 remain untouched. No push, production access or deploy.

Plan: baseline checks → P0 bounded SQL data paths/prefetch → confirmed A1/R1 gaps
→ follow-up pagination → reassignment history → Targets/validation/minor fixes
→ full checks and an honest acceptance/deployment checklist. Small local commits.

## Rechecked classification before changes

The latest owner instruction makes `docs/client_changes.md` authoritative over
the click-through audit when they disagree about location or report shape.

| Item | Baseline classification | Evidence / action |
| --- | --- | --- |
| P0 list pagination/SQL aggregation | missing | Activity model fetches whole registry/visits/plans/tasks, groups in JS; follow-up cards similarly fetch all tasks. Fix these data paths first. |
| A1 dashboard Activity table/Excel | already implemented (`52b3231`, `acfe05f`, `d531dee`) | Overview renders InstituteActivityTable and matching Excel with per-type Open/Closed, matching Admin 1/2 wording. Do not replace it with the different Rep 7 table. Pagination, total row and filter parity still need checking. |
| Duplicate `/institutes/report` | implemented but in a different place than latest requested | Dashboard is the required home; redirect duplicate inbound links, retain reusable component. |
| R1 consolidated institute table | already implemented (`52b3231`) | RepInstituteSearch/RepInstituteTable on Institutes; preserve details, follow-up and meeting columns. Search is currently client-side and unbounded. |
| R7 presence/activity table | already implemented (`d531dee`) | InstitutePresenceTable in ActivitySummary; retain the existing shared count model. |
| A4 cards | already implemented (`4dde744`, `63e3e6d`) | `/pending/follow-ups` is the Follow-ups Owned page named by Admin 4. Do not move cards to `/pending` merely to match the audit. Counts/list reads need SQL pagination. |
| R6 Owned/Missed | already implemented (`63e3e6d`) | Rep cards on Pending; preserve Owned = all unfinished, Missed = unfinished overdue subset, Closed = completed. |
| I2 Foot Mapping | missing, explicitly blocked by client spec | IQcity 2 says fields/data undefined. No source in code/migrations; do not invent a metric, migration or lock rule. |
| I3 reassignment | already implemented; append-only history missing | Existing reassignment retains visits. Add future change history without backfilling events. |
| A8 target statuses | already implemented (`54b207f`, migration 0047) | Existing Targets panel/action/schema. Empty name rejected; case-insensitive duplicate behavior needs checking. No duplicate prerequisite migration. |
| Admin Targets access | implemented but navigation missing | Admin `/targets` shows actual target statuses; add entry without replacing panel. |
| Status management | already implemented (`dd5d14a`) | Preserve configuration/form/report workflow and migration 0054. |
| Bell | already implemented (`b3ba631`) | Admin deliberately has no bell; inspect for dead links, do not invent notifications route. |
| Total Institutes card | already implemented (`84d2b96`) | Preserve existing rep snapshot count. |
| D9 field-visit exporter | already implemented (`cc3fffd`) | Inspect missing check-out consistency and count labels; do not fabricate timestamps. |
| Board normalization/hygiene scripts | missing | Normalize on read, report IDs/counts only; no production mutation. |
| Log Visit gate | implemented but incomplete | Existing Dashboard link; check whether own planned institutes are listed. |
| Admin-route redirects | already implemented | Review server proxy/guards; session/RSC proof still required. |
| Rep isolation | review required | Existing caller RLS, no auth/RLS changes on existing tables authorized. |
| A6 / IQ2 undefined | out of scope | No cross-campus security or undefined-feature work. |

## Verification

Baseline: lint exit 0; typecheck exit 0; 69 unit files / 1,277 tests passed;
Next webpack build exit 0, static pages 34/34. Build used loopback placeholder
public Supabase settings, not production secrets.
No screenshots or binary artifacts will be added. Authenticated browser, SQL,
DOWN/reapply and RLS checks require an isolated local database; earlier Docker
startup failed and no production credentials will be copied into this checkout.

## Existing artifact privacy

The tracked reconciliation seed script defines synthetic accounts under
`example.test` and synthetic institutions. This alone does not prove every
existing binary artifact contains only synthetic data. No artifact has been
altered or added; any identified potentially personal-data filenames will be
listed without their contents. No real names/phones/emails belong in this report.

## P0 — shared Activity data path

Added 0055 `audit_institute_activity` SECURITY INVOKER RPC and matching DOWN
under `supabase/rollbacks`. Existing RLS and FO033 are untouched. Counts,
per-activity Open/Closed, live tasks, latest plan, search, numeric/text sort,
exact institute count and page clamp execute in SQL before a maximum 50-row
JSON result is returned. Preserves six activity buckets, meeting source,
legacy reconciliation failure handling, and existing planned-record definition
of Total Visits (to be labelled explicitly, not silently redefined).

Existing model/component names remain. `/`, rep `/institutes` and `/report`
receive pages; export uses the same page/model. Rep search now submits to SQL,
not a filter over the current page. Cache decoration reads at most 100 points.
Automatic prefetch disabled on heavy report/Overview/count/bottom-nav links.
No full-table raw visits/plans/tasks are sent to the Worker by this model.

Static query path: up to 7 data reads (registry/owner/catalogue/visits/plans/tasks/
cache) → 1 aggregate RPC + optional 1 cache read. This excludes route auth and
other panels; it is not measured production telemetry. Activity table rows:
all accessible institutes → <=50. Admin registry and Pending optimization are
still separate work, not claimed done by this change.

Checks: lint exit 0; typecheck exit 0; 69 unit files / 1,277 tests pass.
`node scripts/audit/verify-activity-sql.mjs <temporary PGlite prefix>`:
20 checks pass on an ephemeral PostgreSQL fixture, including 120 institutes,
page traversal/unique IDs, numeric 12-vs-5 sort, search beyond page one, empty
range, date scope, source counts, legacy drift, caller-RLS narrowing and
UP/DOWN/UP. The harness takes no URL/env credentials, persists no data and
adds no binary artifacts or package dependencies to the repository.
This does NOT verify full Supabase authentication, actual existing policies,
FO033, team-lead scoping or authenticated RSC/browser behavior.

Local dev server ready at loopback 3104; `/?page=2` returns 307 signed-out.
Authenticated table/count/400px browser checks: **not verified in browser**.
0055 has run only in the ephemeral fixture, never on Supabase/production.

## P0 — admin registry, read-only board normalization

0056 invoker view/facet RPC and matching DOWN; `registry-page.ts` shares one
filter builder for exact HEAD count and max-50 page. Search/location/type/status/
owner/board filtering precedes SQL sort/range. Old registry component remains,
with its contact/stream/Class 12 columns, mobile cards and column preferences;
server mode prevents filtering only the page. Search uses Apply; discrete
filters refetch, reset pagination, and preserve the multi-board OR selection.
Dropdown values come from SQL DISTINCT under caller RLS, never just one page.

NA/N/A/Not applicable variants normalize to Not applicable; trimmed NIOS variants
normalize to NIOS. Storage is not rewritten. Query selects only display fields,
not the old registry's unused phone/address/edit fields. Rep branch no longer
also fetches the entire unused registry before its Activity model.

Data reads: old whole-registry + owner lookup (2) → exact count + facets + page
(3, or 2 if empty). Extra count query bounds rows; no N+1. Rendered institute
rows/cards <=50, not the supplied audit's unbounded 758. Production figures
were not reproduced locally and no latency/Worker CPU improvement is measured.

Lint/typecheck exit 0; institute/activity/table-view tests 3 files / 53 passed;
new pagination tests 1 file / 2 passed. SQL fixture now 26 checks passing,
including normalized boards, owner facets respecting fixture RLS, and 0056
DOWN/UP. Local filtered page returns 307 signed-out; authenticated interactions
and 400px layout remain **not verified in browser**. Nothing applied to Supabase.

## P0 / A4 / R6 — preserve card location and semantics, bound lists

Admin cards remain on `/pending/follow-ups` (Admin 4's required page), rep
Owned/Missed cards remain on Pending (Rep 6 asks for exactly two). No third
rep card invented. Counts are now 3 exact SQL HEAD reads, no task rows for
cards; selected list adds one sorted max-50 query using the same filter builder.
Owned still means all unfinished, Missed the overdue subset, Closed completed.
Every page shows exact matching total and paging controls. No count uses page
length; Missed history's different 30-day unit is labelled.

0057 invoker view performs current-status attribution over saved visit AND
reported call rows before date sort/LIMIT; call reports and recovery behavior
are preserved. `/pending` open-institute list now uses HEAD count + max-50 page
instead of whole institutes/visits/calls/member reads. Dependent institute detail
and rep hub apply institute/owner filters before paging, not afterwards; hub
badge uses exact total and links to further pages. Existing assignment/start,
due-call prompts, automatic follow-up plan and unfinished-report recovery remain.

Lint/typecheck exit 0. First focused run failed one old source-shape assertion
expecting the call query in TypeScript; updated it to assert the actual SQL view
and current-status predicate, retaining the behavioral attribution tests. Rerun:
3 test files / 51 tests pass. SQL fixture: 28 checks pass, including later-call
attribution, IST call day, 0057 DOWN/UP. Signed-out closed-list page returns 307;
authenticated card/list/action and RLS checks **not verified in browser**.
0057 has not run on Supabase or production.

## A1/R1/R7 — correct existing reports, not prerequisite ports

Kept Admin 1/2's existing per-activity Open/Closed grid on Overview (the latest
instruction says follow the client spec, not replace it with Rep 7's different
presence table). Added Rep/Campus/search filters, preserved dates/sort in every
sort/export/page URL, and page Total in table and Excel. Each download is the
displayed max-50 page, explicitly captioned, not an unbounded Worker export.
Existing SQL model/count definitions feed all three export shapes.

Rep Institutes retains its single nine-column consolidated table and date/search/
sort controls. Added matching nine-column Excel/Total and a clear `/report` entry
link. Rep `/report` retains InstitutePresenceTable and gets matching nine-column
Excel; captions distinguish own historical visits, current ownership, saved
plan records, held plan meetings, and logged activities. No missing timestamps
or locations are fabricated. Total sums visible rows, not all matching pages.

The original matrix exporter remains staff-only. New `view=rep|presence` variants
allow a signed-in rep to export only their own member scope; spoofed member IDs
are ignored. Existing auth/RLS are not modified, and no service key is used.
Added route-unit tests for anonymous denial, unchanged staff gate, both own-only
variants, admin filter forwarding, and invalid dates. These test request-handler
logic with mocks; real session/RSC/DB isolation is not certified.

Removed duplicate report button; `/institutes/report` retains its staff guard
and redirects to Overview with URL filters preserved. Old unused pipeline helpers
remain in source, not speculatively deleted; there is no Pipeline by Rep UI on
Overview. Open-loops tile's all-time unclosed-Set unit is distinguished from
date-filtered status-event counts.

Lint/typecheck exit 0. Focused exports/activity/role suite: 4 files / 65 tests
passed. Pure sheet tests verify exact headers, model row order/count, every
numeric Total, missing values and filter URLs; they do not assert live browser
Excel parity. Authenticated reporting/400px UI **not verified in browser**.

## I3 — append-only future reassignment history

0058 UP/DOWN adds new table and admin-only SELECT policy. Ownership changes
record from/to/actor/time atomically through an AFTER trigger; same-owner saves
produce no event. No existing assignment, visit credit, RLS or FO033 logic is
changed. Direct authenticated INSERT is denied; UPDATE/DELETE/TRUNCATE are also
rejected by an immutable trigger even for the fixture database owner.
No cascading FK can delete audit evidence. Admin institute page shows history
in pages of 50 with one bounded profile-name lookup, never per-row queries.

DOWN removes the recording hook and archives the table with its RLS/immutability;
it does not destroy evidence or restore an identical empty schema. UP restores
the archive. This preservation cycle passed on the ephemeral fixture.

Lint/typecheck exit 0; institute/scope/pagination tests 3 files / 13 passed.
SQL harness now 38 checks pass: two actual changes versus same-owner save,
actor preservation, blocked mutation, rep read/insert denial, admin reads and
DOWN/UP evidence preservation. These use fixture auth/RLS helpers, not the full
Supabase auth/FO033 stack. Authenticated history UI **not verified in browser**.
No backfill, production access or Supabase migration was performed.

## D4/R2 / A8 — Targets reachable, existing catalogue retained

Admin nav now includes Targets without removing existing routes. Existing
TargetStatusesPanel remains in place; added paginated per-rep weekly values,
real Draft/Locked/Not set state and links to the existing per-rep target/reopen
screen. Reads are exact rep count + 50 reps + target rows for those IDs (3),
not raw visit aggregation or one query per rep. Eight metrics and lock rules
are unchanged; no Foot Mapping field invented. Seven admin tabs need 400px QA.

Empty-name validation and friendly duplicate errors already existed. Confirmed
0047's text PK was case-sensitive; added 0059 unique expression index on
lower(trim(name)), with DOWN. If legacy case-only duplicates exist, UP fails
atomically for owner review without rewriting/deleting any name. Existing 0047
and its RLS policies remain untouched.

Lint/typecheck exit 0; nav/status schema/action tests: 3 files / 38 passed.
SQL fixture now 43 checks pass, including case/whitespace duplicate rejection,
blank rejection, index DOWN/UP and preserved existing rows. These are not
full Supabase integration tests. Authenticated add-status, lock/reopen and
roster interactions **not verified in browser**. No migration applied to production.

## Hygiene scripts — no cleanup performed

Added owner-run `scripts/prod_data_hygiene_report.sql`, explicit read-only
transaction/ROLLBACK, outputting counts and IDs only for active same-campus
case-insensitive duplicates and test-looking institute/profile candidates.
The separate `prod_data_hygiene_proposal_DO_NOT_RUN.sql` is comments only,
references the existing reviewed soft-delete RPC and records merge safeguards.
Its proposed per-campus name index is a comment, never an applied migration.
No rows, profiles, auth users or artifacts were deleted or changed.

SQL script execution and comments-only proposal check passed against the
ephemeral fixture (45 harness checks total). Not run against production.

## Log Visit gate

Existing Dashboard link/check-in rule retained. Added up to 50 own planned,
not-yet-checked-in entries below the gate, using the already-loaded own plan;
no extra query and no bypass. Lint/typecheck exit 0. Local `/log` redirects
signed-out users to login. Authenticated gate/actions **not verified in browser**.

## D9 — existing field-visit export integrity

`cc3fffd` already exports missing checkout as blank consistently, with exactly
the five specified columns. Kept that behavior, rather than invent a time or
add an unrequested column. Added copy distinguishing check-in record exports
from status-event counts, and blank checkout from a fabricated completion.
The audit's 583/592/9 counts were not re-read from production.

Lint/typecheck exit 0; field-checkout/notification tests 2 files / 40 passed,
including new missing-checkout/failure tests. Authenticated export UI and actual
download **not verified in browser**. No new spreadsheet artifacts were written.

## D2/D3 — confirmed visit-count regression in the deployed model

Source comparison found a real cause of conflicting visit totals: the Activity
model counted every saved daily_plan row (including future/unstarted plans),
whereas the report summary and institute history count saved visits. Corrected
the shared model's Total Visits to logged visit rows, with the same scope/date
filters. Held Meetings still comes from meetings_actual=1; it is not redefined.
Latest check-in/out now ignores unstarted plans, so a future plan cannot erase
the latest actual arrival's presence. No date/time is invented.

The pure count helper and SQL agree on the new visit definition, with regression
fixtures containing more plans than visits and a future unstarted plan. Earlier
sections describe the initial preservation of the old definition; this correction
supersedes it. Updated 0055 in place, since it has never been applied on Supabase.
Summary versus current-owned table coverage remains explicitly labelled.
Committed as `794865c`.

## Rep data-leak review (route → scoping method)

Static review of every server component, route handler and RPC a rep can reach.
The shared server client uses the anon key plus the caller's session cookies, so
RLS applies on every query (`src/lib/supabase/server.ts:12-20`). The session
predicate is `supervises(member)` = own row, an admin's all rows, or a team
lead's own reps (`supabase/migrations/0041_team_leads.sql:519-527`).

| Route / entry | Data path | Scoping method | Columns / result |
| --- | --- | --- | --- |
| `/` (rep) | `src/app/(app)/page.tsx:117,124,171` | Explicit own id for plan, week, alerts; admin-only Overview is skipped at line 126 | Plan, target summary, alert banner only |
| `/institutes` (rep) | `src/app/(app)/institutes/page.tsx:57,109` | Admin registry skipped; Activity RPC 0055 is SECURITY INVOKER over RLS-scoped registry/visits/plans/tasks | Nine report columns only |
| `/pending` (rep) | `src/app/(app)/pending/page.tsx:87,104` | Viewer id passed for `mine`; open list uses view 0057 `security_invoker`; cards rely on `follow_up_tasks_select` (0042:379) | Displayed institute/follow-up fields |
| `/targets` (rep) | `src/app/(app)/targets/page.tsx:53-54` | `memberId` forced to `user.id` unless the caller is an admin; `targets_select` (0042:244) | Own weekly targets |
| `/report` (rep) | `src/app/(app)/report/page.tsx:107`; `src/lib/activity-report.ts:227-255` | RPC 0055 invoker plus explicit `.eq("member", memberId)` on every summary query | Presence/report columns only |
| `/missed` (rep) | `src/app/(app)/missed/page.tsx:118,127` | `alert_events_select` (0042:272) narrows to own member; days call uses own id | Aggregated missed-days record |
| `/slabs` | `src/lib/slabs.ts:82,156`; `supabase/migrations/0044_institute_slabs.sql:209` | `institute_slabs_select` = `supervises(i.registered_by)` | Slab fields for readable institutes |
| `/log` | `src/app/(app)/log/page.tsx:57` | Explicit own id on the plan loader; remaining reads use caller RLS | Today's own plan and status catalogue |
| RSC payloads | `src/lib/supabase/server.ts:12-20` | Caller session + RLS; only rendered props are serialised | Same columns as the screen |
| `/api/export/activity` | `src/app/api/export/activity/route.ts:32` | `requireAdmin()`; RLS underneath; no service key | Admin export only |
| `/api/export/institute-activity` | `src/app/api/export/institute-activity/route.ts:30-64` | Staff gate for the admin view; rep role only for `view=rep|presence`. The rep RPC takes no member parameter and derives `auth.uid()`; the admin RPC checks the role in SQL | Visit-level admin export or the rep's own institute rows |
| `/api/health` | `src/app/api/health/route.ts:70,144` | Public by design; purposes count and cron metadata only | No personal rows |
| `/api/pincode`, `/api/place` | `[code]/route.ts:123`; `place/route.ts:175` | Public cache lookups | Postal/place labels only |

No route returning another rep's rows or an admin's rows was found. No
`security:` commit was needed for a new finding. Existing RLS policies and auth
were not changed.

## Client-change round — 24 October 2026

This round implements the client's later clarifications on top of the audit
branch. It changes the answer to checklist items 1 and 6 below; those two items
are superseded by the checklist in this section.

### Overview, redirect and the Institute Activity entry (A)

At `aef8213` the admin Overview contained: **Today and this week**, **Latest
from the team**, **Out today**, **Still checked in**, **Open loops**, **Go to**
and an institute-wise **Activity report** table. The rep Overview contained
**Today** and **This week**. There was no rep-wise report section on Overview at
`aef8213`, so none was invented.

The institute-wise report was removed from Overview. Everything else at
`aef8213` remains, including the whole **Go to** block. It now lives behind an
**Institute Activity** button on the Institutes tab (`/institutes?view=activity`)
for admins and team leads; a rep never sees that branch. The old
`/institutes/report` route now redirects to `/institutes?view=activity` and
keeps every query parameter (`from`, `to`, sort, filters, page).

### Rep Institutes tab restored (B)

The rep UI was restored to `aef8213` byte-for-byte in these files:

- `src/components/report/rep-institute-search.tsx`
- `src/components/report/rep-institute-table.tsx`

`git diff aef8213 --` on both is empty. The rep branch of
`src/app/(app)/institutes/page.tsx` was restored to the same view: its own
report model, optional range, `RepInstituteSearch` and the institute table, with
no export, no paging and no `q` parameter. Shared, non-UI fixes were kept: the
Total Visits definition counts logged visit rows, and the SQL functions from
0055 onwards (including 0060) remain. The admin/team-lead activity branch,
filters, export and redirect are additive and do not touch the rep branch.

### Institute Activity table and Excel (C)

On screen: one row per institute with Total visits, one column per **active
status** from `public.institute_statuses` (`sort_order, status`), Follow-ups
owned, Follow-ups pending and Meetings completed. The footer is computed by SQL
over every matching institute, not only the visible page. A status with no
visits still gets a column and a zero.

Excel: built server-side by `src/lib/xlsx.ts` (the repo's store-only writer), one
row per **visit** in the chosen range, with the section-C columns and one 1/0
column per status, then a final **Total** row that sums the per-status columns
and the Follow-up Created column. It covers every matching row, never a page.
From/To are mandatory for an export and the inclusive maximum is **31 days**;
the route refuses longer ranges with 400 and the screens replace the link with
"Choose a date range of 31 days or fewer…". The limit is enforced in the route
and again inside the SQL RPC for `p_page = 0`.

Column sources:

| Column / figure | Source |
| --- | --- |
| Visit date, Activity, recorded Status | `visits.date`, `visits.activity`, `visits.status_set_to` |
| Check-in/out date and time (IST) | `daily_plans.checkin_at` / `checkout_at`, rendered in Asia/Kolkata; blank when never recorded |
| Location | latest check-in/out coordinates resolved to an area |
| Total visits | count of logged `visits` rows in range |
| Each status column | count of `visits.status_set_to` for that status |
| Follow-ups owned | `follow_up_tasks` rows with `done_at is null` |
| Follow-ups pending | `follow_up_tasks` rows with `done_at is null` and `due_date <= app_today()` |
| Meetings completed | `daily_plans.meetings_actual = 1` |
| Follow-up Date / Time (Excel) | `visits.follow_up_date` / `visits.follow_up_time` (IST time, blank when absent) |
| Follow-up Created (Excel) | whether a `follow_up_tasks` row names the visit in `from_visit_id` |

### Security behaviour and evidence

- `public.audit_institute_activity(...)` checks `is_admin()` or `is_team_lead()`
  inside SQL and raises SQLSTATE `42501` otherwise.
- `public.audit_rep_institute_activity(...)` has **no rep-id parameter**. It
  derives the caller from `auth.uid()`, refuses a non-rep with `42501`, and
  returns only that rep's rows.
- The export route requires staff for the admin view and rep role for
  `view=rep|presence`; it never forwards a browser-supplied member id to the rep
  RPC.

Rehearsal (`kubeats_rehearsal`, 0060 applied) evidence, counts only:

- Admin status RPC, October 2026, export mode `p_page=0`: 717 institutes, 534
  visits, 18 statuses, status-column sum 534, 357 meetings, payload 646,052
  bytes. Runtimes observed: 2,626.9 ms cold (first call after restore) and
  808.5 ms warm. Page mode `p_page=1`: 50 rows, 0 visit payload, 32,796 bytes,
  425.2 ms.
- Parity: 0 mismatched status columns out of 18; Follow-up Created 84.
- Rep RPC, same range: 82 institutes (the rep's own), 44 visits, 51.997 ms,
  84,516 bytes.
- Rep calling the admin RPC: denied, SQLSTATE 42501. Admin calling the rep RPC:
  denied, SQLSTATE 42501. Rep export through the route: 403. Rep's own export:
  200, 82 institute rows (SQL count 82), never 717.
- Excel downloaded through the real route for the same filter: 534 data rows
  plus the Total row; every one of the 18 status totals equals the on-screen
  footer (e.g. 199, 37, 88 … 22, summing to 534); Follow-up Created 84.
- 0060 DOWN → UP round-trip applied; the DOWN restores the 0055-era function and
  removes the rep RPC.

The app's own follow-up automation inserted 45 tasks during the live UI pass, so
the owned/pending figures moved from 83/40 to 128/85. Status-column parity is
unaffected: it is visit-based, and the two figures matched the table at each
measurement.

### Section E assessment — target statuses

No code change was needed; no separate E commit exists.

- The Add form is visible to admins only. `/targets` renders it only on the
  admin's own view (`isAdmin(user) && !viewingOther`); reps and team leads get
  the list with `canAdd={false}`. The server action calls `requireAdmin()` and
  the RLS insert policy is `public.is_admin()`, so hiding the form is not the
  boundary.
- The placement matches the client spec: `docs/client_changes.md` Admin §8 puts
  it "in the Target section", and Rep-side §2 says "Admin should have access to
  the complete Target tab". The admin nav already contains Targets.
- Rehearsal previously confirmed an added status persists and empty/case-
  variant duplicates are rejected. Live check: an admin sees the Add form and
  status-name input; a rep sees the status list with no Add button.

### Verification of this round

- Lint, typecheck, build and unit/integration tests as recorded at the end of
  this branch.
- Authenticated browser pass against the local dev server: admin Overview
  sections; Institutes → Institute Activity; 50-row table with 18 status
  columns; export message at 32+ days; real `.xlsx` parity; `/institutes/report`
  redirect; rep Institutes restore; rep yearly report cap message; admin and rep
  Targets views.
- No production access, no production database, no Cloudflare change and no
  push. The 31-day limit is a product limit for exports, not a worker setting.

## Manual test checklist (owner, staging then production)

1. ~~Admin Overview activity table~~ — superseded: Overview no longer carries
   the institute-wise table. Use the Institutes → Institute Activity checklist
   in the client-change round above.
2. `/institutes` and `/pending` as admin: each renders at most 50 rows/cards,
   the stated total matches SQL `count`, and paging preserves filters.
3. `/pending/follow-ups`: Owned/Missed/Closed card counts equal the total shown
   after opening each list; every list pages; a rep still sees exactly the two
   cards the client asked for (Owned, Missed).
4. Reassign an institute: a history row records institute, from, to, actor and
   time; saving without changing the owner adds no row; a rep cannot read
   another institute's history.
5. Targets: Targets appears in the admin nav; adding an empty or case/whitespace
   duplicate status is rejected; a new status appears in the rep target flow.
6. ~~Rep Institutes: "My Activity Report", matching Excel and Total row~~ —
   superseded: the rep tab is restored to `aef8213` and has no export or
   "My Activity Report". Check the restored search and date filter instead.
7. Admin header has no bell and no link to `/notifications`; opening
   `/notifications` is not advertised anywhere.
8. Board filter: NA / na / Not applicable collapse to one value; NIOS / Nios /
   nios collapse to one value; stored values are unchanged.
9. Field-visit Excel: rows with no check-out stay blank (no invented time); the
   page clearly labels check-in-record counts versus status-event counts.
10. `/log` before check-in: the gate explains the rule, links to the Dashboard,
    lists planned institutes, and still refuses logging.
11. A rep opening an admin URL gets a server redirect to `/` before any admin
    content or RSC payload is served.
12. Apply migrations 0055-0059 in order on staging; on a copy, apply the DOWN
    files in reverse order and confirm the prior schema returns. Nothing is
    applied to production by this branch.
13. Measure Worker CPU and SQL query counts on Overview, `/institutes` and
    `/pending` before/after deploy and record the numbers.

## New migrations to apply (in order)

1. `supabase/migrations/0055_audit_institute_activity.sql` — DOWN:
   `supabase/rollbacks/0055_audit_institute_activity_down.sql`
2. `supabase/migrations/0056_audit_registry.sql` — DOWN:
   `supabase/rollbacks/0056_audit_registry_down.sql`
3. `supabase/migrations/0057_audit_open_follow_ups.sql` — DOWN:
   `supabase/rollbacks/0057_audit_open_follow_ups_down.sql`
4. `supabase/migrations/0058_audit_reassignment_history.sql` — DOWN:
   `supabase/rollbacks/0058_audit_reassignment_history_down.sql`
5. `supabase/migrations/0059_target_status_case_unique.sql` — DOWN:
   `supabase/rollbacks/0059_target_status_case_unique_down.sql`
6. `supabase/migrations/0060_audit_status_activity.sql` — DOWN:
   `supabase/rollbacks/0060_audit_status_activity_down.sql`

Nothing has been applied to production. 0047-0054 are untouched.

## Deploy order and rollback

Order: backup → apply 0055-0060 in order → push `client/main` → run the manual
checklist. Rollback: apply the DOWN files in reverse order, then redeploy the
previous commit.

## Remaining / not verified

- **I2 Foot Mapping**: not implemented. `docs/client_changes.md:167` says the
  client has not defined the fields/data and instructs not to design or
  implement it. This overrides the audit prompt's request; no metric, migration
  or lock rule was invented.
- Authenticated browser checks, live Excel parity and the 0060 DOWN/reapply were
  verified on the local Supabase stack and `kubeats_rehearsal` in the
  client-change round above. A 400 px layout pass was **not** run this round.
  RLS/RSC isolation was verified with role-scoped SQL calls, not by capturing
  another user's response body.
- Production before/after latency and CPU were **not measured**. The rehearsal
  timings are a local Postgres measurement, not production telemetry.
- The 583/592/9 counts in the audit were not re-read from production.
