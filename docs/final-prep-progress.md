# Final prep progress

Phase 1 and Phase 1b. Date: 2026-10-25.
Worktree: `D:\free lance-verification-gaps`. Branch: `codex/reconcile-verification-gaps`.
Phase start HEAD: `5ecef05`. Phase 1 delta commit: `4275269`; Phase 1b ACL delta commit: `be86359`.
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

`md5` is over `pg_get_functiondef(oid)`. The first table is raw, before line-ending normalisation; it shows why the initial comparison failed.

| function | production md5 (owner-supplied) | local @ `1bcade4` | local @ HEAD (`0061` applied) | prod = `1bcade4`? | prod = HEAD? |
|---|---|---|---|---|---|
| `audit_institute_activity` | `0026be7e3cc1e5a53c5babed51b46180` | `27f560d048b95ddc96a2ffaa1e07629e` | `18da8dbcc8613a1a0a9e967e8cb19bb4` | NO | NO |
| `audit_registry_facets` | `f24f7eaf361f7fdf9016bc12928e6891` | `e024d8bf129f22b1b1dd99ea430e4a88` | `e024d8bf129f22b1b1dd99ea430e4a88` | NO | NO |
| `audit_rep_institute_activity` | `adba1660a30e22805be14eb57b2efe44` | `b6ab0ded68e9b8325a048e031a15fb42` | `55ee525455762fb1308b0e211be15aa8` | NO | NO |
| `record_institute_reassignment` | `ce22cdf855989397c85a63a942400594` | `a80c43fac2b0f96e450e29e94b4e6600` | `a80c43fac2b0f96e450e29e94b4e6600` | NO | NO |
| `record_institute_status_change` | `e8fa561083e48fd2c7bd607e41a4059a` | `e8fa561083e48fd2c7bd607e41a4059a` | `e8fa561083e48fd2c7bd607e41a4059a` | YES | YES |
| `reject_reassignment_history_mutation` | `5307c17a08ec244d530b1e37630e6657` | `1f3135e6c4bc23c1f5e799655437f2b4` | `1f3135e6c4bc23c1f5e799655437f2b4` | NO | NO |
| `log_call` (0052 side note) | `975df4ea6f8ca60dcf0a2c55fa826a9b` | `e50f23a5dae57de3c272f42d357c6672` (dump; 0052 skipped) | `e50f23a5dae57de3c272f42d357c6672` | NO | NO |

**Resolved in Phase 1b.** The production definitions are now present in `D:\kubeats_backups\prod_fingerprints\` (CSV 14). Five of the six bodies contain CR (counts 157, 10, 160, 6, 0, 4); `record_institute_status_change` has none. Normalising both sides by removing `\r` and trimming trailing whitespace per line gives:

| function | prod md5 (CR stripped) | prodshape md5 (CR stripped) | equal? |
|---|---|---|---|
| `audit_institute_activity` | `27f560d048b95ddc96a2ffaa1e07629e` | `18da8dbcc8613a1a0a9e967e8cb19bb4` | NO |
| `audit_registry_facets` | `e024d8bf129f22b1b1dd99ea430e4a88` | `e024d8bf129f22b1b1dd99ea430e4a88` | YES |
| `audit_rep_institute_activity` | `b6ab0ded68e9b8325a048e031a15fb42` | `55ee525455762fb1308b0e211be15aa8` | NO |
| `record_institute_reassignment` | `a80c43fac2b0f96e450e29e94b4e6600` | `a80c43fac2b0f96e450e29e94b4e6600` | YES |
| `record_institute_status_change` | `e8fa561083e48fd2c7bd607e41a4059a` | `e8fa561083e48fd2c7bd607e41a4059a` | YES |
| `reject_reassignment_history_mutation` | `1f3135e6c4bc23c1f5e799655437f2b4` | `1f3135e6c4bc23c1f5e799655437f2b4` | YES |

The two remaining differences are exactly the intended HEAD body additions, not signature changes. First unified diff hunk for each:

```diff
--- production audit_institute_activity
+++ prodshape audit_institute_activity
@@ -47,4 +47,12 @@
         from ranged_visits group by institute_id,status_set_to
       ) c group by institute_id
+    ), visit_followups as (
+      select from_visit_id,
+        count(*)::integer total_follow_ups,
+        count(*) filter (where done_at is null)::integer open_follow_ups,
+        min(due_date) filter (where done_at is null) next_action_date
+      from follow_up_tasks
+      where from_visit_id is not null
+      group by from_visit_id
     ), ranged_plans as materialized (
       select d.id,d.institute_id,d.date,d.meetings_actual,d.checkin_at,d.checkout_at,
```

```diff
--- production audit_rep_institute_activity
+++ prodshape audit_rep_institute_activity
@@ -142,4 +142,39 @@
         coalesce(p_page,1) < 1 all_rows
       from counts
+    ), visit_followups as (
+      select from_visit_id,
+        count(*)::integer total_follow_ups,
+        count(*) filter (where done_at is null)::integer open_follow_ups,
+        min(due_date) filter (where done_at is null) next_action_date
+      from follow_up_tasks
+      where from_visit_id is not null and member = v_me
+      group by from_visit_id
+    ), visit_payloads as (
+      select jsonb_build_object(
+        'institute',r.name,
+        'member',p.name,
+        'activity',v.activity,
+        'meetingPurpose',d.purpose,
+        'date',v.date,
+        'status',v.status_set_to,
+        'nextAction',v.next_action,
+        'nextActionDate',vf.next_action_date,
+        'totalFollowUps',coalesce(vf.total_follow_ups,0),
+        'openFollowUps',coalesce(vf.open_follow_ups,0),
+        'checkinAt',d.checkin_at,
+        'checkoutAt',d.checkout_at,
+        'checkinLat',d.checkin_lat,
+        'checkinLng',d.checkin_lng,
+        'followUpDate',v.follow_up_date,
+        'followUpTime',v.follow_up_time,
+        'followUpCreated',coalesce(vf.total_follow_ups,0) > 0
+      ) payload,v.date,v.id
+      from visits v join registry r on r.id = v.institute_id
+        left join daily_plans d on d.id = v.daily_plan_id
+        left join profiles p on p.id = v.member
+        left join visit_followups vf on vf.from_visit_id = v.id
+      where v.member = v_me
+        and (p_from is null or v.date >= p_from)
+        and (p_to is null or v.date <= p_to)
     )
     select jsonb_build_object(
```

Local file-side change `1bcade4` → HEAD is only `0060`: +51 lines, 0 deletions. The admin body adds the `visit_followups` CTE and the `nextActionDate` / `totalFollowUps` / `openFollowUps` visit fields; the rep body adds `visit_followups`, `visit_payloads` and visit rows. This is the intended delta.

## 1.3 Object comparison at `1bcade4` and HEAD

`git diff 1bcade4..HEAD` over 0055–0059 is empty. Only 0060 changed. Production descriptions for views, tables, indexes, policies and triggers below are owner-supplied; production function definitions were captured in Phase 1b (CSV 14), but no production view/table DDL exists.

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
| function `record_institute_status_change` | normalized md5 `e8fa561083e48fd2c7bd607e41a4059a` (0 CR) | same md5 | same md5 | **YES** (fingerprint) |
| function `record_institute_reassignment` | raw `ce22cdf8...`; normalized `a80c43fac2b0f96e450e29e94b4e6600` (6 CR) | `a80c43fac2b0f96e450e29e94b4e6600` | same | **YES** (normalized fingerprint) |
| function `reject_reassignment_history_mutation` | raw `5307c17a...`; normalized `1f3135e6c4bc23c1f5e799655437f2b4` (4 CR) | `1f3135e6c4bc23c1f5e799655437f2b4` | same | **YES** (normalized fingerprint) |
| function `audit_registry_facets` | raw `f24f7eaf...`; normalized `e024d8bf129f22b1b1dd99ea430e4a88` (10 CR) | `e024d8bf129f22b1b1dd99ea430e4a88` | same | **YES** (normalized fingerprint) |

The earlier three function mismatches were CRLF artifacts, not definition changes. After normalising both sides, every function that 0056 and 0058 create matches production text, so the 0056/0058 owner checks are resolved: both files are **SKIP**. Exact DDL for the views, table, index, policy and triggers still **CANNOT TELL**, because only functions were captured as definitions; presence and described properties match.

## 1.4 HEAD 0060 parameter identity and ACL

Production values come from `D:\kubeats_backups\prod_fingerprints\` CSV 14 (definitions) and CSV 16 (function ACL). They are authoritative; nothing here is read from a production connection.

| property | production | 0061 delta | same? |
|---|---|---|---|
| admin input types | `date,date,text,uuid,uuid,text,boolean,integer` | same | YES |
| admin parameter names and order | `p_from,p_to,p_search,p_member,p_campus,p_sort,p_desc,p_page` | same | YES |
| admin defaults | `NULL, NULL, '', NULL, NULL, 'institute', false, 1` | same | YES |
| admin return | `jsonb` | `jsonb` | YES |
| admin security | `SECURITY INVOKER` (`prosecdef = f`) | invoker | YES |
| admin volatility / search_path | `STABLE`; `search_path=public` | same | YES |
| rep input types | `date,date,text,boolean,integer` | same | YES |
| rep parameter names and order | `p_from,p_to,p_sort,p_desc,p_page` | same | YES |
| rep defaults | `NULL, NULL, 'institute', false, 1` | same | YES |
| rep return / security / volatility / search_path | `jsonb`; invoker; `STABLE`; `search_path=public` | same | YES |
| admin ACL | owner `postgres`; `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` | restored explicitly | YES |
| rep ACL | same as admin | restored explicitly | YES |
| `audit_registry_facets` ACL | same as admin | restored explicitly | YES |

There are **no** parameter-name, default, type-order, return-type, volatility, security or search_path differences. The admin drop guard is therefore defensive, not required by the current production signature.

What the admin drop guard does, and why a DROP is used:

1. It is `drop function if exists public.audit_institute_activity(date,date,text,uuid,uuid,text,boolean,integer);` immediately before `create or replace`.
2. A function's identity in PostgreSQL is its input type list, not its parameter names; a DROP by that list removes the old function whatever its names are.
3. `CREATE OR REPLACE FUNCTION` raises `42P13` if parameter names or the return type change; it can only replace a body in place.
4. CSV 14 shows production and 0061 agree on names, defaults, types, return and volatility, so no `42P13` condition exists today.
5. The guard is kept as a safety net for the previously unknown production identity and for drift between environments.
6. A body-only change does not need a DROP; `create or replace` alone is sufficient.
7. A DROP removes the function and, with it, every EXECUTE grant and the old ACL.
8. `CREATE` then assigns the owner (the executing role, expected to be `postgres`) and applies default ACLs; Supabase default privileges can expose EXECUTE to `anon`.
9. 0061 therefore restores production exactly after every create: `revoke all ... from public, anon;` then `grant execute ... to authenticated, service_role;` for admin, rep and `audit_registry_facets()` (which 0061 does not redefine).
10. The whole file is one `begin`/`commit`; a failure at any point rolls back the drops, creates and ACL changes together.

Everything 0061 does:

- No table, view, column, index, trigger or data change.
- Admin and rep bodies are byte-identical to HEAD 0060; the added fields and visit rows are described in 1.2.
- ACL restore as in item 9, in the same transaction.

## 1.5 Delta rehearsal

Files: `supabase/deltas/0061_delta_to_head.sql` and `supabase/deltas/0061_delta_to_head_down.sql` (first added in `4275269`, ACL-corrected final version `be86359`). The up file is HEAD 0060 text plus its header, the admin drop guard and the ACL restore block; diff against `git show HEAD:...0060` shows only those. The down file is `1bcade4` 0060 text plus the same guard and ACL block; diff against `git show 1bcade4:...0060` shows only those. Each file has exactly one `begin;` and one `commit;`.

| stage | `audit_institute_activity` | `audit_rep_institute_activity` | history rows |
|---|---|---|---|
| before delta (`1bcade4` state) | `27f560d048b95ddc96a2ffaa1e07629e` | `b6ab0ded68e9b8325a048e031a15fb42` | 0 |
| apply 0061 | `18da8dbcc8613a1a0a9e967e8cb19bb4` | `55ee525455762fb1308b0e211be15aa8` | 0 |
| apply 0061 DOWN | `27f560d048b95ddc96a2ffaa1e07629e` | `b6ab0ded68e9b8325a048e031a15fb42` | 0 |
| re-apply 0061 | `18da8dbcc8613a1a0a9e967e8cb19bb4` | `55ee525455762fb1308b0e211be15aa8` | 0 |

The other four functions stayed at `e024d8bf...`, `a80c43fa...`, `e8fa5610...`, `1f3135e6...` through every stage. The applied HEAD fingerprints equal the local rehearsal database's HEAD fingerprints.

Production ACL (CSV 16) compared with prodshape after each stage. Owner, `proacl` and `has_function_privilege` are identical at apply, DOWN and re-apply:

| function | owner | `proacl` | anon | authenticated | service_role | PUBLIC |
|---|---|---|---|---|---|---|
| `audit_institute_activity(...)` | `postgres` | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` | false | true | true | absent |
| `audit_rep_institute_activity(...)` | `postgres` | same | false | true | true | absent |
| `audit_registry_facets()` | `postgres` | same | false | true | true | absent |

Production CSV 16 gives the same owner and the same `proacl` string, `anon_exec = false`, `auth_exec = true`. Evidence: `output/evidence/phase1b-after-apply-acl.log`, `phase1b-after-down-acl.log`, `phase1b-after-reapply-acl.log`.

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
| `0056_audit_registry.sql` | **SKIP** | Applied in production. The view and facets exist; after CRLF normalization `audit_registry_facets` md5 `e024d8bf...` equals both local versions. Exact view DDL still **CANNOT TELL**. |
| `0057_audit_open_follow_ups.sql` | **SKIP** | View exists in production; no function fingerprint. |
| `0058_audit_reassignment_history.sql` | **SKIP** | Applied in production. The table, policy and triggers exist; after normalization `record_institute_reassignment` `a80c43fa...` and `reject_reassignment_history_mutation` `1f3135e6...` equal both local versions. The 5 production history rows must be preserved; 0058 is not rerun. |
| `0059_target_status_case_unique.sql` | **SKIP** | Unique index exists; owner reports 0 duplicate groups and 0 null names. |
| `0060_audit_status_activity.sql` | **APPLY DELTA** | Run `supabase/deltas/0061_delta_to_head.sql` (final `be86359`); DOWN is `supabase/deltas/0061_delta_to_head_down.sql`. Owner runs it explicitly. ACL now matches production exactly. Still check function ownership and production signatures first. |

## Blockers and owner checks

1. 0061 is one transaction with a drop guard. Run it as the function owner (production owner is `postgres` per CSV 16). If the executing role does not own `audit_institute_activity`, the DROP fails and the transaction rolls back.
2. 0062 is conditional on production actually holding the write grants; verify in production before applying. It was not applied locally.
3. `0052`/`log_call` and the `institute_reassignment_history` count (local 0, production 5) are known environment differences; neither file is rerun or changed. 0061 contains no DML and cannot change that count.
4. Restore produced 30 extension-related errors locally, not 159; the local database is production-shaped for the public schema objects tested here, not a bit-for-bit production clone.
5. Excel header parity is unit-tested at HEAD, not generated end-to-end from `kubeats_prodshape`.
6. Exact view/table/index/policy/trigger DDL from production is still unavailable; only described properties and function definitions were compared. Those rows remain **CANNOT TELL**.
7. No claim of deploy safety is made. The owner decides.

## Phase 1 and Phase 1b status

| item | result | evidence | commit |
|---|---|---|---|
| 1.1 prod-shape DB created from dump | PASS (30 extension errors, not 159) | restore log; public schema restored | — |
| 1.1 0047–0054 applied, 0052/0046 skipped | PASS | 7 migration logs, 0 `ERROR` each | — |
| 1.1 0055–0060 @ `1bcade4` applied | PASS | 6 migration logs, 0 `ERROR` each | — |
| 1.2 six-function fingerprints measured | PASS | table in 1.2; local DB queries | 4275269 |
| 1.2 production fingerprint parity, both sides normalized | PASS (comparison done: 4 of 6 text-identical; admin and rep differ only by the intended HEAD 0060 body delta) | normalized table in 1.2; CR stripped and trailing whitespace trimmed | be86359 |
| 1.2 exact definition diff / first differing statement | PASS | admin adds `visit_followups`; rep adds `visit_followups` and `visit_payloads`; no signature change | be86359 |
| 1.3 object comparison table | PASS (function rows now YES after normalization; view/table/index/policy/trigger exact DDL remain CANNOT TELL) | table in 1.3 | be86359 |
| 1.4 parameter names/defaults/return/volatility vs production | PASS (no differences) | CSV 14 comparison table in 1.4 | be86359 |
| 1.4 replace-safe apply | PASS locally | 0061 applied with drop guard; 0 errors | be86359 |
| 1.4 production ACL restored | PASS (owner + `proacl` + privilege booleans equal CSV 16) | ACL table in 1.5; `phase1b-after-reapply-acl.log` | be86359 |
| 1.5 apply / DOWN / re-apply | PASS | md5 table in 1.5; history 0 throughout | be86359 |
| 1.5 ACL at apply / DOWN / re-apply | PASS (identical at all three stages) | ACL table in 1.5 | be86359 |
| 1.5 RPC counts and status+Other identity | PASS | admin 534/534/717, statusSum 534, Other 0; rep 60/60/77, Other 0 | be86359 |
| 1.5 Excel header parity | PASS (unit tests) | 54 tests in 3 files passed | 4275269 |
| 1.5 rep cannot call admin RPC | PASS | SQLSTATE 42501 | be86359 |
| 1.5 history row count unchanged | PASS locally (0→0); production 5 per owner | count queries; no DML in delta | be86359 |
| 1.6 anon/rep view counts | PASS | anon 0/0, rep 77/77, admin 717/717 | 4275269 |
| 1.6 write grants and 0062 proposal | PASS (proposed, not applied) | ACL query; non-updatable views; 0062 file | 4275269 |
| 1.7 per-file plan | PASS; 0056 and 0058 resolved to SKIP | tables in 1.3 and 1.7 | be86359 |
| no production connection / no push | PASS | commands used only 127.0.0.1:55432; no push | — |
