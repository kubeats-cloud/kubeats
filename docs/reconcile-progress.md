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
