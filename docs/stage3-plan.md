# Stage 3 — the core-flow rework: implementation plan & migration design

**Plan only. No code, no migration.** Stage 3 is the interlocking one: it
reverses two rules the four-pass audit signed off, adds two new hard
constraints, replaces the closing report, and rewires check-out. Stages 1 and 2
could be reverted a file at a time. This one cannot, so the design goes first.

Read alongside `docs/flow-redesign-plan.md` (the whole redesign) and `CLAUDE.md`.

---

## 1. What the live database says — and it changes the design

Three constraints in the obvious design **cannot be built** against production
as it stands. This was checked before the design was written, following 0016's
precedent of counting violations first.

| Probe | Result | Consequence |
| --- | --- | --- |
| Visits duplicated on `(member, date, institute_id)` | **1 pair** — `olympiad` + `meeting`, AMIT, 2026-09-09, sumit | A `UNIQUE` index for #8 **fails to build** |
| Checked-in plans with NULL coordinates | **1 of 2** — the row closed by the escape valve | A CHECK requiring "coords or manual" for #6 **fails to build** |
| Members with >1 open check-in | **0** (1 open check-in total) | #7's partial unique index **builds cleanly** |
| `visit_people` rows | **0** | Nothing is stranded by moving the person met onto `visits` |
| `visits` columns | 43, and **no `daily_plan_id`** | Nothing links a visit to the check-in it came from |

**The design consequence is the single most important decision in this plan:**

> **#6 and #8 are enforced by TRIGGERS, not by CHECK constraints or unique
> indexes. #7 is enforced by a partial unique index.**

That is not a stylistic split. A CHECK or a unique index is validated against
every existing row when it is added, so both would fail on live data. A trigger
fires only on the rows it is given, so history is left exactly as it is and the
new rule starts the moment it is installed — which is what "this rule starts
now" actually means. It is also what 0014 did for the presence guarantee, for
the same reason.

#7 gets an index because it *can* have one, and because "two people racing to
check in" is a genuine concurrency question that a trigger cannot settle.

---

## 2. What Stage 3 reverses, and what it must not break

### Reversed on purpose (both audited)

| Rule | Where it is stated | What replaces it |
| --- | --- | --- |
| **Location never blocks** | `CLAUDE.md`, 0014 and 0015 headers, `validation/checkin.ts`, `check-buttons.tsx`, and the passing test `rules.test.ts:2339` "ACCEPTS a check-in with no location at all" | Location blocks, **with a logged override** — reason recorded, flagged, visible to admins |
| **Follow-up forbidden on the two "scheduled" statuses** (`visits_follow_up_hidden_when_scheduled`, 0001) | 0001, mirrored in `FOLLOW_UP_HIDDEN_FOR` | Follow-up **required** whenever the visit stays open |

The second is the sharper reversal: the constraint currently *forbids* exactly
what the new rule *requires*. Built without touching it, every "next session
set" visit fails its CHECK.

### Must not break (verified, not assumed)

1. **Rule 2, the meeting gate** — `enforce_meeting_gate` (0001) and
   `enforce_checkin_before_meeting`/FO009 (0014) are separate triggers by
   design. Neither may be edited or merged; if FO009's scope widens (see Q1)
   that is a new trigger or a widened predicate, never a rewrite of the gate.
2. **Rule 12, the photo** — zod + `log_visit()` FO007 + `visits_photo_required`,
   plus `visits_photo_final`/FO008 write-once. The new feedback form must never
   become a path that writes `photo_url`.
3. **FO011, write-once arrival** — `daily_plans_checkin_final`, absolute, no
   admin or service-role exception. Auto-check-out does **not** touch it (see
   §4.6), and #8's fix must *close* the delete-and-re-add bypass rather than
   weaken it.
4. **One `log_visit()` overload** — 0015's assertion fails otherwise and every
   visit stops saving. New behaviour goes in a **new** function.
5. **SECURITY INVOKER** on anything new, so RLS and every trigger still apply.
6. **RLS** — `visits_update` is `member = auth.uid()`, which is what lets a rep
   close their own earlier "Set" row (§4.5) and is *also* why an admin cannot.
7. **`todayISO()` ⇄ `app_today()`** — #8's "same day" uses these, never
   `current_date`.

---

## 3. Migration 0018 — full design

One migration, applied **immediately before deploy**. It both loosens and
tightens, so it cannot go early: the loosened follow-up rule would let bad rows
in ahead of the code, and the tightened check-in rule would reject the current
app's check-ins.

### 3.1 New columns

| Table | Column | Type | Why |
| --- | --- | --- | --- |
| `daily_plans` | `checkin_location_manual` | `boolean not null default false` | #6 — this check-in's position was asserted, not measured |
| `daily_plans` | `checkin_manual_reason` | `text` | #6 — the rep's words, shown to admins |
| `visits` | `daily_plan_id` | `uuid references daily_plans(id) on delete set null` | The visit's own link to the check-in it came from. Today nothing joins them; `log_visit()` takes `p_daily_plan_id` and **does not store it**. Needed by auto-check-out, by "meeting time = check-in time", and to stop three-column joins |
| `visits` | `closes_visit_id` | `uuid references visits(id) on delete set null` | Q2 — which earlier "Set" this visit completed |
| `visits` | `session_taken_by` | `text` | "taken by", the one genuinely new session field |
| `visits` | `met_name` | `text` | Person met — see Q5 |
| `visits` | `met_phone` | `text` | Person met — see Q5 |

Everything nullable except the boolean, which defaults. Nothing rejects an
existing row.

**Reused rather than added:** `students_attended` (session *and* campus-visit
head count — 0009 already shares it), `session_topic`, `management_interest`
(already `Low/Medium/High/Very High`), `follow_up_date`, `follow_up_time`,
`notes`, `expected_date`, `closed_at`.

### 3.2 New CHECKs (only where they can build)

```
daily_plans_manual_reason_present
  checkin_location_manual = false
  OR (checkin_manual_reason is not null and length(btrim(checkin_manual_reason)) > 0)
```
Builds cleanly: every existing row has the column at its `false` default.

```
visits_met_phone_valid
  met_phone is null or met_phone ~ '^[0-9]{10}$'
```
Mirrors `visit_people_contact_number_valid`. Builds cleanly — column is new.

**Deliberately NOT added:** a CHECK requiring coordinates-or-manual on
`daily_plans`. One live row (the escape-valve row) has `checkin_at` with NULL
coordinates and would fail it. That rule lives in `enforce_checkin_located()`
below instead, which only sees new check-ins.

### 3.3 Constraint to REPLACE — the follow-up reversal

```
drop  visits_follow_up_hidden_when_scheduled          -- 0001, now false
keep  visits_follow_up_required_when_awaiting         -- 0010, still true
add   visits_follow_up_required_when_open
        status_set_to is null
        OR status_set_to not in (<the five OPEN statuses>)
        OR (follow_up_date is not null and follow_up_time is not null)
```

The five OPEN statuses are named **literally**, not via
`institute_status_category()` — that function is `stable` and reads
`public.institute_statuses`, so it cannot appear in a CHECK. This is exactly the
duplication 0010 §5 accepted and then guarded, so 0018 carries **the same
assertion block**: read `pg_get_constraintdef` back and compare it against the
lookup table, failing the migration if the app's OPEN set and the constraint's
list ever disagree.

`visits_follow_up_required_when_awaiting` becomes a strict subset of the new
rule (both its statuses are OPEN) and is kept rather than folded in, so that
dropping the new one cannot silently lose the old guarantee.

**Existing rows:** all 3 live visits carry `status_set_to` values that either
are closed or already have a follow-up; to be verified as a counted query
immediately before applying, 0016-style.

### 3.4 New triggers

**`enforce_checkin_located()` — #6, raises `FO012`**
`before update of checkin_at on daily_plans`, firing only on the
`null → not null` transition. Refuses when both coordinates are null *and*
`checkin_location_manual` is false. Historical rows are never re-examined, which
is the whole reason this is a trigger.

**`enforce_one_open_visit()` — #7's friendly half, raises `FO013`**
Same transition. Refuses when the member already has another plan row with
`checkin_at not null and checkout_at is null and checkout_missing = false`.
The index in §3.5 is the actual guarantee; this exists to name the institute the
rep is still checked into.

**`enforce_one_visit_per_institute_per_day()` — #8, raises `FO014`**
`before insert on visits`. Refuses when the member already has a visit at that
institute on `public.app_today()`. INSERT-only, so the live duplicate pair
(olympiad + meeting at AMIT) is left untouched and legal — see Q2/Q3.

**`guard_checkout_final()` — optional, raises `FO015`**
`before update of checkout_at on daily_plans`. Once check-out is automatic and
determines a recorded duration, it is the same kind of claim as the arrival, and
the audit's F-4 reasoning applies symmetrically. It does **not** interfere with
the escape valve, which sets `checkout_missing` and never `checkout_at`.

### 3.5 New index — #7's guarantee

```
create unique index daily_plans_one_open_visit
  on public.daily_plans (member)
  where checkin_at is not null and checkout_at is null and checkout_missing = false;
```

The predicate is character-for-character the one already in
`daily_plans_checked_in_idx` (0014:121). **Verified buildable**: 0 members
currently hold more than one open check-in.

Deliberately **not** scoped by date — a visit left open from yesterday is
exactly what should block a new one. That is also why the escape valve must
survive; see Q6.

### 3.6 `visit_people` — left alone

0 rows. Not dropped, not altered, not written. The person met moves to
`visits.met_name` / `met_phone`. This **changes the recommendation in
`flow-redesign-plan.md` §14**, which assumed rows existed and proposed writing
`contact_type = 'Other'`; with the table empty there is nothing to preserve and
no reason to keep a second table, an extra statement in the RPC, and a NOT NULL
column the form no longer answers.

### 3.7 What is NOT touched

`public.targets` (dormant, 0017) · `weekly_targets_pre_0013` · every rich-report
column and its vocabulary CHECK · `enforce_meeting_gate` · `visits_photo_*` ·
`daily_plans_checkin_final` · `institutes_guard_owner` · every RLS policy.

---

## 4. Change by change

### 4.1 (#6) Location required, with a logged override

**Today.** `checkIn` accepts whatever `bestFix()` produced, including nothing.
`CheckButton` is explicitly "THE LOCATION NEVER BLOCKS".

**New.** GPS succeeds → check in silently, as now. GPS fails → the normal
button is refused and an override appears: a required free-text reason, then
"Check in without location". That check-in stores
`checkin_location_manual = true` and the reason.

**Files.** `check-buttons.tsx` (the override UI and its two-state button),
`checkin-actions.ts` (refuse the un-located, accept the declared),
`validation/checkin.ts` (`optionalCoord` gains a conditional requirement plus a
reason field), `visit-proof.tsx` / `visit-review.tsx` / `activity-summary.tsx`
(surface the flag to admins), `errors.ts`/`RPC_MESSAGES` (FO012).

**Conflict.** Reverses the never-block rule in seven places (§2). The
integration test `rules.test.ts:2339` must be **rewritten, not deleted**: the
column stays nullable, so the assertion becomes "a bare check-in with no
coordinates and no declared reason is refused, and one with a reason is
accepted".

**Verification.** New integration tests: bare check-in refused (FO012);
declared check-in accepted and flagged; a *pre-existing* un-located row still
updatable (proving the trigger did not retro-apply). Manual: deny the browser
permission and confirm the override path.

**Open:** Q4 — does a poor-but-present fix count as success?

### 4.2 (#7) One active visit at a time

**Today.** Nothing prevents it.

**New.** Index + trigger (§3.4, §3.5). The Dashboard hides "Check in" on every
other entry while one is open, and says which institute is holding it.

**Files.** `checkin-actions.ts`, `daily-plan.tsx`, `visits.ts` (the plan query
already returns the check-in columns), `RPC_MESSAGES` (FO013).

**Conflict.** With #15 (Pending read-only): an abandoned check-in — phone dies,
rep walks away — bricks that rep entirely. #16 makes it rarer but not
impossible. **The escape valve must survive**, and live data agrees: of two
check-ins ever recorded, **zero** have a real check-out and **one** was closed
by the valve. See Q6.

**Verification.** Integration: second check-in refused while one is open;
accepted after check-out; accepted after the valve closes the first. The index
build itself is verified by the pre-flight count.

### 4.3 (#8) One visit per institute per day

**Partly there already.** `daily_plans_unique_per_day UNIQUE (member, date,
institute_id)` has held since 0001 and has a test (`rules.test.ts:1836`). What
is missing is the same rule on `visits`, which today permits the live
olympiad + meeting pair.

**Two holes to close.**

1. **`removeFromDailyPlan`** (`visit-actions.ts:182`) deletes any row where
   `meetings_actual is null` — *including one already checked in*. Check in,
   remove, re-add, check in again defeats #8 **and** walks through FO011's
   write-once arrival by creating a fresh row. Fix: add `.is("checkin_at", null)`.
   One line, and it is the highest value-to-risk item in the stage.
2. **`visits` has no per-day rule.** Closed by `enforce_one_visit_per_institute_per_day()`.

**Overrides reopen-closed, as instructed.** A closed institute may still be
re-planned on a *later* day (`rules.test.ts:1815` stays true); it simply cannot
be visited twice in one day. The reopen tests that assert a same-day second
visit — if any — will need revising; the same-day *plan* test already asserts
refusal and is unaffected.

**Open:** Q3 — one visits *row*, or one check-in *cycle*?

### 4.4 (#9) Check-in redirects into a pre-filled Log Visit

**Today.** `checkIn` returns a `FormState`; the Dashboard then shows a `Log`
link to `/log?plan=`. All the plumbing exists.

**New.** `redirect("/log?plan=…")` at the end of `checkIn` (note `redirect()`
throws, so the error returns must stay reachable ahead of it). `/log` reads the
plan row and **pre-fills institute and purpose**, both read-only — the rep
chose them at planning time and re-asking invites a second, disagreeing answer.

**Purpose → activity.** The plan's purpose is free-ish text from the admin list
("Fix a session", "Complete a campus visit"). Mapping it to one of the six
activity keys is a real piece of design, not a lookup — see Q7.

**"Cannot skip"** is the harder half. A redirect makes Log Visit the default,
not the only, path. A true lock — every rep route bounces to `/log` while a
check-in has no visit — is a `proxy.ts` change costing a query per navigation,
and it is the change most likely to trap someone. Recommended: redirect now,
plus a persistent Dashboard banner; hard lock only if asked. See Q8.

### 4.5 (Q2) How a "Set" becomes "Done"

**Today.** One row flips: `submitClosingReport` sets `lifecycle_status='Done'`
and `closed_at` on the *same* visit. `CLAUDE.md` notes the consequence — the
credit moves to *the week the Set was originally logged*.

**New, and it is a better model.** The completing visit is its **own row**:

```
Row A  week 1   session, Set,  expected_date = 2026-09-22
Row B  week 3   session, Done, closes_visit_id = A
                → A.closed_at stamped, A.lifecycle_status left as 'Set'
```

Both writes happen in one transaction inside the RPC.

Why leave A as `Set`: Rule 7 counts by `activity` + `lifecycle_status` over
`date`. Leaving A alone means **week 1 keeps its "Sessions Set" and week 3 earns
its "Sessions Done"** — each week credited for what actually happened in it.
Flipping A instead would move the Done credit back into week 1 *and* let B count
as a second Done. This is a deliberate change to the sentence in `CLAUDE.md`
about a closed loop moving weeks, and that paragraph must be rewritten with it.

**Pending therefore changes its query** from `lifecycle_status = 'Set'` to
`lifecycle_status = 'Set' AND closed_at IS NULL`, in `getPendingVisits()` **and**
`openLoopsByMember()` — miss the second and the Dashboard's "open loops" tile
never comes down.

**Matching is by (member, institute, still open)**, newest first, and only ever
offered — never automatic. The form asks "you set a session here on the 4th —
did it happen?" so a rep who is closing a *different* loop is not silently
credited with the wrong one.

**Open:** Q9 — what closes a Set the rep never returns to?

### 4.6 (#16, #17) Auto-check-out and duration

**#17 is already built.** `plan_visit_minutes(checkin_at, checkout_at)` (0014)
is IMMUTABLE, deliberately unstored, and mirrored by `visitMinutes()`. The
moment #16 writes `checkout_at`, duration works with no new code.

**FO011 is not in the way.** `daily_plans_checkin_final` guards **`checkin_at`
only**; `checkout_at` has no write-once trigger today. The premise that these
collide is wrong, and the real constraint is different: submitting the feedback
form writes `visits` **and** `daily_plans`, and `CLAUDE.md` requires a Postgres
function for that. `submitClosingReport` writes two tables today without one,
ordered so a partial failure is recoverable — adding an irreversible check-out
breaks that argument.

**So: `public.close_visit()`, a NEW function.** SECURITY INVOKER, never a
parameter added to `log_visit()` (0015's overload assertion). In one
transaction: write the feedback fields on the visit; stamp `closed_at`/
`closes_visit_id` if it completes an earlier Set; stamp `checkout_at` +
coordinates + accuracy on the plan row. Raises mapped `FO0xx`.

**Retire** `CheckOutButton` from the Dashboard; **keep**
`CloseWithoutCheckoutButton` (see Q6).

**Meeting time** is `daily_plans.checkin_at`, surfaced through
`visits.daily_plan_id` — server-stamped, so it cannot be mistyped or backdated,
and it costs no field on a 30-second form.

### 4.7 (#13/#14) The short feedback form

**Replaces** `closingReportSchema` (30+ fields, five always-required, six
conditional), `closing-report-form.tsx` (1076 lines, the largest client
component in the app), and `submitClosingReport`.

| New field | Home |
| --- | --- |
| Response note | `notes` — already on the visit; see Q10 |
| Institute interested? (yes/no) | **new** — needs a column or a mapping; see Q10 |
| Management interest level | `management_interest` (exists, 0009) |
| Next session set? (yes/no) | derived from `follow_up_date is not null` |
| Follow-up date + time | `follow_up_date`, `follow_up_time` (exist) |
| Person met: name + phone | `met_name`, `met_phone` (new) |
| Meeting time | `daily_plans.checkin_at` (derived) |
| session done → students, topic, taken by | `students_attended`, `session_topic`, `session_taken_by` (one new) |
| campus visit done → students visited | `students_attended` (0009 already shares it) |

**Retired but kept** (stop collecting, stop showing on the form, keep the
columns and their CHECKs): `activities_conducted`, `student_response`,
`student_interest`, `students_reached`, `most_interested_programs`,
`student_intent`, `management_response`, `discussion_summary`, `visit_outcome`,
`primary_outcome`, `applications_collected`, `admissions_generated`,
`session_class`, `session_streams`, `session_duration_mins`,
`session_participation`, `student_questions`, `other_faculty_*`,
`follow_up_action`, `employee_remarks`.

`report-view.tsx` renders every field through a helper that **returns null for
an empty value**, so an old report keeps rendering in full and a new one simply
shows fewer rows. No migration, no data loss, fully reversible.

**On "relax the old mandatory constraints" — the honest finding.** Almost every
rich-report CHECK is *vocabulary-only* (`X is null OR X in (…)`) and already
permits null, so it cannot reject a simple submission. The real blockers are
exactly three, and only one is a surprise:

1. `visits_follow_up_hidden_when_scheduled` — replaced (§3.3). **This is the
   one that would actually break the new form.**
2. `visit_people.contact_type NOT NULL` — sidestepped by not writing the table.
3. The mandatory rules in `closingReportSchema`'s `superRefine` — application
   code, deleted with the schema.

**Two screens go blank and need remapping** (easy to miss): `visit_outcome`
feeds the admin Review "Outcome" column and its reported/unreported filter
(`admin-workspace.ts:58,125`), and `activities_conducted` / `visit_outcome` /
`discussion_summary` feed the institute timeline (`institutes.ts:115`). Both
should show *Interested? + Management interest* instead.

### 4.8 (#15) Pending becomes read-only

Remove the "File the closing report" button; keep `/pending/[id]` reachable as
the **read-only** view of a filed report, which `report-view.tsx` already is.
The list query gains `closed_at is null` (§4.5). Closing now happens through
the flow.

### 4.9 `/team` vs `/report` — recommendation

**Keep both; do not merge.** They answer different questions, in the way
`/review` and `/report` already do (a list that also tried to be a summary
"would page at fifty rows and quietly under-report every total").

- `/team` — **all reps, one week, one row each.** A roster: who is out, who is
  quiet, who has open loops. Its value is the *comparison down the column*, which
  a per-rep report cannot show.
- `/report` — **one rep, over months.** A drill-down.

They only look alike because Stage 2 stripped Team's percentages. The fix is a
sentence and a link, not a merge: keep Team as the roster and give each row a
direct link to that rep's report alongside the existing link to their week.
Merging would delete the only cross-person view in the app.

---

## 5. Conflicts register

| # | Conflict | Severity | Resolution |
| --- | --- | --- | --- |
| 6 | Reverses never-block, stated in 7 places incl. a passing test | **High** | Trigger (not CHECK); rewrite the test; keep columns nullable |
| 6 | A CHECK for it cannot build — 1 live row has no coords | **High** | Trigger fires only on new check-ins |
| 6+7 | Together they can strand a rep with no GPS | **High** | The override *is* the escape; Q4 sets the threshold |
| 7 | Abandoned check-in bricks the rep; #15 removes actions | **High** | Keep `closeWithoutCheckout`; Q6 |
| 8 | A UNIQUE index cannot build — 1 live duplicate pair | **High** | Trigger, INSERT-only; history left legal |
| 8 | `removeFromDailyPlan` deletes checked-in rows → FO011 bypass | **High** | `.is("checkin_at", null)` |
| 8 | Overrides reopen-closed | Medium | Same-day only; later-day reopen still works |
| 10 | `visits_follow_up_hidden_when_scheduled` forbids what the new rule requires | **High** | Drop and replace (§3.3) |
| Q2 | Two rows for one session would double-count Rule 7 | **High** | Leave A as `Set`, stamp `closed_at`; each week keeps its own credit |
| Q2 | Pending/open-loops read `lifecycle_status='Set'` | **High** | Both gain `closed_at is null` |
| 16 | Multi-table write | Medium | `close_visit()` RPC, INVOKER, separate from `log_visit()` |
| 16 | ~~FO011 write-once~~ | **None** | FO011 guards `checkin_at` only |
| 13 | Review "Outcome" + institute timeline go blank | Medium | Remap to Interested? / Management interest |

---

## 6. Build order within the stage

Nothing here ships alone — the whole stage is one release. This is the order to
*write and review* it in, each step leaving the tree green.

**Step 0 — the free win, separately reviewable.**
`removeFromDailyPlan` gains `.is("checkin_at", null)`. Closes a live FO011
bypass that exists today, independent of everything else.

**Step 1 — migration 0018, written and rehearsed on a fresh database.**
Columns, the two CHECKs, the follow-up replacement + its assertion block, four
triggers, one partial unique index. Not applied to production yet.

**Step 2 — the data layer, no UI.**
`close_visit()` RPC; `visits.ts` queries gain `closed_at is null`;
`visit-actions.ts` maps FO012–FO015; `visits.daily_plan_id` written by
`log_visit()`'s caller.

**Step 3 — check-in.** #6 override UI, #7 blocking + messaging, #9 redirect.

**Step 4 — Log Visit + the short form.** Pre-fill, status/date rules, the new
schema, the Set→Done offer, auto-check-out on submit.

**Step 5 — the screens that read it.** Pending read-only; Review and institute
timeline remapping; admin surfacing of the manual-location flag; Team's report
link.

**Step 6 — tests, docs, size.** Rewrite `rules.test.ts:2339`; new suites per
§7; update `CLAUDE.md` (the never-block rule, the Set→Done week paragraph, Rule
5's follow-up rules); measure.

**Deploy:** apply 0018, then deploy, in that order and close together. 0018
both loosens and tightens, so neither direction is safe to leave open long.

---

## 7. How each guard is verified

Every audited rule gets a test that would fail if Stage 3 broke it — the point
is to prove the guards still hold, not merely to test the new behaviour.

| Guard | Test |
| --- | --- |
| Meeting gate (Rule 2) | Existing suite must pass untouched; add "still refuses a meeting with no plan row" after #8's trigger exists |
| Presence guarantee FO009 | Existing suite untouched; if Q1 widens it, add one case per newly covered activity |
| Rule 12 photo | Existing suite untouched; add "the feedback form cannot change `photo_url`" (expect FO008) |
| FO011 write-once | Existing behaviour; **add** "a checked-in plan row cannot be deleted", closing the bypass |
| FO012 located | Bare check-in refused; declared accepted; **a pre-existing un-located row still updatable** |
| FO013 one open | Second refused; accepted after check-out; accepted after the valve |
| FO014 once per day | Second visit refused; next day accepted; **the live duplicate pair still readable and still legal** |
| Follow-up reversal | Open status without date+time refused; with them accepted; the two awaiting statuses still refused without a date; assertion block proves the CHECK matches the lookup table |
| Rule 7 counting | Set in week 1 + Done in week 3 ⟹ one Set in w1, one Done in w3, **never two Dones** |
| RLS | Rep cannot close another rep's Set row; admin cannot rewrite a feedback form |
| `close_visit()` | Is INVOKER; a rep calling it for someone else's visit is refused |
| `log_visit()` | Still exactly one overload (0015's assertion) |

---

## 8. Size

Current: **2825.64 KiB gzipped of 3072** — about **246 KiB** spare.

| | Δ |
| --- | --- |
| Delete `closing-report-form.tsx` (1076 lines, largest client component) | **−20 to −30 KiB** |
| New short feedback form (~250 lines) | +5 to +8 KiB |
| Check-in override UI | +2 to +3 KiB |
| Log Visit pre-fill and status rules | +1 to +2 KiB |
| **Net estimate** | **−10 to −20 KiB** |

**Ceiling risk: low, and the stage probably buys room back.** No new
dependency is needed for anything here. To be measured before and after rather
than trusted — that is what the stale 2949 figure taught.

---

## 9. Open questions

**Q1 — does check-in become mandatory for *every* activity?** Today FO009
covers meetings only; sessions, campus visits and the one-shot activities are
exempt because "they do not run off the daily plan". The new flow implies every
visit starts with a check-in. Widening FO009 is a real change to an audited
trigger and has a deploy-ordering hazard: tighten it before the UI forces
check-in everywhere and logging breaks. **Recommend widening**, because #8 and
"meeting time = check-in time" both assume a plan row exists for every visit.

**Q2 — the live duplicate.** sumit logged `olympiad` + `meeting` at AMIT on
2026-09-09. The trigger design leaves it legal and readable. Confirm that is
what you want, rather than cleaning the data and enforcing with an index.

**Q3 — what is "one visit"?** One `visits` row, or one check-in cycle? The row
rule refuses a legitimate meeting-plus-olympiad day — which is exactly the pair
already in your data.

**Q4 — #6's threshold.** Does a poor-but-present fix (the app already detects
network fixes ≥1000 m, which is what put a visit 25 km away and caused 0015)
count as success and check in silently, or trigger the override? **Recommend:
block only on *no* fix; warn on a poor one.**

**Q5 — person met.** Columns on `visits` (recommended — `visit_people` has 0
rows, so nothing is stranded and the RPC keeps one statement) or keep
`visit_people` with `contact_type` made nullable? This reverses the
recommendation in `flow-redesign-plan.md` §14, which assumed rows existed.

**Q6 — the abandoned check-in.** With #7, an open check-in blocks the rep
everywhere. Keep `closeWithoutCheckout` (recommended — of two check-ins ever
recorded, one was closed by it and none by a real check-out), auto-close at the
Indian day rollover, or let a rep cancel a check-in with no visit?

**Q7 — purpose → activity.** The plan's purpose is admin-managed text ("Fix a
session", "Complete a campus visit"). What maps it to one of the six activity
keys — a convention on the label, a new column on `purposes`, or does the rep
still pick the activity with the purpose shown beside it?

**Q8 — how un-skippable?** Redirect plus a persistent banner (recommended), or
a hard `proxy.ts` lock that bounces every rep route until the visit is logged?

**Q9 — a Set nobody returns to.** Row A sits in Pending for ever if the rep
never revisits. Expire it after its `expected_date` passes by some margin, let
an admin close it, or leave it visible as a genuine open loop?

**Q10 — "Institute interested?" and the response note.** Interested is a clean
yes/no that nothing currently stores — a new boolean column, or read it off
`management_interest`? And should the response note reuse `notes` (already on
the Log Visit screen) or `management_feedback`? Two free-text boxes on a
30-second form is one too many.
