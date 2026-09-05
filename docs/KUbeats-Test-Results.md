# KUbeats — Live Test Run Results

**Target:** https://kubeats.pavanstudy2012.workers.dev (live production)
**Run 1:** 4–5 September 2026 — 22 passed, 6 failed, 7 blocked, 2 partial
**Run 2 (re-test):** 5 September 2026, after the IST/hydration fix — **36 passed, 1 partial, 0 failed, 0 blocked**
**Follow-up:** 5 September 2026 — the two minor findings below were both fixed in commit `5bc4b46`,
along with a pre-existing test-ordering failure. Suite is 138/138; worker unchanged at 2949.31 KiB.
**Plan:** `docs/KUbeats-Test-Plan.xlsx` — 37 scenarios
**Method:** real browser against the deployed site. Server-enforced rules were additionally checked
directly against the database so that a rule is proven, not just its screen.

---

## Executive summary

| Result | Run 1 | Run 2 |
| --- | --- | --- |
| **Passed** | 22 | **36** |
| **Failed** | 6 | **0** |
| **Blocked** | 7 | **0** |
| Partial | 2 | **1** |
| **Total** | 37 | 37 |

**The hydration bug is fixed, and it was the single cause of every failure and block in run 1.**

Run 1's one finding that mattered was that partway through, every page stopped hydrating in the
browser — correct HTML from the server, but `Minified React error #418` (server-rendered text did
not match the client) and a permanent `Loading…` fallback with inert controls. The suspected cause
was a date rendered with `toLocaleString()`, which the server produced in UTC and the browser in
UTC+5:30, so after local midnight the two disagreed about the day.

That diagnosis was correct. Migration `0008_ist_calendar_day.sql` plus the `src/lib/dates.ts`
changes fixed it, and this re-test confirms it on the live site:

- **`app_today()` returns `2026-09-05`, exactly matching the Asia/Kolkata calendar day.** App and
  database agree on "today".
- **No React #418 anywhere.** Clean loads of `/team`, `/weekly`, `/data`, `/settings` and
  `/institutes/new` each produced **zero console messages**.
- **Every previously dead screen now renders and is genuinely interactive** — confirmation dialogs
  fire, forms submit, inline validation runs.
- **The banner that exposed the bug now reads correctly.** Run 1 showed
  `Submitted 9/5/2026, 2:15:01 AM` (US locale, `toLocaleString()`). It now reads
  **`Submitted 5 Sep 2026, 14:26.`** — the pinned IST format from `dates.ts`.

### Run 1's "separate UI gap" was the same bug

Run 1 recorded scenario 8 as a genuine UI gap: adding a planned visit with nothing selected gave no
feedback. **That was wrong** — it was the hydration failure again. With the page hydrated, the exact
expected error appears: *"Pick a registered institute for this planned visit."* There is no
separate UI gap. Nothing in run 1 needs fixing beyond what was already fixed.

### Scenario 26 upgraded from PARTIAL to PASS

Run 1 could not create the case where a **held plan entry with no separate meeting visit row** still
counts as a meeting. This run seeded exactly that, and both Weekly and Team counted it — the rule is
now proven rather than assumed.

---

## Two new findings from this run — both now FIXED

Neither blocked anything, and neither was a scenario failure. No app code was changed *during* the
verification run; both were fixed straight afterwards, on **5 September 2026**, in commit `5bc4b46`.

**1. Minor bug — the week navigator on `/team` linked to the wrong route. FIXED 5 Sep 2026.**
`WeekNavigator` hardcoded `/weekly?…`. On `/team` it is rendered without a `member`, so the
Previous/Next arrows produced `/weekly?week=…` and navigated the admin **off Team onto their own
Weekly screen**. `TeamPage` did read `searchParams.week`, so `/team?week=…` worked — it was simply
unreachable from the arrows.
**Fix:** the component now takes an optional `basePath`, still defaulting to `/weekly`, and
`/team` passes its own. A prop rather than `usePathname` so the component stays on the server and
the links keep working before any JavaScript arrives — and so it costs no bundle weight.

**2. Wording deviation — scenario 5's validation message. FIXED 5 Sep 2026.**
Registering with a blank Name was correctly blocked and nothing was created, but the message shown
was the browser's native `Please fill out this field.` bubble rather than the app's own text. The
app already had its own message — `"Enter the institute's name."` in
`src/lib/validation/institute.ts:77` — and already ran the shared `instituteSchema` in
`handleSubmit`, rendering a styled inline error for every other field; the HTML5 `required`
attribute simply stopped the submit before any of that could run.
**Fix:** `noValidate` on the `<form>` hands the decision back to `handleSubmit`. `required` stays
on the input, because it still tells assistive technology the field is mandatory and it is only the
browser's error UI being dropped. Name now errors the same way every other field on that form does.

**Also fixed at the same time — a pre-existing test-ordering failure.** Not a product bug and not
found by the scenarios, but the suite had one red test. The meeting-gate suite leaves a plan row on
`(repA, today, instituteId)` which the weekly-metrics suite later marks held and counts, so it
cannot be cleaned up; the `app_today` suite then inserted a date-defaulted row for the same rep and
institute and hit `daily_plans_unique_per_day`. That row exists to prove the database defaults the
date, and which member owns it is irrelevant to the claim, so it is now `repB`. **138/138 pass.**

**One design difference worth knowing about (not a bug):** scenario 11's plan describes adding an
unplanned institute to today's plan *from inside Log Visit*. The app does not offer that; with
Activity=Meeting and nothing open it shows *"Nothing open today"* and a button *"Add one on the
Dashboard"*. That is deliberate — `CLAUDE.md` states the Dashboard owns the daily-plan flow. The
scenario's asserted end state is still reached, and still in one `log_visit()` transaction.

---

## Results by scenario

Scenarios re-tested on **5 Sep 2026** are marked ↻.

| # | Scenario | Result | Observed |
| --- | --- | --- | --- |
| 1 | Register a School — single board, full detail | **PASS** | Saved with 2 class-11 streams and 105 class-12 students; no status badge (status=null). Boards: CBSE |
| 2 ↻ | Register a Coaching institute — multiple boards | **PASS** | Registered Bright Minds Coaching (Coaching) at Andheri, Mumbai, Maharashtra with CBSE, ICSE and State Board ticked, class 12 science = 80. Detail panel shows all three board tags together and "Class 12 · science ~80 students". Andheri was not preloaded for Mumbai, so it was added inline via "+ Add an area" and removed at cleanup. |
| 3 | PIN code auto-fills location (NEW feature) | **PASS** | PIN 380015 auto-filled Gujarat/Ahmedabad with banner "Filled Ahmedabad, Gujarat. Pick your area below."; area list came from the PIN. Manual pickers remained available. |
| 4 | Manually add an area not in the preloaded list | **PASS** | Typed "QA Satellite" via + Add an area; used immediately AND written to Ahmedabad shared list (confirmed in location_areas). Re-exercised this run by adding "Andheri" to Mumbai the same way. |
| 5 ↻ | Missing required field blocks submission | **PASS** | Filled Gujarat / Ahmedabad / Azad Society, ticked CBSE, left Name blank, pressed Register. Blocked; nothing created; every entered value retained. **Wording deviation, now FIXED 5 Sep 2026 (`5bc4b46`):** at test time the message was the browser's native "Please fill out this field." anchored to Name, because HTML5 `required` fired before the app's own validation. The form is now `noValidate`, so the shared schema runs and Name shows the styled inline "Enter the institute's name." like every other field. |
| 6 ↻ | Board — preset selections plus a custom addition | **PASS** | Ticked CBSE and ICSE, typed NIOS into "Other board" and pressed Add — appeared as a removable chip. After Register the detail panel shows three separate tags: CBSE, ICSE, NIOS. |
| 7 | Add a planned visit for today | **PASS** | Row added to Today's plan; Planned counter went 0 → 1; no follow-up field on the dashboard plan form. |
| 8 ↻ | Cannot add a planned visit without institute or purpose | **PASS** | **Run 1's FAIL was the hydration bug, not a UI gap.** With the page hydrated: Institute field red with the exact expected "Pick a registered institute for this planned visit.", Purpose field with "Choose what this visit is for.", plus a summary "Pick an institute and a purpose before adding this to today's plan." No row added. |
| 9 | Meeting blocked when nothing is selected from the plan | **PASS** | UI: "A meeting can only be logged for an institute on today's plan. Add it on the Dashboard first." DB: direct log_visit() RPC refused with FO001. Re-confirmed this run — once the day's only plan entry was held, Log Visit showed "Nothing open today". |
| 10 | Complete a meeting that's on today's plan | **PASS** | Re-confirmed this run: opened Log Visit from the plan entry (`/log?plan=…`), "Open for today" showed the entry, photo attached, saved. Visit dated 2026-09-05 with photo and real coordinates; daily_plans.meetings_actual=1. |
| 11 ↻ | Add an unplanned institute to the plan and complete it in one flow | **PASS** | **Outcome met; entry point differs from the plan.** Log Visit offers no inline add-to-plan — with Activity=Meeting it shows "Nothing open today" and "Add one on the Dashboard" (deliberate, per CLAUDE.md). Via the app's own route the asserted end state was reached exactly: daily_plans row for Bright Minds created AND meetings_actual=1, with a new meeting visit, in one log_visit() transaction. |
| 12 ↻ | Session 'Set' — follow-up section is hidden | **PASS** | Status "Set — scheduled, closes later" revealed an "Expected date" field. Setting institute status = "Session scheduled" then removed the Follow-up date/time inputs entirely, replaced by "No separate follow-up needed — the expected date above already covers this." |
| 13 ↻ | Session 'Done' — follow-up is optional | **PASS** | Session / Done / "Session done", follow-up left blank (labelled "(optional)"), photo attached, saved. DB: lifecycle_status=Done, status_set_to="Session done", follow_up_date and follow_up_time both null. Institute badge updated to "Session done". |
| 14 ↻ | 'Pending for management approval' — follow-up required | **PASS** | Step A: label changed to "Follow-up date (required)"; saving blank was blocked with "A follow-up date is required for "Pending for management approval"." plus "Please check the highlighted fields." Nothing saved. Step B: expected date 2026-09-10 and follow-up 2026-09-08 11:00 saved successfully. Badge shows "Pending for management approval" in the distinct deep-red alert colour. |
| 15 | Rich closing report — required fields for a session visit | **PASS** | Review with all fields blank was blocked with a specific list: "Person 1 — name", "What you did", "What was discussed", "How it ended". Irrelevant sections were not forced. |
| 16 | Conditional sections appear only when relevant | **PASS** | After ticking "Career guidance session" → "The session" appeared; after "Management meeting" → "Management" appeared; unticking removed them again. |
| 17 | Photo is mandatory to complete a visit | **PASS** | UI: "Photo: A photo is required to log this visit." DB: direct INSERT with no photo_url refused by visits_photo_required (23514). |
| 18 | In-app camera capture with geo + time + place stamp | **AUTOMATED-PARTIAL** | Camera opened in-page, captured, stamped and uploaded — but the stream was SYNTHETIC (canvas-backed MediaStream); this machine has no webcam and a native permission prompt cannot be driven. **Still needs a real phone.** Everything around it is now proven: this run's uploads carried a real GPS fix and the stamp read "KUbeats / 23.25782, 72.67114 / Gandhinagar, Gujarat / 5 Sep 2026, 14:16". |
| 19 | Upload existing photo — stamped with live location | **PASS** | Re-confirmed this run three times. Each upload was stamped with live coordinates, the Nominatim place name and the IST date/time, then uploaded (~14 KB). |
| 20 | Photo cannot be changed after the visit is completed | **PASS** | Rep: FO008, service role: FO008 — refused for both. |
| 21 | Rep sees the FULL captured photo (not cropped) | **PASS** | Preview renders object-fit: contain at natural 1000×700 (full frame), inside a button that opens it full size, stamp strip visible along the bottom edge. |
| 22 | Close a 'Set' session with a completion summary | **PASS** | Filed the completion summary from Pending; item left Pending and the visit is lifecycle Done with closed_at set. |
| 23 | Submit and lock a weekly commitment | **PASS** | Re-confirmed this run: "Submit commitment (final)" → confirmation "Once submitted, this week locks. You will need an admin to reopen it before you can change anything." → after confirming, banner **"Submitted 5 Sep 2026, 14:26. This commitment is locked and cannot be edited. Ask an admin if it needs to change."**, all eight inputs disabled, submit path gone. |
| 24 | A locked week stays locked (rep cannot edit) | **PASS** | Form reloads already locked with the same values, inputs disabled. DB: rep's direct UPDATE refused (23514 "This week is locked…") and self-unlock refused (42501 "Only an admin can reopen a locked week."). |
| 25 ↻ | Admin can reopen a locked week (NEW) | **PASS** | **Now works through the UI.** Team → rep → "Reopen this week" → inline confirmation → "Yes, reopen". DB after: locked=false, reopened_by=Pavan (admin), reopened_at stamped. Screen changed to "Commitment in progress" with the button gone. Rep side: "An admin reopened this week on 5 Sep 2026. Revise the numbers and submit again." with all eight inputs editable, and re-submitting locked it again. |
| 26 ↻ | Weekly Meetings counted from the plan, others from the log | **PASS** | **Upgraded from PARTIAL.** A held daily_plans row with NO separate meeting visit row was counted as Meetings achieved = 1 by both Weekly and Team — the case run 1 could not create. Other metrics came from the visit log (Sessions Done 1, Application Forms 1); an olympiad visit outside the week correctly counted 0. |
| 27 | Rep sees only their own data | **PASS** | Rep's own visits visible: true. Another user's visits visible: false. Another user's weekly rows visible: 0. |
| 28 | Rep cannot reach admin screens | **PASS** | As a rep, live: /review, /assign, /team, /data, /settings all 307 → /. Re-confirmed this run: the rep's nav shows only Dashboard, Institutes, Log Visit, Pending, Weekly. |
| 29 | Admin cannot log visits (supervisor role) | **PASS** | Admin nav omits Log Visit/Pending. Live: /log 307→/, /pending 307→/. |
| 30 | Overview shows team activity | **PASS** | Visits today/this week, Reports filed, Photos in, "Latest from the team" with rep/date/activity and Filed badges, "Out today", Open loops, and shortcuts to Assign / Team / Data. |
| 31 | Review — browse and filter all team visits | **PASS** | Re-confirmed this run: "Showing 3 of 3 visits" with working thumbnails, server-side filtering, and the read-only report showing the proof photo large and uncropped. |
| 32 | Assign a visit to a rep | **PASS** | Admin → Assign: rep, institute, purpose and date assigned; appeared in "Outstanding" as Waiting. A rep cannot assign (/assign 307). |
| 33 ↻ | Team — per-rep progress and drill-in | **PASS** | **Page now renders and hydrates — zero console messages on a clean load.** One row per rep with weekly completion: "Pavan / Admin — No commitment yet" and "QA Rerun Rep — Submitted — 13%" with a progress bar. Week range "31 Aug – 5 Sep 2026 · This week · Monday to Saturday". Drill-in opens the rep's Weekly with their eight targets, achieved values and the Reopen control. **Minor bug found, now FIXED 5 Sep 2026 (`5bc4b46`):** the week navigator linked to `/weekly?week=…` rather than `/team?week=…`, so the arrows navigated off Team. `WeekNavigator` now takes a `basePath` and Team passes its own. |
| 34 ↻ | Photo flush deletes files but keeps records | **PASS** | **Fully exercised, and as a real range test.** Three visits carried real photo files, dated 15 Aug, 1 Sep, 5 Sep. Cutoff read "visits dated 29 Aug 2026 or earlier". "Check how many" returned exactly 1 — only the pre-cutoff one. After "Delete 1": "Deleted 1 photo. The visits are all still there." Verified directly — storage 3 files → 2 (the two in-window files untouched), all three visit rows intact with coordinates, dates and photo_url. In Review the 15 Aug row now shows the **"Photo expired"** placeholder while the others keep thumbnails, and the list still reads "Showing 3 of 3 visits". |
| 35 | Institute status never changes on its own | **PASS** | Meeting logged with "Update institute status" on "No change"; the institute's status stayed null. Re-confirmed this run — status only ever changed when explicitly set (scenarios 13 and 14). |
| 36 ↻ | Admin adds a purpose; it appears for reps immediately | **PASS** | Settings → "Fee discussion" added; appeared instantly in alphabetical position with "Added "Fee discussion"." Rep side: the Dashboard daily-plan Purpose dropdown listed it and it was used for a real planned visit that was then logged. |
| 37 ↻ | Admin removes a location area | **PASS** | Settings → Locations cascaded correctly (Gujarat → "Ahmedabad · 6" → six areas with delete controls). A throwaway "QA Rerun Area" was added then removed via a named inline confirmation ("Remove QA Rerun Area?" → "Yes, remove") so no pre-existing data was destroyed. Verified back to 51 areas with Ahmedabad's original six intact. The removed area no longer appears in the registration form's cascading Area dropdown. |

---

## MUST TEST ON YOUR PHONE

The hydration bug is gone, so only genuine hardware limits remain. **The photo flush has been struck
from this list — it was fully exercised this run.**

1. **The in-app camera, on a real phone (scenario 18).** The whole path was driven on the live site,
   but the video stream was **synthetic** (a canvas-backed `MediaStream`), because this machine has
   no webcam and a native permission prompt cannot be automated. Still to confirm by hand: that the
   **rear** camera opens by default, that the OS permission prompt behaves, that switch-to-front
   works, and that a real photograph is legible once stamped.
2. **The stamp on a real photo.** This run's stamps read correctly from a real GPS fix — `KUbeats /
   23.25782, 72.67114 / Gandhinagar, Gujarat / 5 Sep 2026, 14:16`. Confirm the same on a real
   camera photo, and that the place name is roughly right for where you are standing.
3. **Real GPS outdoors, and a denial.** This run got genuine browser fixes (~127–135 m accuracy) and
   also saw the graceful failure path — "Finding your location took too long. You can still save the
   visit." Confirm outdoors, and confirm that denying permission outright still lets a visit save.
4. **Mobile layout at a true phone width.** Chrome on this machine will not size below ~500 px, so
   no screen was rendered at 390 px. Check the bottom bar, the Log Visit form and the closing report
   on your own handset.
5. **The midnight window, if you want belt and braces.** The original bug only appeared between
   00:00 and 05:30 IST. `app_today()` and `todayISO()` now agree and the app was exercised at
   ~14:00 IST. Opening the app once after local midnight would close this out definitively.

---

## Test data

Everything created for this re-test has been removed. Final state verified row by row against a
snapshot taken before the run started:

```
institutes 0 · visits 0 · daily_plans 0 · weekly_targets 0 · visit_people 0
purposes 5 · location_areas 51 · place_cache 2 · pincodes_cache 6
location_states 36 · location_cities 87
auth users 1 (purnimathakor9591@gmail.com) · profiles 1 (Pavan, admin)
storage visit-photos: 0 entries
```

Created and then deleted this run: the throwaway rep `QA Rerun Rep`
(`kubeats-qa-rerun@example.invalid`) and its profile; three institutes (`QA Rerun Public School`,
`QA Rerun Boards School`, `Bright Minds Coaching`); 7 visits and 6 photo files; 3 daily-plan rows;
1 weekly_targets row; the `Fee discussion` purpose; the `Andheri` location area; and 1 `place_cache`
row. Nothing that existed before the run was touched — the `QA Rerun Area` used to test scenario 37
was one this run created for that purpose, precisely so no pre-existing area had to be destroyed.

**Note on sessions.** Unlike run 1, this run did not mint sessions server-side; the account owner
signed in by hand for each role, so no credentials were handled by the test harness.
