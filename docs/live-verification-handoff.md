# Client changes: local verification, 22 October 2026

## Baseline and constraints

Read the entire authoritative `docs/client_changes.md` (179 lines) and the entire
`C:/Users/asus/Downloads/KUBEATS_CONTEXT.md`. The latter was absent from this checkout.
The initial checkout was `deploy-iq6-client` at 4046bd2, not the documented integration
line. Work continues on `codex/client-changes-live-verification`, based on
`fix/batch5-correction-pass` at edfce86. No merge, reset, stash, push, or deployment.
All pre-existing untracked work is preserved. One agent only.

Local app: http://127.0.0.1:3000. Supabase: 127.0.0.1:55321. Existing local Docker
containers were started without resetting the database. A full local backup was
taken before adding synthetic fixtures: `backups/local-verification/before-live-verification.dump`.
New synthetic accounts are Audit Admin, Audit Lead, Audit Alice, and Audit Bob.
Existing records were retained. Browser evidence is in `output/evidence/`.

## Phase 0: ground truth before feature changes

Statuses below distinguish observed behavior from end-to-end proof. “Partial” never
means done. Evidence comes from headless Chromium against the running local app,
not from earlier coverage reports. Browser route snapshots are `phase0-*.png`,
`detail-*.png`, and corresponding text/JSON in `output/evidence/`.

| Item | Status | Evidence |
| --- | --- | --- |
| A1 | Wrongly-built: labels; behavior partially verified | Admin landing page contains the institute Activity report with dates, sortable counts, institute/count links and Download Excel. Headings use Meeting, Session, Campus Visit, Olympiad Registration, Application Form, Admission rather than the requested names. Download parity still needs a browser/file assertion. |
| A2 | Present; end-to-end counting audit incomplete | Live saved seed rows show Gandhinagar Public School Meeting 3 Open / 1 Closed and Session 1 Open / 1 Closed in separate columns. Filter/drilldown/export reconciliation not yet fully tested; do not claim correct. |
| A3 | Missing | Live Admin Review contains visit cards only, with no Call Report / Log Visit Report identification or full submitted call report. |
| A4 | Wrongly-built: placement | Three cards appear on Admin `/pending`; the existing Follow-ups Owned page `/pending/follow-ups` has the requested list but no cards. |
| A5 | Correct in tested states | Admin Team search filters to Audit Alice while typing; unmatched input renders exact “No Rep found”. Audit Lead Team has no search. Existing controls remain. Screenshots A5-filter.png and A5-empty.png. |
| A6 | Blocked; no enablement | Audit Lead sees Alice's assigned institutes, not Bob's. Server FO033 requires rep and lead to share a campus. Cross-campus changes require explicit operator confirmation; none made. |
| A7 | Missing | Opened the existing Edit Audit Alice dialog in Settings Team. Only Name and Campus are editable; role is hidden and fixed. phase0-A7.png. |
| A8 | Wrongly-built: incomplete integration | Admin Targets shows persisted target-status names and Add. Rep Targets displays badges only; no target record/status selection uses those names. Creating vocabulary alone is not full workflow integration. |
| A9 | Missing dynamic field engine | Live Settings shows Institute statuses with three fixed checkboxes only. No configurable fields, dropdown options, required flags, or Status Management section. |
| R1 | Present; partially verified | Alice Institutes is a single sortable institute table with date inputs, details, Open/Closed, owned/pending and meetings. Alice sees her three synthetic schools, not Bob's. Complete date/count assertions outstanding. |
| R2 | Wrongly-built: same target workflow gap as A8 | Admin can open Targets and add vocabulary; Rep sees the list. No demonstrated use of a selected status on actual target data. |
| R3 | Missing automatic addition | Seeded Alice meeting follow-ups due today and yesterday; after dashboard reload, Today's plan still contains only the manually seeded session plan. Follow-ups remain in Pending and require Plan it. |
| R4 | Correct in tested form states | Alice Log Visit identifies Audit Open School and its actual current First meeting done status; status selector offers the full active Open/Closed catalogue. Screenshots phase0-log-*.png. |
| R5 | Wrongly-built: Open Next Action absent | Open First meeting done, closed Session done, and Not Interested selected live. Next Action absent for all, so Open Call/Meeting requirement fails. Cancellation/preservation not yet verified through a submitted visit. |
| R6 | Present; partially verified | Alice Pending shows Owned/Missed cards; their lists exclude Bob's task. Full record/count assertions outstanding. |
| R7 | Present; partially verified | Alice Activity report has nine requested institute columns and totals. Its synthetic open plan shows check-in and visit count. Completed-visit/count/date assertions outstanding. |
| IQ1 | Missing | Opened Admin institute details and list. No Delete option or confirmation. |
| IQ2 | Blocked | Client has not defined Foot Mapping fields. No implementation or invented fields. |
| IQ3 | Present; partially verified | Admin institute details has representative reassignment control. End-to-end owner transfer and history assertion outstanding. |
| IQ4 | Missing | Admin Team report has generic activity Excel; no field-visit date-range download with the five required columns. |
| IQ5 | Present backend; end-to-end unverified | Not Interested is selectable as Closed; no Next Action shown. Cancellation/preservation still requires submitted-visit proof. |
| IQ6 | Present; end-to-end unverified | Login includes Forgot Password? and request/reset pages exist in this integration baseline. Local mailbox/link/password/login lifecycle not yet tested. |

## Remaining work

Finish Phase 0's end-to-end assertions before calling partially verified items correct.
Phase 1 corrections identified: A1 names, A4 placement, R5 Open Next Action;
A8/R2 workflow integration requires completing the existing target workflow.
Then follow the requested order: A5 verification, A7, IQ1, IQ4, A3, R3, A9.
Each completed feature needs live screenshots appended to the growing evidence PDF
and a separate local commit. No feature implementation has yet been changed.

## Completed: A4 placement correction and A5 verification
A4 cards now appear at the top of the existing Follow-ups Owned page, removed from Admin Pending. Rep Pending is unchanged. Live Chromium asserts 7 Owned / 3 Missed / 0 Closed against local saved task records and matching list lengths, including exact requested columns. Typecheck passed. No schema change or DOWN needed.
A5 was verified without rewriting existing implementation: live filtering and exact empty state, Admin-only.
Evidence PDF: output/pdf/kubeats_feature_evidence.pdf (A5: pages 1-2; A4: pages 3-5).


## Completed: A1 label correction
The existing institute report and its Excel now share the exact names Meetings, Sessions, Campus Visits, Olympiad Registrations, Applications, Admissions. No columns/routes/buttons added. Chromium downloaded the 20 October filtered workbook; XML parsing verified every data cell against the rendered table and checked all headings. Evidence PDF page 6. No schema change.


## Completed: R5 Open Next Action correction; IQ5 live verification
Log Visit and recovery forms show exact Next Action / Call / Meeting for Open statuses and hide it for Closed statuses. Reused the existing Follow-up Date; removed the formerly hidden extra Due/note controls instead of adding unrequested fields. The global Phase A flag remains off.
Chromium captured a synthetic camera frame, uploaded it, saved an Open report with Call and verified its saved task. A second captured visit was saved as Not Interested; all task IDs and the prior visit remained, tasks were cancelled, and active Owned list excluded the school. No schema changes. Evidence PDF pages 7-9.
Existing cancellation SQL still deletes future unstarted plan rows (0046); this preservation issue needs an additive cancellation mechanism before R5 can be claimed fully compliant with the all-records constraint. The tested fixture had no such future plan rows.
Full test run: 1489 passed, 6 skipped, 2 stale flag tests failed; updated those obsolete expectations for the required status-driven visibility. Focused rerun and typecheck passed.


## Completed: R5/IQ5 record-preserving plan cancellation
Migration 0047 replaces the existing future-plan DELETE with cancelled_at timestamps. Active plan readers/counts ignore cancelled rows; a server trigger prevents checking in to or clearing cancellation on a cancelled plan. All existing plan IDs remain. No institute/visit/task deletion.
Tested UP on local only; synthetic today/future plans remained after Not Interested; check-in was rejected. DOWN executed successfully inside a rolled-back transaction and preserved the cancellation history. DOWN intentionally retains the additive column to avoid losing historical timestamps; restores prior trigger behavior. No remote migration applied.
PDF page 10 documents active-list result. This supersedes the preservation limitation above.


## Completed: A7 existing Team Edit role dropdown
Added Role (Rep / Team Lead) inside the existing Name/Campus Edit dialog; no separate button or form. Existing Name/Campus controls retained. Migration 0048 adds an Admin-only atomic edit RPC, retains FO033, detaches obsolete current team links on role changes, and never removes activity/history rows. Outstanding reports must be finished before changing the role.
Live Chromium saved Rep to Team Lead and back, verified profile values, dashboard/nav changes and restricted Settings/Log Visit access. A Rep calling the RPC directly received 42501. Compared every existing ID in institutes, visits, plans, tasks and status history before/after. DOWN was executed and checked in a rolled-back local transaction. Typecheck and 81 Settings tests passed after updating obsolete no-role-edit expectations.
PDF pages 11-14. No remote application or push.


## Completed: IQ1 soft-delete institute
Admin institute details now has Delete with confirmation and Cancel. Migration 0049 adds deleted_at plus an Admin-only RPC; cancels open tasks/unstarted plans without removing rows; refuses deletion during an active visit; rejects new work for deleted institutes. Registry/pickers/Pending omit deleted institutes. Direct institute history and full reports remain readable; no RLS visibility was widened.
Live confirmation Cancel kept the institute active; confirmed Delete hid it from Admin and Rep active lists. Full saved report and visit/status history remained readable. Checked all pre-existing IDs across five history tables. Rep RPC and direct deletion-column update refused; new plan insertion refused. DOWN executed/checked in a rolled-back local transaction, retaining deletion history. Typecheck passed.
Also exercised IQ3 existing reassignment from Alice to Bob and back through the live control, checking saved owner IDs. Full cross-account visibility transfer still requires a dedicated assertion.
PDF pages 15-18. No remote changes.


## Completed: IQ4 downloadable field-visit report
Admin's existing Team report date controls now drive Download Field Visit Report. Reused the existing export endpoint with report=field-visits, no new page/route. Excel has exactly Institution Name, Check-In Date, Check-In Time, Check-Out Time, Location; one row per actual check-in, IST date bounds, actual recorded position, no totals/extra columns. Pagination avoids a 1000-row truncation; deleted-institute visits remain included as history.
Live Chromium changed the date range and downloaded Excel. Parsed workbook XML checked exact headings/column count, selected check-in dates and both saved visits for the soft-deleted institute. Inverted dates returned 400; Rep and Team Lead returned 403. Typecheck passed. No schema change.
PDF pages 19-20; final page is a faithful HTML rendering of cells extracted from the actual downloaded workbook, not an app table.


## Completed: A3 saved Call Reports in Admin Review
The documented integration baseline lacked the existing call-report columns/RPC found on deploy-iq6-client. Reviewed and ported that saved-call representation as migration 0050, retaining the original follow_up_tasks row as the only report record. No duplicate reports/visits and no new route. The existing call list now opens a report dialog; shared status-driven fields are reused. Review displays Call Report alongside labelled Log Visit Report entries; complete Call Report opens using the existing Review detail route. Existing date/Rep/institute/status filters apply; RLS scopes access.
Live Bob submitted a report with status, date, headcount, topic, taken-by and notes. Admin saw both report labels and opened all submitted details. Task and visit IDs/counts remained identical. An unrelated Team Lead saw Page not found and no report data. DOWN ran in a rolled-back transaction and retained the saved report. Typecheck and 37 focused tests passed. PDF pages 21-23.

