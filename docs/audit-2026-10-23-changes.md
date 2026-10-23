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
