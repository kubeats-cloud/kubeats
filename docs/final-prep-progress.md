# Final prep progress

Phase 1 only. Date: 2026-10-25.
Worktree: `D:\free lance-verification-gaps`. Branch: `codex/reconcile-verification-gaps`.
Phase start HEAD: `5ecef05`. Delta commit: `4275269`.
No production Supabase or Cloudflare connection was made. No `git push`. Local PostgreSQL 17.11 on `127.0.0.1:55432` only.

## 1.1 Local production-shape database

- Created `kubeats_prodshape` from `D:\kubeats_backups\kubeats_prod_backup_2026-10-23.dump`.
- Restore finished with **30 errors**, not the expected 159. All 30 are unavailable local extensions and their dependants: `pg_cron`, `pg_net`, `supabase_vault`; schemas `cron`/`net`; `vault.secrets` and the crypto helpers. The public schema restored: 23 base tables and 54 public functions at restore time (26 and 71 after the local migrations below). This is a local-environment discrepancy, not a production statement.
- Applied `0047`, `0048`, `0049`, `0050`, `0051`, `0053`, `0054`: every log has 0 `ERROR`.
- Skipped `0052` and `0046`: they must never be rerun.
  - The dump already contains the 9 column names checked by 0052. Local `log_call` remains at md5 `e50f23a5dae57de3c272f42d357c6672`; production is `975df4ea6f8ca60dcf0a2c55fa826a9b`. 0052 was not run locally, so local `log_call` is not the production body.
- Applied `0055`–`0059` and `0060` **as at `1bcade4`** (files extracted to `output/evidence/phase1-1bcade4/`). Every log has 0 `ERROR`.
- Local row counts after the cycle (no row data printed): profiles 57, institutes 717, visits 798, daily_plans 844, follow_up_tasks 87, institute_status_history 757, institute_statuses 20, target_statuses 0, institute_reassignment_history 0.
- `institute_reassignment_history` is created locally by 0058, so the local count is 0. The owner reports **5 rows in production**; the delta contains no DML (see 1.5).

## 1.2 Function fingerprints

`md5` is over `pg_get_functiondef(oid)`.

| function | production md5 (owner-supplied) | local @ `1bcade4` | local @ HEAD (`0061` applied) | prod = `1bcade4`? | prod = HEAD? |
|---|---|---|---|---|---|
| `audit_institute_activity` | `0026be7e3cc1e5a53c5babed51b46180` | `27f560d048b95ddc96a2ffaa1e07629e` | `18da8dbcc8613a1a0a9e967e8cb19bb4` | NO | NO |
| `audit_registry_facets` | `f24f7eaf361f7fdf9016bc12928e6891` | `e024d8bf129f22b1b1dd99ea430e4a88` | `e024d8bf129f22b1b1dd99ea430e4a88` | NO | NO |
| `audit_rep_institute_activity` | `adba1660a30e22805be14eb57b2efe44` | `b6ab0ded68e9b8325a048e031a15fb42` | `55ee525455762fb1308b0e211be15aa8` | NO | NO |
| `record_institute_reassignment` | `ce22cdf855989397c85a63a942400594` | `a80c43fac2b0f96e450e29e94b4e6600` | `a80c43fac2b0f96e450e29e94b4e6600` | NO | NO |
| `record_institute_status_change` | `e8fa561083e48fd2c7bd607e41a4059a` | `e8fa561083e48fd2c7bd607e41a4059a` | `e8fa561083e48fd2c7bd607e41a4059a` | YES | YES |
| `reject_reassignment_history_mutation` | `5307c17a08ec244d530b1e37630e6657` | `1f3135e6c4bc23c1f5e799655437f2b4` | `1f3135e6c4bc23c1f5e799655437f2b4` | NO | NO |
| `log_call` (0052 side note) | `975df4ea6f8ca60dcf0a2c55fa826a9b` | `e50f23a5dae57de3c272f42d357c6672` (dump; 0052 skipped) | `e50f23a5dae57de3c272f42d357c6672` | NO | NO |

**Blocked:** the owner said the production definitions were saved under `D:\kubeats_backups\prod_fingerprints\` as query 10..15 CSVs. That directory does not exist on this machine; only the dump does. The transcript contains the md5 values but not the definitions. Therefore the whitespace-normalised diff and the first differing statement are **NOT RUN**. The production values above are owner-supplied, not measured in this phase.

Local file-side change `1bcade4` → HEAD is only `0060`: +51 lines, 0 deletions. The admin body adds `visit_followups`, `nextActionDate`, `totalFollowUps`, `openFollowUps`, `visitCount` and visit rows; the rep body adds its own follow-up fields, `visitCount` and visit rows. This is not a production diff; it is the expected delta.

## 1.3 Object comparison at `1bcade4` and HEAD

`git diff 1bcade4..HEAD` over 0055–0059 is empty. Only 0060 changed. Production descriptions below are owner-supplied; no production DDL was captured.

| object | production (owner) | file @ `1bcade4` | file @ HEAD | same? |
|---|---|---|---|---|
| view `audit_registry` | present; `security_invoker=true` | 0056: view with `security_invoker=true`, `SELECT` to authenticated | identical file (0055–0059 unchanged) | presence and invoker flag match; exact DDL **CANNOT TELL** |
| view `audit_open_follow_ups` | present; `security_invoker=true` | 0057: view with `security_invoker=true`, `SELECT` to authenticated | identical | presence and invoker flag match; exact DDL **CANNOT TELL** |
| table `institute_reassignment_history` | present; 5 rows; RLS on; policy `reassignment_admin_read = is_admin()`; only authenticated SELECT | 0058: 6 columns (`id`, `institute_id`, `from_rep`, `to_rep`, `changed_by`, `changed_at`), check constraint, RLS, policy, revoke all / grant select, lookup index | identical | described facts match; columns/index exact DDL **CANNOT TELL** |
| policy `reassignment_admin_read` | SELECT to authenticated using `is_admin()` | 0058: same described policy | identical | described match; exact SQL **CANNOT TELL** |
| index `institute_reassignment_history_lookup` | not reported by owner | 0058: `(institute_id, changed_at desc, id)` | identical | production **CANNOT TELL** |
| trigger `institutes_record_reassignment` | present | 0058: AFTER UPDATE OF `registered_by`, FOR EACH ROW, WHEN old/new differ, calls `record_institute_reassignment()` | identical | name matches; exact definition **CANNOT TELL** |
| trigger `reassignment_history_immutable` | present | 0058: BEFORE UPDATE OR DELETE OR TRUNCATE, FOR EACH STATEMENT, calls `reject_reassignment_history_mutation()` | identical | name matches; exact definition **CANNOT TELL** |
| unique index `target_statuses_name_normalized_unique` | present; duplicate groups 0; null names 0 | 0059: UNIQUE on `lower(trim(name))` | identical | presence/data match; exact definition **CANNOT TELL** |
| function `record_institute_status_change` | md5 `e8fa561083e48fd2c7bd607e41a4059a` | same md5 | same md5 | **YES** (fingerprint) |
| function `record_institute_reassignment` | md5 `ce22cdf855989397c85a63a942400594` | `a80c43fac2b0f96e450e29e94b4e6600` | same | **NO** (fingerprint) |
| function `reject_reassignment_history_mutation` | md5 `5307c17a08ec244d530b1e37630e6657` | `1f3135e6c4bc23c1f5e799655437f2b4` | same | **NO** (fingerprint) |
| function `audit_registry_facets` | md5 `f24f7eaf361f7fdf9016bc12928e6891` | `e024d8bf129f22b1b1dd99ea430e4a88` | same | **NO** (fingerprint) |

The three function mismatches above are not resolved by 0061 (it touches only the two audit RPCs) and cannot be text-diffed without the missing production definitions.

## 1.4 HEAD 0060 parameter identity

| function | HEAD parameter names and defaults | HEAD return | HEAD security |
|---|---|---|---|
| `audit_institute_activity` | `p_from date default null, p_to date default null, p_search text default '', p_member uuid default null, p_campus uuid default null, p_sort text default 'institute', p_desc boolean default false, p_page integer default 1` | `jsonb` | `STABLE SECURITY INVOKER SET search_path = public` |
| `audit_rep_institute_activity` | `p_from date default null, p_to date default null, p_sort text default 'institute', p_desc boolean default false, p_page integer default 1` | `jsonb` | `STABLE SECURITY INVOKER SET search_path = public` |

Production owner-supplied identity arguments are `(date,date,text,uuid,uuid,text,boolean,integer)` and `(date,date,text,boolean,integer)`, both returning `jsonb` and `SECURITY INVOKER`. **Parameter names and defaults were not supplied, so "identical names/defaults" is NOT VERIFIED.** This is the 42P13 hazard.

How 0061 handles it:

- It begins with `drop function if exists public.audit_institute_activity(date,date,text,uuid,uuid,text,boolean,integer);` before `create or replace`. Function identity is the input type list, not the parameter names, so a name or return-type difference cannot raise 42P13: the old function is removed first. The rep function already has the same drop guard in HEAD 0060.
- The remaining condition is that production's input type list matches the owner-supplied list. If it does not, the drop removes nothing and an additional overload is created. That must be checked by the owner with a read-only signature query before running 0061.
- The drop requires the running role to own the functions; run it as the same role that applied 0055/0060.
- The drop/recreate resets ACLs. Locally the new functions end with owner `postgres`, `authenticated` and `service_role` execute, and no `anon` execute. Production default ACLs should be checked if `service_role` execute is required.

Everything HEAD 0060 does (and therefore 0061, plus the admin drop guard):

- No table, view, column, index, trigger or data change.
- Admin: `create or replace function`, `revoke all ... from public, anon`, `grant execute ... to authenticated`.
- Rep: `drop function if exists ...(date,date,text,boolean,integer)`, `create function`, `revoke all ... from public, anon`, `grant execute ... to authenticated`.
- Bodies add follow-up fields and visit rows as described in 1.2.

## 1.5 Delta rehearsal

Files: `supabase/deltas/0061_delta_to_head.sql` and `supabase/deltas/0061_delta_to_head_down.sql` (commit `4275269`). The up file is HEAD 0060 text plus its header and the admin drop guard; diff against `git show HEAD:...0060` shows only those. The down file is `1bcade4` 0060 text plus the same guard; diff against `git show 1bcade4:...0060` shows only those.

| stage | `audit_institute_activity` | `audit_rep_institute_activity` | history rows |
|---|---|---|---|
| before delta (`1bcade4` state) | `27f560d048b95ddc96a2ffaa1e07629e` | `b6ab0ded68e9b8325a048e031a15fb42` | 0 |
| apply 0061 | `18da8dbcc8613a1a0a9e967e8cb19bb4` | `55ee525455762fb1308b0e211be15aa8` | 0 |
| apply 0061 DOWN | `27f560d048b95ddc96a2ffaa1e07629e` | `b6ab0ded68e9b8325a048e031a15fb42` | 0 |
| re-apply 0061 | `18da8dbcc8613a1a0a9e967e8cb19bb4` | `55ee525455762fb1308b0e211be15aa8` | 0 |

The other four functions stayed at `e024d8bf...`, `a80c43fa...`, `e8fa5610...`, `1f3135e6...` through every stage. The applied HEAD fingerprints equal the local rehearsal database's HEAD fingerprints.

Parity on `kubeats_prodshape` for range `2026-10-01`..`2026-10-22`, export mode (`p_page = 0`):

- Admin call: `visitCount` 534, visit rows 534, institute total 717, active statuses 18, status column sum 534, Other 0, `totals.totalVisits` 534. Identity 534 + 0 = 534. Ground-truth visit rows in range: 534.
- Rep call: `visitCount` 60, visit rows 60, institute total 77, active-status visits 60, Other 0. Ground-truth visit rows for that rep in range: 60. Rep UUID withheld.
- Re-apply smoke test: admin 534/534, Other 0; rep 60/60, Other 0.
- Excel headers: `npx vitest run tests/unit/institute-export-parity.test.ts tests/unit/rep-institute-export.test.ts tests/unit/institute-activity.test.ts` → 3 files, 54 tests passed. These assert the exact admin and rep header arrays, the status columns, and Other = total visits. This is a HEAD-code test, not a live workbook generated from `kubeats_prodshape`.
- RLS/authorization:
  - admin calls `audit_institute_activity`: succeeds.
  - one rep calls `audit_institute_activity`: SQLSTATE `42501`, "Only an admin or a team lead...".
  - admin calls `audit_rep_institute_activity`: SQLSTATE `42501`, "Only a rep...".
  - `anon` calls either RPC: SQLSTATE `42501`, permission denied for function.
  - team lead calls the admin RPC: allowed; that TL's team-scoped range returned 0 visits.
- History: local count 0 before the delta, 0 after apply, 0 after DOWN, 0 after re-apply. Production is 5 rows per the owner. `grep` over both delta files finds no `insert`/`update`/`delete`/`truncate` or table DDL, so the files cannot change that count.

## 1.6 Audit view reads and write grants

On `kubeats_prodshape`, with `security_invoker=true` views:

| role | `audit_registry` | `audit_open_follow_ups` |
|---|---|---|
| `anon` | 0 rows | 0 rows |
| rep (`authenticated` + JWT sub) | 77 rows | 77 rows |
| admin | 717 rows | 717 rows |

The anon zeros are RLS-filtered rows, not a permission error; admin and rep counts prove the views have data.

The view ACLs include Supabase default table grants: both `anon` and `authenticated` hold `SELECT`, `INSERT`, `UPDATE`, `DELETE` and `TRUNCATE` on both views. `has_table_privilege` returned true for all four write privileges for both roles. Neither view is auto-updatable (`pg_relation_is_updatable = 0`), and neither has a non-internal trigger or a rule, so those write grants cannot currently succeed. Removing them is least-privilege hygiene.

`supabase/deltas/0062_optional_revoke_view_writes.sql` (commit `4275269`) is a proposal only: it revokes `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` on both views from `anon` and `authenticated`, keeps `SELECT`, and was **not applied**. Production's actual view ACLs were not measured.

## 1.7 Per-file plan

| file | plan | reason |
|---|---|---|
| `0052_saved_call_reports.sql` | **SKIP** | Production already has its effects; must never be rerun. Local `log_call` is the dump body, not production's. |
| `0053_automatic_follow_up_plan.sql` | **SKIP** | Applied in production; local apply clean. |
| `0054_status_management_dynamic_fields.sql` | **SKIP** | Applied in production; local apply clean. |
| `0055_audit_institute_activity.sql` | **SKIP** | Applied; its admin function is superseded by 0061. |
| `0056_audit_registry.sql` | **NEEDS OWNER CHECK** | View and facets exist, but `audit_registry_facets` md5 differs from both local versions and production DDL is missing. |
| `0057_audit_open_follow_ups.sql` | **SKIP** | View exists in production; no function fingerprint. |
| `0058_audit_reassignment_history.sql` | **NEEDS OWNER CHECK** | Table, policy and triggers exist, but the two trigger functions' md5s differ from both local versions; production has 5 history rows to preserve. |
| `0059_target_status_case_unique.sql` | **SKIP** | Unique index exists; owner reports 0 duplicate groups and 0 null names. |
| `0060_audit_status_activity.sql` | **APPLY DELTA** | Run `supabase/deltas/0061_delta_to_head.sql`; DOWN is `supabase/deltas/0061_delta_to_head_down.sql`. Owner runs it explicitly. Check production signatures and function ownership first. |

## Blockers and owner checks

1. `D:\kubeats_backups\prod_fingerprints\` is missing, so exact production-definition diffs and the 1.4 parameter-name/default comparison are not run.
2. `0056` and `0058` function fingerprints differ from production and are not explained by the repo history available locally; owner check required.
3. 0061's admin drop guard needs production's input type list to match the owner-supplied identity; check function ownership and `service_role` execute before running.
4. 0062 is conditional on production actually holding the write grants; verify in production before applying.
5. `0052`/`log_call` and the `institute_reassignment_history` count (local 0, production 5) are known environment differences; neither file is rerun or changed.
6. Restore produced 30 extension-related errors locally, not 159; the local database is production-shaped for the public schema objects tested here, not a bit-for-bit production clone.
7. Excel header parity is unit-tested at HEAD, not generated end-to-end from `kubeats_prodshape`.
8. No claim of deploy safety is made. The owner decides.

## Phase 1 status

| item | result | evidence | commit |
|---|---|---|---|
| 1.1 prod-shape DB created from dump | PASS (30 extension errors, not 159) | restore log; public schema restored | — |
| 1.1 0047–0054 applied, 0052/0046 skipped | PASS | 7 migration logs, 0 `ERROR` each | — |
| 1.1 0055–0060 @ `1bcade4` applied | PASS | 6 migration logs, 0 `ERROR` each | — |
| 1.2 six-function fingerprints measured | PASS | table in 1.2; local DB queries | 4275269 |
| 1.2 production fingerprint parity | FAIL (5 of 6 differ; only `record_institute_status_change` matches) | table in 1.2 | 4275269 |
| 1.2 exact definition diff / first differing statement | NOT RUN | `prod_fingerprints` directory missing | — |
| 1.3 object comparison table | PASS (table produced; exact DDL rows are CANNOT TELL) | table in 1.3; `git diff 1bcade4..HEAD` empty for 0055–0059 | — |
| 1.4 parameter names/defaults vs production | NOT RUN | owner did not supply names/defaults; no production DDL | — |
| 1.4 replace-safe apply | PASS locally | 0061 applied with drop guard; 0 errors | 4275269 |
| 1.5 apply / DOWN / re-apply | PASS | md5 table in 1.5; history 0 throughout | 4275269 |
| 1.5 RPC counts and status+Other identity | PASS | admin 534/534/717, statusSum 534, Other 0; rep 60/60/77, Other 0 | 4275269 |
| 1.5 Excel header parity | PASS (unit tests) | 54 tests in 3 files passed | 4275269 |
| 1.5 rep cannot call admin RPC | PASS | SQLSTATE 42501 | 4275269 |
| 1.5 history row count unchanged | PASS locally (0→0); production 5 per owner | count queries; no DML in delta | 4275269 |
| 1.6 anon/rep view counts | PASS | anon 0/0, rep 77/77, admin 717/717 | 4275269 |
| 1.6 write grants and 0062 proposal | PASS (proposed, not applied) | ACL query; non-updatable views; 0062 file | 4275269 |
| 1.7 per-file plan | PASS | table in 1.7 | — |
| no production connection / no push | PASS | commands used only 127.0.0.1:55432; no push | — |
