# Scope-conformance audit — batch 1, 3a, 3b vs docs/client_changes.md

Read-only comparison first, then the corrections actually made. Source of
truth throughout: the client's own wording in `docs/client_changes.md`.

---

## 0. Batch 1 (Not Interested) — nothing live to audit

**Batch 1 is not built on this branch, or any branch, or applied to local
Supabase.** Confirmed again before writing this: `batch-1/not-interested`'s
one real commit is an unrelated Overview-pipeline feature; the actual
Not-Interested work exists only as **untracked files in `.batch1-wip/`**
(`0045_not_interested.sql`, its down-migration, and a test file) and as
**git stash `stash@{0}`**. Neither has ever been applied, committed to a
tracked branch, or merged anywhere. There is no live screen, column, button,
or label to compare against Rep #5 / IQcity #5 — so there is nothing to
"remove or correct" for batch 1 in the running app.

For reference only (not modified, not audited line-by-line, since it isn't
live): a quick read of `.batch1-wip/not-interested.test.ts` shows the staged
design already matches the shape of Rep #5 / IQcity #5 reasonably closely
(a built-in closed status named via `NOT_INTERESTED_STATUS`, Next Action
hidden for it, a reconciliation guard). Worth a proper audit **if and when**
that work is actually applied to a branch — not before.

---

## 1. Batch 3a — Admin #1 + Admin #2

### Findings (before correction)

| # | Element found in code | In client's text? | Verdict |
|---|---|---|---|
| 1 | "Follow-ups owned" column (table + Excel) | No — Admin #1/#2 name only the six activity types' Open/Closed counts | **Extra — removed** |
| 2 | "Follow-ups pending" column (table + Excel) | No | **Extra — removed** |
| 3 | "Meetings completed" column (table + Excel) | No | **Extra — removed** |
| 4 | "Total" / "Total activities" column (table + Excel) | Ambiguous — #2 says "Ensure overall totals match the sum of the corresponding activity counts," which could mean this visible column or an invisible guarantee | **Flagged, not removed — see §4** |
| 5 | Overview "Go to" shortcut relabelled "Activity by institute" (my own wording, added in batch 3a to avoid colliding with the pre-existing, unrelated `/team/report` shortcut already labelled "Activity report") | No — invented by me, not the client | **Flagged — see §4** |
| 6 | The institute-wise table lives at `/institutes/report`, reached by a link, not embedded on the literal Admin Dashboard (`/`) route | Client's words are "Remove the Pipeline by Rep table **from the Admin Dashboard**. Display the existing Activity Report table **on the Admin Dashboard** in its place." | **Flagged — see §4** |
| 7 | Six activity labels read "Meeting," "Session," "Campus Visit," "Olympiad Registration," "Application Form," "Admission" (singular/compound) vs. the client's plural phrasing ("Meetings, Sessions, Campus Visits, Olympiad Registrations, Applications, and Admissions") | Pre-existing, app-wide vocabulary (`ACTIVITIES` in `src/lib/validation/visit.ts`), used on every screen that names an activity type — not introduced by batch 3a | **Not a violation — out of scope, unchanged** |
| 8 | "Download Excel" button | Client: "Add a Download Excel button" | **Matches exactly — unchanged** |
| 9 | Institute name → `/institutes/[id]`; activity count → `/review?...` | Client: "Clicking an institute name should open its activity details... Clicking an activity count should display the corresponding activity records" | **Matches — unchanged** |
| 10 | Page description copy, range-filter hint text, reconciliation-warning text | Ordinary page chrome every screen in this app already carries | **Not flagged as a feature-scope issue** — noted for completeness, not touched |

### Corrections made
- `src/components/report/institute-activity-table.tsx` — removed the "Follow-ups owned," "Follow-ups pending," and "Meetings completed" columns (header row, sub-header spacer cells, body cells), and fixed the empty-state `colSpan`.
- `src/lib/exports/institute-activity-export.ts` — removed the same three columns from the Excel sheet header and row-building loop, so the file still matches the displayed table exactly.
- "Total" column **left in place**, marked with an inline comment pointing at this document — see §4 for why.

---

## 2. Batch 3b — Rep Side #1 (R1, Institute tab)

### Findings (before correction)

| # | Element found in code | In client's text? | Verdict |
|---|---|---|---|
| 1 | A **new route**, `/institutes/activity`, separate from the existing `/institutes` (Institute) tab | Client: **"In the Institute tab, show..."** — names an existing screen, not a new one | **Extra placement — flagged, see §4** |
| 2 | A new **"My activity" button** on `/institutes` linking to that route | No — the client asked for content inside the tab, not a new entry point to a separate screen | **Extra — flagged, see §4** (removing it now, before the placement question is settled, would just move the violation rather than fix it) |
| 3 | "Total" (activities) column | Client lists only: institute details, follow-ups owned/pending, meetings completed, Closed count, Open count — no total | **Extra — removed** |
| 4 | Open / Closed / Follow-ups owned / Follow-ups pending / Meetings completed columns | Client: "Show how many follow-ups are currently owned/pending... the number of meetings completed... the number of activities with Closed status and the number with Open status" | **Matches — unchanged** |
| 5 | Column sorting, Date Filter | Client: "Provide column sorting... Add a Date Filter" | **Matches — unchanged** |
| 6 | Institute name is the only "institute detail" shown (no city/type/status/etc.) | Client: "Display all relevant institute details" | **Possibly under-delivering, not over — see "Open questions" below, not added to** |

### Corrections made
- `src/components/report/rep-institute-table.tsx` — removed the "Total" column (header + body cell + empty-state `colSpan` adjusted from 7 to 6).
- **Not corrected yet:** the separate route and its entry-point button. See §4 — this is the exact "how should R1 sit inside the Institute tab" ambiguity the task asked me to stop on rather than guess at, so the route and button are left exactly as they were pending your answer.

---

## 3. Batch 3b — Rep Side #7 (R7, Activity Report)

### Findings (before correction)

| # | Element found in code | Client's exact wording | Verdict |
|---|---|---|---|
| 1 | Header "Institute" | "Institute Name" | **Renamed** |
| 2 | Header "Check-in" | "Check-In Date and Time" | **Renamed** |
| 3 | Header "Check-out" | "Check-Out Date and Time" | **Renamed** |
| 4 | Header "Location" | "Location" | Matches — unchanged |
| 5 | Header "Open" | "Number of Open Status activities" | **Renamed** |
| 6 | Header "Closed" | "Number of Closed Status activities" | **Renamed** |
| 7 | Header "Total visits" | "Total Number of Visits" | **Renamed** |
| 8 | Header "Total meetings" | "Total Number of Meetings" | **Renamed** |
| 9 | Header "Total activity" | "Total activity count" | **Renamed** |
| 10 | Totals footer row labelled "All institutes" | Client only says "Show the overall totals for the report as well" — no row label specified | **Corrected to "Total"** (minimal, echoes the client's own word, necessary so the row isn't an unlabelled blank) |
| 11 | No row links anywhere a Rep cannot follow (`/review` is staff-only) | Not mentioned either way by the client | Not flagged — this is the same "don't build a dead link" constraint already applied to R1, necessary correctness rather than an added feature |

### Corrections made
- `src/components/report/institute-presence-table.tsx` — every column header renamed to the client's exact text; footer row label changed from the invented "All institutes" to "Total."

No placement issue here: Rep Side #7 says "Replace the current view" at `/report`, which is exactly where the change was made — no new route was created for R7.

---

## 4. Open questions — real choices, not guessed

### Q1. Where does R1 actually belong inside the Institute tab?
The client's words: "In the Institute tab, show a complete activity summary
for each institute... Create a single institute-wise table for the Rep."
`/institutes` today is the existing institute **registry browser** (search,
status/owner/city/type filters, a list of institutes a Rep can open). Adding
the activity-summary table there needs one of:

- **(a) A second section on the same page**, below the existing registry
  list — no new route, no new button; a Rep scrolls down `/institutes` to
  see it. Closest literal reading of "in the Institute tab, show..."
- **(b) A view toggle within the tab** (e.g., "Browse" / "Activity"), so the
  two don't have to share one scroll.
- **(c) Replace the existing registry list entirely** with the activity
  table — I don't recommend this: the client didn't ask to remove institute
  browsing/filtering, and this would be a regression, not a correction.

I have not implemented any of these. Doing so means deleting
`src/app/(app)/institutes/activity/page.tsx`, the "My activity" button on
`src/app/(app)/institutes/page.tsx`, and splicing `RepInstituteTable` into
that same page — which I'll do the moment you pick (a), (b), or something
else.

### Q2. Does Admin #1/#2's "Total" column stay or go?
Admin #2: "Ensure overall totals match the sum of the corresponding activity
counts." This could mean:
- **(a)** there must be a visible Total column on this screen, and it must
  reconcile (what's built today), or
- **(b)** the reconciliation is an internal correctness guarantee
  (`reconcileActivityCounts()`, already true regardless of any column) and no
  such column was actually requested.

Left in place for now (table + Excel) because removing a figure the client
may well want, on a guess, seemed riskier than asking. If the answer is
(b), I'll remove it from both the table and the export in one pass.

### Q3. Is "the Admin Dashboard" literal?
The client's Admin #1 text says to remove Pipeline by Rep **from the Admin
Dashboard** and show the Activity Report **on the Admin Dashboard** in its
place. Two different existing screens could be meant:
- **(a)** `/institutes/report` — the page batch 3a actually rewired, formerly
  titled "Pipeline by rep," reached by a link from the dashboard's "Go to"
  list (what's built today).
- **(b)** The literal `/` Dashboard route itself, which already embeds a
  *different*, pre-existing rep-wise table of its own ("Activity this
  month," fed by `getActivityReportModel()` — a status-column grid, not
  this batch's institute-wise one) — moving the new table there would mean
  replacing or displacing that existing card.

I have not touched either screen pending your answer, since (b) is a
materially bigger, more disruptive change than (a) and I'd rather confirm
than guess at something this structural.

### Q4. The Overview shortcut label
Batch 3a renamed a "Go to" shortcut from "Pipeline by rep" to "Activity by
institute" — my own invented phrase, not the client's. The client's own term
for this feature is "Activity Report," but that label is already used, in
the same list, by the unrelated, pre-existing `/team/report` shortcut. Two
honest options, and I haven't picked one:
- **(a)** Rename this shortcut to "Activity Report" too (matches the
  client's own words exactly, accepts that the list will show two links
  both called "Activity Report," distinguished only by where they go).
- **(b)** Keep a distinguishing word here, worded differently from my
  original "Activity by institute" if you'd rather (e.g., your own
  preferred phrasing) — still technically beyond the client's literal text,
  but legible.

---

## 5. Test results (after the corrections in §1–§3)

- Unit: all pass — no test asserted the removed columns' text or count by
  name (they test the pure functions, not the rendered tables), so nothing
  needed updating there.
- Integration: unaffected — the RLS and reconciliation tests exercise the
  model and raw queries, not these presentation components.
- Full suite: **1435 passed / 7 failed (pre-existing, `close_visit ...
  (0039)`, unrelated to anything in this audit) / 6 skipped** — identical to
  the count before this audit; nothing regressed, nothing new broke.
- Typecheck: clean. Full-repo lint: clean.

## 6. What was removed/corrected, by file

- `src/components/report/institute-activity-table.tsx` — removed 3 columns (Admin A1).
- `src/lib/exports/institute-activity-export.ts` — removed the same 3 columns from the Excel sheet.
- `src/components/report/rep-institute-table.tsx` — removed 1 column (R1's "Total").
- `src/components/report/institute-presence-table.tsx` — renamed 7 headers and 1 footer label to the client's exact wording (R7).

## 7. Confirm nothing else extra remains

Checked and left alone because they already match or are necessary,
non-client-facing plumbing:
- Sort-key vocabulary (`open_total`, `closed_total`, `total_visits`,
  `follow_ups_owned`, etc. in `institute-activity-counts.ts`) — internal
  identifiers, not displayed text; several are still legitimately in use
  (R1's remaining columns, R7's columns).
- `getInstituteActivityModel()`'s extra fields (`totalVisits`,
  `lastCheckinAt/Area`, `lastCheckoutAt/Area`) — all consumed by R7's
  columns the client did ask for; none render on Admin A1.
- The RLS integration test and unit tests added in batch 3b — internal
  verification, no user-facing surface.

Nothing beyond what's listed in §1–§4 was found. Local only; no migration
touched; no records altered; nothing pushed.

---

## 8. Follow-up — §4's open questions, resolved or further evidenced

A later instruction resolved three of the four and asked for grep evidence
on the fourth. Recorded here so this document doesn't go stale next to the
code:

- **Q1 (R1 placement).** Resolved as option (a): a new "Activity summary"
  section on `/institutes`, below the existing registry browser. The
  separate route and its button are deleted.
  **New, disclosed limitation found while wiring this in:** the pre-existing
  `InstitutesBrowser` component rebuilds the URL from scratch on every one
  of its own filter changes and does not carry this new section's
  `from`/`to`/`sort`/`dir` forward — so changing a registry filter silently
  resets the Activity Summary back to its defaults. The reverse was fixed
  (this section's own Apply/sort links now carry the registry's filters via
  `extraParams`, the same mechanism `RangeControls` already had for this).
  Not fixed in the other direction: that needs changing `InstitutesBrowser`
  itself, a shared component the admin view of this same page also uses —
  bigger than this task asked for. No existing content is removed or
  broken; the two controls just don't both survive every interaction.
- **Q2 (Admin A1's "Total" column).** Resolved: removed from the table and
  the Excel export. Reconciliation stays internal.
- **Q3 ("the Admin Dashboard").** Grepped, as asked. The literal phrase
  "Pipeline by Rep" (or "Pipeline by rep") appears exactly once in the
  entire codebase, live or in history outside this phrase's own origin: a
  comment in `src/app/(app)/institutes/report/page.tsx` referencing the
  screen batch 3a rewired. Git history confirms that screen — created in
  commit `28f18ac`, "Pipeline by rep: where every institute stands, and
  each count is a door" — is the ONLY thing ever called "Pipeline by Rep"
  in this project. The embedded card on the literal `/` Dashboard route
  ("Activity this month" / "Activity by rep this month", fed by
  `getActivityReportModel()`, a status-column grid) is a separate,
  unrelated feature with no textual connection to "Pipeline by Rep"
  anywhere in its own history. Left untouched; not moved. See the chat
  report for the full writeup of this evidence.
- **Q4 (Overview shortcut label).** Resolved: the shortcut removed
  entirely, not relabelled.
