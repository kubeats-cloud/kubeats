# KUbeats — Coverage audit (client's 21-item list)

Read-only, same rules as Step 0: no schema or code changes, no migrations, no
deploy. This maps the client's full change list against what already exists
in the codebase and the dev app (`sdderuaukprwpctmvane.supabase.co`, the
project confirmed as correct to read in the Step 0 follow-up). Nothing here
was changed to produce this document.

Legend: **Done** — fully built and live. **Partial** — part of it exists;
the rest is named exactly. **Missing** — not built.

---

## Admin

| # | Request | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Activity Report replaces Pipeline-by-Rep: institute-wise, Open/Closed, date filter, sort, Excel, clickable drill-downs | **Partial** | `/institutes/report` (`src/app/(app)/institutes/report/page.tsx`, titled literally **"Pipeline by rep"**) already has: a date-range filter on `status_updated_at` (`RangeControls`, `?from=&to=`), a sort control (`?sort=&dir=`, `parsePipelineSort`), and clickable drill-downs (every non-zero cell links into `/institutes`, per `linkCohorts` in `customisable-grid.tsx`). **Missing:** (1) rows are **reps**, not institutes — `getInstituteStatusModel()` (`src/lib/institute-status-report.ts`) builds `RepRow[]`, one row per owning rep, exactly the shape the client wants retired. An institute-wise table (one row per institute, its current activity/status) does not exist anywhere. (2) **No Excel export on this screen at all** — `ExportExcel` is imported and used on `/report` and `/team`, never on `/institutes/report`. |
| A2 | Correct activity-wise status counting | **Done** | `tallyVisitMetrics()` (`src/lib/validation/weekly.ts:119`) is the one function every counting screen calls; Meetings is sourced from `daily_plans.meetings_actual`, the other seven from `visits` — the split that prevents a Meeting ever landing in Sessions. `metricsMissingFromExport()` (`src/lib/exports/activity-grid.ts:72`) is a standing, tested check that every metric maps to exactly one export column. Proven live: `docs/KUbeats-Test-Results.md` scenario **26** constructed the exact shape that would double-count (a held plan row with no separate meeting visit) and both Weekly and Team counted it correctly. |
| A3 | Rep Call Reports shown in Admin Review | **Done** | `/review` lists every team visit (scenario **31**, PASS: "Showing 3 of 3 visits... server-side filtering... read-only report showing the proof photo large and uncropped"), and `/review/[id]/page.tsx` renders the full closing report via `src/components/visits/report-view.tsx` — person met, how it went, what was discussed, head count, photo. This *is* the "call report" in this app's own vocabulary. |
| A4 | Follow-up summary cards (Owned/Missed/Closed, clickable) | **Missing** | Admin Overview's tiles are Visits today/of planned, Visits this week, Reports filed, Photos in; its side rail is Latest from the team, Out today, Still checked in, Open loops, and a Go-to list (`docs/current-implementation-map.md` §7, confirmed against `src/components/admin/overview.tsx`). There is no 3-state Owned/Missed/Closed follow-up card group anywhere on Overview. The closest pieces — "Open loops" (live open-institute count) and `/missed` (a historical log, not a live state, see R6 below) — are separate, differently-shaped, and not presented as clickable summary cards together. |
| A5 | Search Rep by name in Team tab | **Missing** | `/team` (`src/app/(app)/team/page.tsx`) and `TeamSnapshot` (`src/components/dashboard/team-snapshot.tsx`) render every member with no search/filter input of any kind — confirmed by reading both files; no `Input`, `SearchIcon`, or filter state exists in either. |
| A6 | Assign Team Leads + manage team institutes across campuses | **Partial** | Team-lead assignment is fully built: `assign_rep_to_team()` (`supabase/migrations/0043_team_assignment.sql`), `assignRepToTeam()` (`src/lib/admin-actions.ts`), `TeamStructure` (`src/components/admin/team-structure.tsx`). **"Across campuses" is missing, and not just unbuilt — it is actively prevented by design.** Migration `0042_team_lead_scoping.sql`'s own header states "TWO TEAM LEADS SHARE ONE CAMPUS" as the worked example, and `enforce_profile_campus` (FO021) plus FO033 "keep a rep and their lead on one campus." A team lead's institute visibility (`supervises(registered_by)`) is bounded by their own reps, who are all on one campus by construction — there is no cross-campus institute management for a lead today. |
| A7 | Role dropdown added to existing Edit form | **Missing** | The role **Select** exists only on the **new-member creation** form (`src/components/settings/team-panel.tsx:592`, `<Select value={role} onValueChange={setRole}>`). The **existing-member edit dialog** explicitly omits it — line 724: *"Their email address, password and role are not changed here"* — and posts the unchanged role as a hidden input (line 731). `memberUpdateSchema`'s comment (`src/lib/validation/admin.ts:438`) confirms role is carried through for a validation check only, "NOT a field that may be changed." |
| A8 | Add new target statuses | **Missing** | `METRICS` (`src/lib/validation/weekly.ts:28`) is a fixed array of eight, matching `public.targets`'s eight integer columns — adding a ninth requires a code change and a migration, not an admin action. This is the documented, deliberate design (CLAUDE.md: "activity is six values and stays six") — there is no admin-facing way to add a target status/metric. |
| A9 | Settings Status Management (custom statuses + status-specific fields) | **Done** | `src/components/settings/statuses-panel.tsx` + `statusSchema` (`src/lib/validation/admin.ts:140`): add/rename/retire, required `category` (open/closed, no default — `z.enum(STATUS_CATEGORIES)`), non-empty name, duplicate rejected ("A status with that name already exists.", `src/lib/admin-actions.ts:191,301`). Status-specific fields exist too: `asks_expected_date`, `asks_session_detail`, `asks_head_count` per status row. |

---

## Rep

| # | Request | Status | Evidence |
| --- | --- | --- | --- |
| R1 | Institute-wise activity table (sort + date filter) | **Missing** | A rep's only institute list is the shared `/institutes` page (`institutes-browser.tsx`): status/owner/location/type filters and a column-visibility `ViewPicker`, but no **date filter** and no **sort-by-column** control (confirmed by reading the file — filter state only, `Array.sort()` calls are fixed alphabetical sorts for dropdown option lists, not a user sort). A rep cannot reach `/institutes/report` (staff-only, and it is rep-wise there anyway, see A1) or `/report`'s per-institute breakdown (see R7 — it does not have one). |
| R2 | Admin access to add target statuses | **Missing** | Same gap as A8 — this is the rep-side restatement of it; no admin UI adds a target status/metric. |
| R3 | Auto follow-up in Daily Plan (incl. past-due, no dupes) | **Partial** *(carried forward from Step 0)* | `listFollowUpTasks()` (`src/lib/visits.ts`) already selects `due_date <= today AND done_at IS NULL` — today's and every past-due task in one query. **Gated off:** the Dashboard's call to it is behind `PHASE_A_DAILY_PLAN = false` (`src/lib/features.ts:142`), so a rep sees none of this today. No-duplicate behavior for *auto-add* specifically is unverified while the flag is off; `addToDailyPlan` is insert-only (no upsert) per CLAUDE.md's 0033 note, which is suggestive but not proof for this exact path. |
| R4 | Log Visit shows selected institute's Open/Closed statuses | **Done** | `log-visit-form.tsx:495-504` — the institute-status `Select` is grouped with `STATUS_CATEGORIES.map()` into two `SelectGroup`s labelled by `CATEGORY_LABELS` ("Open (still in play)" / "Closed (nothing further owed)"), each populated by `statusesInCategory(catalogue, category)`. |
| R5 | Next Action rules by status (+ Not Interested) | **Partial** | `NextActionFields` (`src/components/visits/next-action-fields.tsx`, "What happens next?" — Call/Meeting) exists and is wired into `log-visit-form.tsx` and `feedback-only-form.tsx`, but **gated behind `PHASE_A_DAILY_PLAN = false`** — dark in production today. **"Not Interested" specifically does not exist** as an institute status at all (see the Phase 0 gap below), so there is no rule for it to follow regardless of the flag. |
| R6 | Pending tab follow-up cards (Owned/Missed, clickable) | **Partial** | Pending (`src/app/(app)/pending/page.tsx`) already has two live, clickable blocks: **"Due today"** (`follow_up_tasks`, via `FollowUpCalls`) and **"Follow-ups owed"** (open institutes, via `FollowUpList`, clickable "Visit again" → `startFollowUp()`). This covers "Owned" well. **"Missed" is not a card on this screen** — it is a link out to `/missed`, which is a **historical 30-day log** ("a day that ended with follow-ups still open"), not a live per-follow-up Missed state rendered as a card here. |
| R7 | Rep Activity Report institute-wise table | **Missing** | `/report` (`src/app/(app)/report/page.tsx`, titled "Activity report") exists and is rep-reachable (no admin gate — "a rep sees only themselves"), with period controls and `ExportExcel`. But its own doc-comment says what it does: *"reads what /review reads and **counts** it instead of **listing** it"* — it is an aggregate count screen (Meetings: n, Sessions: n, …), not an institute-wise table. No institute-wise view exists for a rep anywhere, the same root gap as A1/R1. |

---

## IQcity

| # | Request | Status | Evidence |
| --- | --- | --- | --- |
| IQ1 | Admin soft-delete institute (confirm popup) | **Missing** | `institute-actions.ts` exports exactly five functions: `createInstitute`, `updateInstitute`, `addArea`, `addCounsellor`, `removeCounsellor` — no delete, retire, or archive of any kind. The `institutes` table (`0001_init.sql:115`) has no `is_active`/`deleted_at`/archived column in any migration through `0044`. There is nothing to confirm-popup because there is no delete path to guard. |
| IQ2 | Foot Mapping in Session Target | **Missing / blocked** | Per your instruction: fields are undefined by the client. Not designed, not investigated further. Needs a field spec from the client before this can move past "Missing." |
| IQ3 | Reassign institute to another Rep | **Done** | `ReassignOwner` (`src/components/institutes/reassign-owner.tsx`) + `reassignInstitute()` (`src/lib/admin-actions.ts`) + `guard_institute_owner()` / FO025 (`0028_rep_owned_institutes.sql`) refusing a cross-campus move server-side. Admin-only, same-campus reps only, current owner excluded from the picker. `tests/unit/reassign-candidates.test.ts` covers the candidate-list edge cases. |
| IQ4 | Downloadable field-visit Excel by date range | **Partial** | A date-range Excel export exists and is live: `/api/export/activity` (`src/app/api/export/activity/route.ts`) takes `?start=&end=&member=` and returns an `.xlsx` (used from `/report` and `/team`). **But it is the aggregated activity grid** (counts per rep per status/activity column via `buildActivityExport()`), **not a row-per-visit field-visit list** (institute, rep, date, activity, status, location). No raw-visit export exists anywhere — `/review` (the visit browser) has no export at all. |
| IQ5 | "Not Interested" close: cancel follow-up, keep history | **Missing** *(= Phase 0 gap, restated)* | See below — the status itself doesn't exist, so neither does the cancellation trigger. |
| IQ6 | Forgot Password email reset | **Missing** | No `resetPasswordForEmail`, no `/forgot-password` or `/reset-password` route, no "Forgot password?" link found anywhere under `src/app`. The only incidental matches for "reset" were unrelated (`global-error.tsx`, `health/route.ts`). |

---

## Carried forward — the four Phase 0 gaps (unchanged)

1. **No per-institute reconciliation check** — nothing asserts that, for a given institute, the sum of its per-activity-type visit counts equals its total visit count. `metricsMissingFromExport()` checks the metric *vocabulary* is complete; nothing checks the *arithmetic* per institute.
2. **"Not Interested" does not exist as a built-in Closed institute status.** Confirmed again this pass by the live query in Step 0 (nine seed statuses only, nothing added) and by code search: `"Not interested"` exists solely as a retired closing-report vocabulary value (`VISIT_OUTCOMES`, `MANAGEMENT_RESPONSES` in `src/lib/validation/feedback.ts`), unrelated to `institute_statuses`.
3. **Marking an institute "Not Interested" cancels nothing**, because the status doesn't exist (depends on #2). This is the same gap as **IQ5** above — one gap, two names in the two documents.
4. **The Daily-Plan auto-population from follow-up tasks is built but dark** — `PHASE_A_DAILY_PLAN = false` (`src/lib/features.ts:142`). This is the root cause behind **R3** (Partial) and half of **R5** (Partial) in the table above — the same flag gates both.

---

## Decisions still needed from you (restated in one place)

From the Step 0 report, §3/§6/§7 — still open:

1. **§6 — migration style.** Keep the house convention (additive-only forward migrations + backup/restore for rollback) for any new migration this work produces, or introduce literal paired down-scripts to match the letter of the original brief?
2. **§7 — PHASE_A_DAILY_PLAN.** You said "discuss later" — flagging again because it is now the direct cause of three items above (R3, half of R5, and indirectly R6's "Owned" framing), not only the one Phase 0 gap it was first raised against.
3. **§7 — scope of the fix.** Across both audits the gap list has grown from 4 to effectively a larger set once the 21 client items are counted individually (A1/A4/A5/A6/A7/A8/R1/R2/R7/IQ1/IQ4/IQ6 add new, distinct gaps beyond the original four). Worth deciding up front whether to tackle these as one batch of migrations/features or in the client's own priority order, before any implementation starts.

No code, schema, or data was changed to produce this report.
