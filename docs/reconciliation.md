# Production plus the 22 client changes

## Phase 1 - divergence verified before resolution

Date: 23 October 2026. Merge-base: `4554579debb7153768ad9171d6703cb37df0e81c`.
Production: `client/main` at `4046bd2591ac81952a54b0da5c9634c4e37b0277`.
Verified with `git ls-remote client refs/heads/main`; remote and local match.
Source: `codex/client-changes-live-verification` at `96095cb`.
Destination: `reconcile/prod-plus-22changes`, created from production in
`D:/free lance-reconcile`. The original worktree and uncommitted evidence are untouched.

Production additions since the fork: Total Institutes card (35b519c), slab rupee
amounts / migration 0045 (1bc3957), standalone Slabs (1e1f957), compact previews
(11c5392), Team Leads Assign (ff92ecb), slab queue (355780c), Phase A daily-plan
flow / weekly nudge (0ec41c6, a6166eb, 51997ab), notification bell (c87e196),
Overview pipeline (2502dfc), saved-call report / migration 0046 (7297aa5, ce1eda8),
Settings team preview/search (0143534), and IQ6 (4046bd2).

Source additions: A1/A2 institute activity model/report, A5 search, A4/R6 cards,
A8/R2 target statuses, R1/R7 institute tables, R4 selected-institute status,
R5/IQ5 Not Interested/cancellation, A7 role editing, IQ1 soft deletion, IQ4 field
visit Excel, A3 call review, R3 automatic planning, A9 configurable fields, and IQ6.
A6 cross-campus remains held; IQ2 remains blocked. Prior completion labels are
not substituted for fresh reconciled-app verification.

| Area | Production version | Source version | Proposed resolution |
| --- | --- | --- | --- |
| Overview | Institutes Pipeline and totals | A1/A2 Activity Report | Corrected Activity Report replaces pipeline; unrelated production cards survive |
| Team | Team Leads Assign | A5 name search; A7 roles | Retain assignments; add corrected search and existing-form role editing |
| Settings Team | Ten-row preview, name/email search | Role dropdown | Preserve preview/search, add Role to the same Edit form |
| Daily plan | Call/meeting flow, call tick-list, weekly nudge | R3 automatic plans | Preserve controls/nudge, apply automatic due/overdue planning and duplicate protection |
| Calls | Existing log-call route and saved task record | A3 Review and A9 fields | Keep existing call entry route, connect corrected Review and fields to that same saved record |
| Slabs | Amounts, queue, standalone screen | Older source lacks them | Keep production standalone features |
| Notifications | Bell with due-task count | Older source behavior | Keep production, verify with reconciled follow-ups |
| Rep snapshot | Total Institutes card | Older snapshot | Keep production card |
| Follow-ups | Production Pending layout | A4/R6 cards; R5/IQ5 cancellation | Corrected card placement and record-preserving cancellation win |
| Statuses | Fixed fields | A9 engine | Use corrected engine in both visit and production call forms |
| Institutes/reports | Production tools | IQ1/IQ3/IQ4 | Add deletion/reassignment/export while retaining unrelated tools |
| Auth | IQ6 already present | Equivalent IQ6 patch | Keep one password-reset flow |

### Migration plan

Production 0001-0046 are preserved. Source migrations are replayed after them:

| Source | Reconciled | Purpose |
| --- | --- | --- |
| 0045_target_statuses | 0047_target_statuses | A8/R2 |
| 0046_not_interested | 0048_not_interested | R5/IQ5 |
| 0047_preserve_cancelled_plans | 0049_preserve_cancelled_plans | Preserve cancelled plans |
| 0048_edit_member_role | 0050_edit_member_role | A7 |
| 0049_soft_delete_institute | 0051_soft_delete_institute | IQ1 |
| 0050_saved_call_reports | 0052_saved_call_reports | Compatible hardening of production saved-call RPC; no duplicate storage |
| 0051_automatic_follow_up_plan | 0053_automatic_follow_up_plan | R3 |
| 0052_status_management_dynamic_fields | 0054_status_management_dynamic_fields | A9 |

Each DOWN and reference must follow the same mapping. Source A9 DOWN currently
drops payload/configuration data; replace with a tested data-preserving behavioral
rollback. No production database operation, push or deployment is authorized.

## Progress

Phase 1 complete. Replay, fresh-local migration checks, combined runtime verification,
full tests and build are pending. No reconciled feature is claimed verified yet.
