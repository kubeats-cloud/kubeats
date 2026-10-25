# Reconcile progress (Codex leftovers on top of 1bcade4)

No student, rep, institute or visit records are recorded here. Counts, column names and commit hashes only.

## STEP 0 — assess what Codex left

- Worktree: `D:\free lance-verification-gaps`
- Branch: `codex/reconcile-verification-gaps`
- HEAD: `6a01c87 wip: previous agent leftovers`
- Working tree: clean (`git status --short` printed nothing)
- `git worktree list`: 15 entries; `D:\free lance-audit-live-2026-10-23` still at `1bcade4 [fix/audit-2026-10-23-live]`.
- 0.2 `git merge-base --is-ancestor aef8213 HEAD` -> exit code 0.

### 0.3 Original six commits

| hash | exists? | branches containing it | subject |
| --- | --- | --- | --- |
| cf78e3c | commit | codex/client-changes-live-verification | feat(D7): open/closed counts per activity on the Overview report |
| d4fca25 | commit | codex/client-changes-live-verification | feat(D2/A4): admin Pending shows the three follow-up cards |
| 8a2fa4f | commit | codex/client-changes-live-verification | feat(A7): open the existing member editor from Team rows |
| 4723e76 | commit | codex/client-changes-live-verification | feat(D1): add the rep Institutes download activity Excel |
| a7e9cd0 | commit | codex/client-changes-live-verification | feat(A1): show Institute Activity to every staff member |
| 73efe40 | commit | codex/client-changes-live-verification | fix(D2/D3/D4): align rep visit totals and missed labels |

### 0.4 Work done after 1bcade4 on the continuation branch

`git log --oneline 1bcade4..HEAD` (oldest first):

| continuation commit | subject | original | patch-id equal? |
| --- | --- | --- | --- |
| b45e736 | feat(D7): open/closed counts per activity on the Overview report | cf78e3c | no |
| d5e0493 | feat(D2/A4): admin Pending shows the three follow-up cards | d4fca25 | no |
| 4b086b0 | feat(A7): open the existing member editor from Team rows | 8a2fa4f | yes |
| 00526a6 | feat(D1): add the rep Institutes download activity Excel | 4723e76 | no |
| 466adcc | feat(A1): show Institute Activity to every staff member | a7e9cd0 | no |
| 8e335a7 | fix(D2/D3/D4): align rep visit totals and missed labels | 73efe40 | no |
| 2831a59 | fix(exports): align admin and rep visit workbooks | new | — |
| 9e8ac48 | fix(overview): reconcile status totals with other bucket | new | — |
| 6a01c87 | wip: previous agent leftovers | 400px layout only | — |

`git diff --stat 1bcade4..HEAD`: 41 files changed, 2933 insertions(+), 473 deletions(-).

Assessment (from code inspection, not commit messages):

- STEP 1: DONE in substance — all six items are present as rewritten commits on this branch; only 8a2fa4f is byte-identical. No cherry-pick needed.
- 2a: PARTIAL — `VISIT_HEADERS` now has Next action date, Total follow-ups, Open follow-ups and 0060 computes them in SQL; not yet exercised against `kubeats_rehearsal`.
- 2b: PARTIAL — route `view=rep` uses the visit-level sheet, rep UI has the From/To download control with the exact 31-day message; route error message differs; RLS not yet verified.
- 2c: PARTIAL — Overview "Rep activity report" is wired to `CustomisableGrid`; not yet verified in a browser or against Excel.
- 2d: PARTIAL — Other/inactive bucket exists for the Overview grid and Overview Excel (`9e8ac48`); admin and rep institute workbooks still have no Other column.
- 2e: PARTIAL — 400px classes committed as `6a01c87`; not measured at 400 px.
- 2f: NOT RUN.
- STEP 3: NOT RUN.
- STEP 4: NOT RUN.

### Status log

| step | status | commit | evidence |
| --- | --- | --- | --- |
| 0 | DONE | — | branch/worktree/hash table above; ancestor exit 0 |
| 1 | DONE (no picks needed) | 6a01c87 | six originals only on codex/client-changes-live-verification; equivalents already in 1bcade4..HEAD |
| 1.5 | DONE | 3372ef2 | `npm run lint` exit 0 (0 errors, 1 warning); `npm run typecheck` exit 0; `npm test` exit 0, 80 files passed / 1 skipped, 1390 tests passed / 155 skipped, 0 failed |
| 2a | DONE | 2831a59 + c041f28 | admin RPC: visitCount 785, visit rows 785, 0 payloads missing nextActionDate/totalFollowUps/openFollowUps; sums 163 total / 159 open equal direct SQL counts |
| 2b | DONE | 00526a6 + 2831a59 + 37d68b8 | rep workbook 89 data rows, 38 headers identical to admin, statusSum 89, Other 0, 1 distinct rep, 65 institutes, 0 blank rep cells; forged `member` URL produced the same SHA-256; rep admin-view 403; 32-day URL 400 "Choose a range of 31 days or fewer." |
| 2c | DONE | b45e736 + 9e8ac48 | Overview grid: 12 activity x Open/Closed + Other + TOTAL (14 value columns plus the rep label); picker 18 statuses (8 closed / 10 open); Overview Excel same 14 value columns; total 534 matches screen |
| 2d | DONE | c041f28 | Other/inactive column added after the status block; unit test for three filters proves status columns + Other = visit rows; 11 tests pass, tsc 0 |
| 2e | DONE | 6a01c87 + 45451fd | 400 px: admin overview/institutes/activity 385=385; TL team/institutes/activity 385=385; rep institutes 385=385. 1440 px: all 10 route renders 1425=1425 |
| 2f | DONE | 2831a59 (0060) | 0060 already applied at start; DOWN 117 ms -> BEFORE listing; UP 71 ms; DOWN 188 ms; diff BEFORE vs after-DOWN exit 0; re-UP 70 ms identical schema; 717 institutes / 785 visits unchanged |
| 3.1 | DONE | — | full/member/institute/rep workbooks all 38 headers; `requiredMissing: []`; 18 status columns plus "Other / inactive status"; 8 extras are Activity, Check-In Date, Check-Out Date, Location, Next action, Follow-up Date/Time/Created |
| 3.2 | DONE | — | full/member/institute workbooks: 20 metrics each, 0 mismatches; full status sum 783 + Other 2 = 785 visits |
| 3.3 | DONE | — | admin RPC 717 rows, 785 visits, 785 totalVisits, 512 meetings, 162 owned follow-ups, 120 pending, byStatus sum 783; rep RPC 69 rows, 89 visits, 24 meetings, 18 statuses. Direct SQL: 717 institutes, 785 visits, 512 meetings, 487 institutes in an open status |
| 3.4 | DONE | — | rep -> admin RPC 42501; admin -> rep RPC 42501; TL -> admin RPC 662 rows / 751 visits; cross-rep institute/visit select 0/0; own 69; rep target_statuses insert 42501, admin insert 1, TL insert 42501 (policy is admin-only, see risks) |
| 3.5 | DONE | — | widths above; rep `/team`, `/settings`, `/institutes/report` all redirect to `/`; admin/TL see Institute Activity and the activity view; screenshots in untracked `output/evidence/` |
| 3.6 | DONE | — | `npm run lint` exit 0 (1 warning `src/components/report/customisable-grid.tsx:148`); `npm run typecheck` exit 0; `npm test` 1711 pass / 10 skip / 7 integration fail on the rehearsal proxy (Storage + cron unavailable), not unit regressions |
| 4 | DONE (local stack caveat) | — | Docker 29.6.1. Worktree has no `supabase/config.toml`, so `npx supabase start` could not run there; used the already-running local stack `free_lance` (API 55321, DB 55322, Storage + pg_cron). Applied branch 0045, 0046 and 0053–0060 (exit 0 each) plus main-lineage 0045–0050 (0045 there is the target-statuses file and was a no-op). First run: 12 failed with `column institute_slabs.amount does not exist`; after 0045/0046, `rules.test.ts` 331 pass / 6 skip / 0 fail (exit 0), including Storage photo and materials tests. Local DB backup at `D:\kubeats_step4_before.dump` (outside repo). |
