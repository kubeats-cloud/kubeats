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
