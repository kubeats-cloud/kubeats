# Core rep flow — redesign: build plan & impact analysis

**Analysis only. No code, no migrations, nothing built.** The purpose of this
document is to say, for each of the client's seventeen changes, what it
replaces, what it collides with, what the database has to be told, and in what
order the whole thing can safely be cut — *before* any of it is written.

This redesign reaches further into the app than the twelve requests in
`docs/feedback-mapping.md` did. Those were mostly additions at the edges. These
seventeen rework the **audited core**: the meeting gate, check-in/out, the
closing report and the targets table are all four-pass-audited behaviour
(`docs/AUDIT-2026-09-findings.md`, 621 assertions), and four of the seventeen
reverse a decision that was taken on purpose and written down.

Read alongside `CLAUDE.md`, which states most of those decisions.

---

> ## ⚠ SUPERSEDED IN TWO PLACES BY THE CLIENT'S PDF SPEC
>
> This document is the analysis that produced stages 1–3, and it is accurate
> as history. Two of its conclusions were later reversed by the client's
> authoritative PDF, which wins over anything here:
>
> - **The weekly target is back, whole** — eight numbers, submit-and-lock,
>   admin reopen, achieved-vs-target. That undoes half of C1 and all of change
>   4. Change 3 (the daily target) and change 5 (monthly) **stand**: the daily
>   target really was the daily plan, and nobody asked for the month back. See
>   CLAUDE.md, "A rep commits to a week, and to nothing else".
> - **Change 14's phone is OPTIONAL and its name is REQUIRED** — the reverse of
>   the "Phone required?" note in that section. See CLAUDE.md's closing-report
>   field set.
>
> Each affected section is marked below. Nothing else in here has changed.

---

---

## Where the app actually stands

Worth stating, because two of the changes below depend on it.

- **Check-in/out is live.** Migration `0014` carries a "not yet applied" header
  from when the feature was built ahead of hosting room, but `0016`'s
  pre-flight counted live rows against `daily_plans_checkin_coords_paired`
  ("0 of 1 violate"), which it could only do if the columns were there. The
  four-pass audit also covers "check-in/out and location accuracy" against the
  live site. Treat `0001`–`0016` as applied.
- **The migration chain is forward-only** (`0016` §5). Each file is
  individually idempotent; the chain is not replayable over a migrated
  database. Every new migration below inherits that contract.
- **`log_visit()` must stay a single overload.** `0015`'s closing assertion
  fails if there is more than one, because a call then becomes ambiguous and
  *every* visit fails to save. This constrains how #16 is built — see M3.

---

## Summary

| # | Change | What it replaces | Verdict | Size | Migration |
| --- | --- | --- | --- | --- | --- |
| 1 | Hide the location step; capture silently | `CaptureFields` location block | **REWIRE** — but pulls against #6 | S | No |
| 2 | Drop the word "proof" | `log-visit-form.tsx:281` | **COPY ONLY** | XS | No |
| 3 | Daily target = institute + purpose, no numbers | `targets` period `daily` | **ALREADY DONE** as the daily plan; removes a screen | S | No |
| 4 | Weekly = read-only count of meetings done | `TargetsForm` weekly | **REWIRE** — the achieved half already exists | S | No |
| 5 | Remove Monthly | `targets` period `monthly` | **REWIRE** | XS | No |
| 6 | Location REQUIRED to check in | never-block, stated in 7 places | **REVERSES AN AUDITED RULE** | M | No (app layer) |
| 7 | One active visit at a time | nothing enforces this today | **GENUINELY NEW** | M | **Yes** (M1) |
| 8 | One visit per institute per day | `daily_plans_unique_per_day` | **MOSTLY DONE** — one real hole | S | No (app fix) |
| 9 | Check-in → auto-redirect to Log Visit | manual `/log?plan=` link | **NEW**, easy; "cannot skip" is the hard half | S–M | No |
| 10 | Next session set → follow-up date+time mandatory | Rule 5 | **CONFLICTS** with `visits_follow_up_hidden_when_scheduled` | M | **Yes** (M4) |
| 11 | No next session → follow-up not required | Rule 5 | **ALREADY TRUE** for 7 of 9 statuses | XS | Part of M4 |
| 12 | Record the meeting time | no column; `checkin_at` exists | **NEW** — probably free | S | Maybe (M5) |
| 13 | Short feedback form, drop the rich report | `closingReportSchema` + 1076-line form | **REWIRE + CONFLICTS** (mandatory fields) | **L** | No — keep the columns |
| 14 | Person met: name + phone | `visit_people` (5 cols, one NOT NULL) | **MOSTLY DONE** — one snag | S | Maybe (M6) |
| 15 | Pending becomes a read-only notice board | `/pending/[id]` files the report | **BREAKS Rule 3's Set→Done** | M | No |
| 16 | Auto-checkout on feedback submit | manual `checkOut` + two buttons | **NEW** — needs an RPC | M | **Yes** (M3) |
| 17 | Duration recorded on that checkout | `plan_visit_minutes()` | **ALREADY BUILT** | XS | No |

**Net effect on the deployment ceiling: favourable.** The redesign deletes more
client code than it adds — `closing-report-form.tsx` (1076 lines) is the largest
client component in the app and `targets-form.tsx` (249) goes for two of three
periods. Nothing here needs a new dependency. The 3072 KiB Workers free-plan
budget should end up with *more* headroom than the ~100–125 KiB it has now
(`CLAUDE.md` records 2949 KiB, `HANDOVER.md` 106 KiB spare — worth re-measuring
either way), but the "measure before adding" rule still applies to the one
genuinely new client component (the in-flow feedback form).

---

## The three consequences the brief does not state

These are not objections. They are things that follow inevitably from the
seventeen and that nobody has decided yet.

### C1 — the whole "commitment" concept disappears

#3 takes the numbers off daily, #4 makes weekly read-only, #5 deletes monthly.
Put together, **there is nothing left that a rep commits to a number for.**

That retires more than a screen. `public.targets` stops being written; and with
it `enforce_target_lock` (Rule 6 — submit, lock, admin reopen), the
`targets_insert/update/delete` policies, `TargetsForm`, `ReopenButton`, the
admin's reopen flow, `completionPercent`, and the whole "% of commitment"
header. Rule 6 is audited behaviour with five integration tests behind it, and
it would become unreachable code guarding a table nothing writes.

**This is the single biggest consequence in the redesign and it is implied
rather than asked for.** See Q1.

> **PARTLY REVERSED.** The client's PDF restored the WEEKLY commitment, so
> `public.targets` is written again, `enforce_target_lock` is reachable again,
> and `TargetsForm`, `ReopenButton` and `completionPercent` are all back. The
> daily and monthly halves stand. The one thing this section got exactly right
> is the reason it cost nothing to undo: the rule was retired from the app and
> left standing in the database, so the reversal was UI work plus a comment-only
> 0021.

### C2 — a read-only Pending breaks the Set → Done lifecycle

`/pending/[id]` is the **only** place a session or campus visit logged as "Set"
is ever closed. Make Pending actionless (#15) and a session set for next Tuesday
can never become "Done": `sessions_done` and `campus_visits_done` stop
incrementing permanently, and `openLoopsByMember()` grows without bound.

The client's own sentence — "once a visit is started it must be completed; no
lingering pending work" — describes *today's* visit correctly and says nothing
about work deliberately scheduled for a future date, which is what Rule 3's
"Set" is for. Something has to close those. The natural answer inside the new
flow: when the rep next checks in at that institute, the feedback form offers
"you set a session here on the 4th — did it happen?". See Q2.

### C3 — the feedback form has to move

#16 (auto-checkout on submit) only makes sense if the form is submitted while
the rep is still standing at the school. Today the closing report is a separate
screen at `/pending/[id]`, reached *after* the visit is saved, and check-out is
a button back on the Dashboard.

So the new flow is:

```
Dashboard → check in (location required)
          → REDIRECT to /log  (forced)
          → short feedback form, in the same screen or the next step
          → submit  →  visit saved + plan held + checked out, one transaction
          → back to Dashboard
```

`/pending/[id]` survives as the **read-only** view of a filed report (which it
already is once `reported_at` is set), and `/pending` becomes the notice board.

---

## Change by change

### 1 — remove the visible "location captured" step

**What exists.** `src/components/visits/capture-fields.tsx` renders a Location
`Label`, a full-width "Capture location" button that becomes
"Captured · 23.0225, 72.5714", the resolved area name, an accuracy badge, a
retry link, and a warning box for a poor or remembered fix. Three hidden inputs
(`latitude`, `longitude`, `accuracy`) carry the values; a mount effect already
asks for a fix without being told to.

**To build.** Delete the visible block, keep the effect and the hidden inputs.
Genuinely small — the capture is already automatic, only the reporting is
manual.

**Conflict — and it is a real one.** #6 requires blocking on location and
telling the rep how to fix it. #1 removes the only UI that says what the
location *is* and the only "Try again" affordance in the visit flow. Those pull
in opposite directions.

**Resolution (recommended).** Split by moment, because the two changes are
actually about two different screens:

- **Log Visit** — silent, per #1. By the time a rep is on this screen the
  position is already recorded on the check-in and burned into the photo stamp;
  showing it again is noise.
- **Check-in** — keeps a minimal location UI, because that is where #6's block
  lives and a block with no guidance strands people.

Nothing evidential is lost: the coordinates are stamped into the photograph
itself at the moment of attaching, which is the actual evidence, and
`visits.latitude/longitude` still get written.

**Size** S. **Migration** none. **Q:** see Q5.

---

### 2 — remove the word "proof" from the photo label

**What exists.** `log-visit-form.tsx:281` — `<FormSection title="Proof"
description="Where you were and a photograph, captured now rather than
remembered later.">`. That description also has to change, since it describes
the location step #1 removes.

Everywhere else "proof" appears is **admin-facing**: `visit-proof.tsx`,
`visit-photo.tsx` (dialog title and alt text), `review/page.tsx`, the Review
table column, `photo-flush-panel.tsx`.

**To build.** Rename the section to "Photo" and reword the description. Whether
the admin-side wording follows is Q6.

**Size** XS. **Migration** none. No conflict.

---

### 3 — daily target is institute + purpose only, no numbers

**What exists — two different things wearing one word.**

- The **daily plan** on the Dashboard already *is* institute + purpose and
  nothing else (`dailyPlanSchema` = `institute_id` + `purpose`). This is what
  the client is describing, and it is done.
- The **Targets screen** additionally offers `?period=daily`, which asks for
  eight numbers for a single day and locks them under Rule 6.

**To build.** Remove `"daily"` from `TARGET_PERIODS` in `src/lib/periods.ts`.
The period-start alignment, `periodRange`, `shiftPeriod` and `periodLabel` all
keep their daily cases — `PERIODS` still has four and the activity report still
uses daily — so this is one list entry plus the tests that assert three periods.

**Leave the database alone.** `targets_period_valid` still accepts `'daily'`;
existing daily rows stay readable. Same reasoning as `institutes_covered`.

**Size** S. **Migration** none. **Conflict:** feeds C1.

---

### 4 — weekly shows meetings done, and sets nothing

**What exists.** `/targets?period=weekly` shows a committed number beside an
achieved number for eight metrics, a completion percentage, and a submit/lock
form. The **achieved half is exactly what the client is asking for and it
already works**: `getTargets()` counts Meetings from `daily_plans` where
`meetings_actual = 1` over `periodRange('weekly', …)`, which is Rule 7.

**To build.** Render the achieved column without the committed one: no
`TargetsForm`, no percentage, no lock, no reopen. `MetricList` already takes
`achieved` separately, so this is mostly deletion.

**One decision inside it.** The client says "how many meetings were done this
week" — one number. The screen currently shows eight metrics. Showing only
Meetings discards seven working figures; showing all eight is barely more
screen. See Q3.

**Watch the week boundary.** Weeks run Monday–Saturday for display and
Monday–**Sunday** for counting (`weekEnd()` vs `weekCountEnd()`). A read-only
count must keep using `weekCountEnd()`, or every Sunday's work vanishes.

**Size** S. **Migration** none. **Conflict:** feeds C1.

> **REVERSED by the client's PDF.** The weekly screen sets numbers again. The
> two notes above still hold and are the reason the reversal was cheap: the
> achieved half was always Rule 7 and never moved, and the Monday–Sunday
> counting boundary is still `weekCountEnd()`.

---

### 5 — remove Monthly entirely

**To build.** Drop `"monthly"` from `TARGET_PERIODS`. Same shape as #3.

`REPORT_PERIODS` (`daily`, `monthly`, `yearly`) is a **different list for a
different screen** — the activity report at `/report` — and must not be touched:
the client asked to stop *committing* to a month, not to stop *reading* one.

**Size** XS. **Migration** none. **Conflict:** feeds C1.

---

### 6 — location required to check in

**This reverses a decision stated in seven places**, all of which have to change
together or they will contradict each other:

| Where | What it says today |
| --- | --- |
| `CLAUDE.md` | "the geo-tag beside it is deliberately NOT required — a denied GPS permission still saves, because a rep with no signal must not be stuck" |
| `0014` header | every coordinate column nullable, "and that is the feature rather than laziness" |
| `0015` header | "It does not, anywhere, make a poor location a reason to refuse a save" |
| `validation/checkin.ts` | `optionalCoord()` — "this is the escape valve rather than an oversight" |
| `check-buttons.tsx` | "THE LOCATION NEVER BLOCKS" |
| `validation/visit.ts` | the same judgement restated for the visit photo |
| `rules.test.ts:2339` | `it("ACCEPTS a check-in with no location at all")` |

**How to build it — and how not to.** Enforce in the **UI and the server
action**; do **not** add `NOT NULL` to `checkin_lat`/`checkin_lng`. Two reasons:
existing rows hold nulls, so the constraint would fail on application or need a
backfill of coordinates that were never recorded; and
`daily_plans_checkin_coords_paired` (0016) already guarantees the pair arrives
whole, which is the integrity half. Requiring presence is a *policy*, and policy
that may need an admin exception tomorrow does not belong in a CHECK.

The integration test above must be **rewritten, not deleted** — it should assert
that the *action* refuses, while the column stays nullable for the rows that
predate the rule.

**The part that will actually hurt.** `bestFix()` watches for up to 12 seconds.
Blocking means a rep can wait 12s and then be told no. And the app already knows
that "has a location" and "has a *good* location" are different questions:
`accuracyBand()` splits at 150 m (good) and 1000 m (network), and a 5 km Wi-Fi
fix is exactly what shipped a visit 25 km away and caused migration 0015.

Recommended shape, pending Q4:

- **No fix at all → block**, with the client's wording: "Turn on location; move
  near a window or step outside." Plus a visible "Try again".
- **A poor fix → warn, allow.** Blocking on accuracy would strand a rep in a
  staff room indefinitely, and #7 means they then cannot work anywhere else
  either.

**Combined risk with #7.** Location blocked + one-active-visit + forced log
means a rep whose GPS is broken can do *nothing at all that day*. Whatever
escape is chosen for #7 must also cover this.

**Size** M. **Migration** none. **Q4, Q5.**

---

### 7 — one active visit at a time

**What exists.** Nothing stops it. A rep can check in at three schools and leave
all three In Progress; `visitStatusOf()` reports each one independently.

**To build — migration M1.** A partial unique index:

```
unique on daily_plans (member)
  where checkin_at is not null
    and checkout_at is null
    and checkout_missing = false
```

The predicate is **character-for-character the one already in
`daily_plans_checked_in_idx`** (0014:121), which is the non-unique version of
the same question. That is a good sign: the database already models "what am I
checked into".

Plus the friendly half in the action — a second check-in should return "You are
still checked in at St. Xavier's. Check out there first", not a 23505.

**The trap.** The index is **not scoped by date**, and it must not be: a visit
left open from yesterday is exactly the thing that should block a new one. But
that means an abandoned check-in — phone died, rep walked away before filling
the form — **bricks that rep until it is cleared**.

#16 makes this rarer (submitting the form checks out automatically), but the
abandoned case survives. An escape is mandatory, and it collides with #15:

- keep `closeWithoutCheckout` (the existing valve, already tested, already
  admin-reachable) — cheapest and it works; or
- auto-close open check-ins at the Indian day rollover via `app_today()` — no
  rep action, but it needs the pg_cron slot the photo-retention job uses; or
- let a rep cancel a check-in that has no visit logged against it — clean, but
  it hands back a way to erase an arrival, which is what FO011 exists to stop.

**Recommendation:** keep `closeWithoutCheckout`, restricted to a visit from a
*previous* day (which is already how the button behaves) and moved onto the
Dashboard's blocked-check-in message rather than the Pending screen. It is the
one option that neither weakens FO011 nor needs new infrastructure.

**Size** M. **Migration** M1 — *tightening, so it goes immediately before the
code ships*, per 0014's rule. **Q7.**

---

### 8 — one visit per institute per day

**Mostly already true.** `daily_plans_unique_per_day UNIQUE (member, date,
institute_id)` has held since 0001, and `rules.test.ts:1836` asserts it — "still
refuses a second entry for the same institute on the same day". `addToDailyPlan`
upserts on that conflict so re-planning corrects the purpose instead of erroring.

**The one real hole.** `removeFromDailyPlan` (`visit-actions.ts:182`) deletes any
row where `meetings_actual is null` — **including one the rep has already checked
in to**. So: check in, remove the entry, add it again, check in again. That
defeats #8, and it also walks straight through FO011's write-once arrival time
by making a *new row* with a *new* `checkin_at`. Migration 0016 names this as the
intended escape route for a genuine mistake; under #7 and #8 it becomes a bypass.

**To build.** Add `.is("checkin_at", null)` to that delete. One line, and it
closes both holes at once. This is the highest value-to-risk item in the whole
redesign.

**The ambiguity.** #8 says "visit", and the constraint above is about *plans*.
`public.visits` itself has no per-day uniqueness, so a rep can log a meeting and
an olympiad registration at one institute on one day — which is legitimate. If
the client means one *visits row* per institute per day, that needs its own
partial unique index and it will refuse real combinations. See Q8.

**Size** S (as a plan-level rule). **Migration** none. **Protects:** FO011.

---

### 9 — check-in redirects into Log Visit

**What exists.** `checkIn` returns a `FormState` and calls `revalidatePath`; the
Dashboard then shows an "In progress" badge and a `Log` link to `/log?plan=…`.
The plumbing is all there — `/log` already accepts `?plan=`, validates it
against the open plan, and preselects it.

**To build — the easy half.** `redirect("/log?plan=…")` at the end of `checkIn`.
Note `redirect()` throws, so the existing error returns must stay reachable
ahead of it, and `CheckButton`'s inline error display still matters.

**The hard half — "cannot skip".** A redirect makes Log Visit the default path;
it does not make it the only one. A rep can hit Back, or tap any bottom-nav tab.
Truly un-skippable means: *while you have an open check-in with no visit logged
against it, every rep route bounces you to `/log`.* That is a `proxy.ts` /
layout-level guard, it costs a query on every navigation, and it is the change
most likely to trap someone (see #6 and #7). See Q9.

**Size** S for the redirect, M for the hard lock. **Migration** none.

---

### 10 & 11 — follow-up mandatory only when a next session is set

**This is the sharpest conflict in the redesign.**

Rule 5 today has two halves, and #10 contradicts the second one:

- `visits_follow_up_required_when_awaiting` (0010) — a follow-up **date is
  required** for exactly two statuses: "Pending for management approval" and
  "Invited principal for event". Both wait on someone else with nothing
  scheduled to bring them back.
- `visits_follow_up_hidden_when_scheduled` (0001) — a follow-up date and time are
  **forbidden** for "Session scheduled" and "Campus visit scheduled", because
  those already carry their own `expected_date`.

"Next session/meeting set = yes" *is* "Session scheduled". So #10 demands a
follow-up date and time for precisely the two statuses the database refuses one
for. Built as written, every such visit fails the CHECK.

**#11 is already true** for the other seven statuses: the follow-up is optional
today, and nothing needs to change for it.

**Two roads.**

- **(i) Keep the constraint, use `expected_date`.** "Next session set" writes
  `expected_date`, which is what the scheduled statuses already mean. No
  migration, no reversal. **But `expected_date` is a date with no time** — and
  the client explicitly asked for date *and* time — so this needs a new
  `expected_time` column, and the rep still ends up with two differently-named
  "when" fields depending on a status they may not think about.
- **(ii) Make follow-up the single "when next" field — recommended.** Drop
  `visits_follow_up_hidden_when_scheduled`; add a CHECK requiring
  `follow_up_date` (and, if the client wants it enforced, `follow_up_time`)
  whenever the new "next session set" flag is true. `visits.follow_up_time`
  **already exists** (0001) and `log_visit()` already carries it, so the time
  half costs nothing at the column level. This matches how the client actually
  thinks — one question, "when are you seeing them next?" — and it is the whole
  point of simplifying the form.

Road (ii) reverses an audited constraint, so it is stated here rather than
slipped in. `expected_date` keeps its separate job of driving Pending's ordering
and the Set→Done lifecycle.

**Where the flag lives.** "Next session set? yes/no" needs somewhere to be
recorded. Cheapest honest option: derive it — `follow_up_date is not null` *is*
the answer, so no column is needed and the requirement becomes "required when
the rep said yes", enforced in zod plus the existing awaiting-statuses CHECK. If
the client wants the yes/no stored explicitly (for reporting "how many visits
ended with a next meeting"), that is one boolean column. See Q10.

**Size** M. **Migration** M4 (road ii only).

---

### 12 — record the meeting time

**What exists.** No column for "when the meeting happened". What *does* exist:
`visits.created_at` (when it was saved), `visits.date` (the Indian calendar day,
from `app_today()`), and — the useful one — `daily_plans.checkin_at`, the
server-stamped arrival time that the presence guarantee already rests on.

**Recommendation: derive it from `checkin_at` and add nothing.** In the new
flow the rep checks in when the meeting starts and submits when it ends, so
`checkin_at` *is* the meeting time and `checkout_at` is its end. It is
server-stamped, so it cannot be mistyped or backdated, which a rep-entered time
cannot promise. It also costs zero fields on a form that is meant to take 30
seconds.

Add a `visits.meeting_at` column **only** if the client means a time the rep
types in — e.g. the meeting was at 11:00 but they filled the form at 13:00. See
Q11.

**Size** S (free if derived). **Migration** M5 only if typed.

---

### 13 — the short feedback form

**What it replaces.** The largest single piece of the app:

- `closingReportSchema` — 30+ fields, five always-required, six conditionally
  required, in `src/lib/validation/closing-report.ts`;
- `closing-report-form.tsx` — 1076 lines, the biggest client component;
- `submitClosingReport` — writes `visit_people` then `visits`, and closes the
  lifecycle;
- ~25 columns on `public.visits` from migrations 0005 and 0009, each with its
  own vocabulary CHECK.

**What survives, mapped to the client's seven fields:**

| Client's field | Where it already lives |
| --- | --- |
| Response note (free text) | `management_feedback` or `notes` — pick one, see Q12 |
| Institute interested? (yes/no) | **new** — nothing is a clean yes/no today |
| Management interest level | `management_interest` — exists, Low/Medium/High/Very High (0009) |
| Next session set? (yes/no) | derived or new — see #10 |
| Follow-up date + time | `follow_up_date`, `follow_up_time` — both exist |
| Person met: name + phone | `visit_people.name`, `.contact_number` — see #14 |
| Meeting time | `checkin_at` — see #12 |

So of seven fields, **five already have a home**. The work is subtraction, not
construction.

**What to do with the ~25 abandoned columns — recommendation: exactly what was
done for `institutes_covered`.** Stop collecting them, stop asking for them,
**keep the columns and keep displaying them**. Concretely:

- Do **not** drop the columns or their CHECKs. A drop is the one step here that
  cannot be undone, and 0013 set the precedent by renaming `weekly_targets`
  aside rather than dropping it.
- `report-view.tsx` already renders every field through a `row()` helper that
  **returns null for an empty value**. So a report filed last month keeps
  rendering in full, and one filed under the new form simply shows fewer rows.
  No conditional, no migration, no data loss. This is the strongest argument for
  the least-destructive path and it costs nothing.
- Reversible: re-adding a field is restoring its form control, not a migration.

**Two downstream screens go blank, and this is not obvious.** `visit_outcome`
is not only a form field:

- `admin-workspace.ts:58,125` selects it and renders it as the **Outcome column
  on the admin Review table**, and offers a reported/unreported filter beside it;
- `institutes.ts:115` selects `activities_conducted`, `visit_outcome`,
  `discussion_summary` and `follow_up_action` for the **institute timeline**.

Stop collecting them and both go permanently empty for new visits — an Outcome
column that is blank on every recent row. Those screens need the new fields
mapped in (Interested? + Management interest are the natural replacement). See
Q13. **This is the piece most likely to be missed until an admin notices.**

**The mandatory-fields conflict.** `closingReportSchema`'s `superRefine` makes
`activities_conducted`, `people`, `discussion_summary`, `visit_outcome` and
`primary_outcome` always required, plus six more conditionally. Every one of
those five is on the client's remove list. The `superRefine` is effectively
rewritten from scratch, and `tests/unit/closing-report.test.ts` (126 lines) goes
with it.

**Size** **L** — the largest item here, though most of it is deletion.
**Migration** none, deliberately.

---

### 14 — person met: name + phone

**What exists.** `public.visit_people` (0005): `name` (NOT NULL, non-empty),
`contact_type` (**NOT NULL**, one of nine), `designation`, `contact_number`
(nullable, `^[0-9]{10}$`), `is_decision_maker`. RLS: readable by the visit's
owner and admins, writable only by the owner — an admin explicitly cannot
rewrite someone's account of who they met, and there is a test for it.

**The snag.** `contact_type` is NOT NULL with a nine-value CHECK, and a
name-and-phone-only form has nothing to put in it. Three options:

- **write `'Other'` from the action** — zero migration, keeps one home for the
  fact, slightly dishonest data. **Recommended.**
- make the column nullable — small migration (M6), more honest, and it means
  old rows and new rows differ in a way queries must handle.
- move the person onto `visits` as `met_name` / `met_phone` — then
  `visit_people` is dead for new visits and "who did you meet" lives in two
  places, which is the thing this codebase consistently refuses to do.

**Phone required?** `visit_people_contact_number_valid` permits null today. The
client says the phone is "for follow-up", which implies required. Enforce in zod
and the action; **do not** add a NOT NULL CHECK — existing rows have nulls and it
would fail on application.

> **SETTLED THE OTHER WAY.** The client's PDF makes the **phone optional and the
> name required**. What shipped between this note and that one was neither: both
> were optional, with a rule that a phone had to carry a name. The "do not add a
> NOT NULL CHECK" half of this note was right and still stands — it is why
> requiring the name cost no migration.

**Simplification available.** One person means the `people` JSON field, the
add/remove row UI and the `people.0.name` error-path mapping in `fieldLabel()`
all collapse to two plain inputs.

**Size** S. **Migration** M6 only if the column goes nullable. **Q14.**

---

### 15 — Pending becomes a read-only notice board

**What exists.** `/pending` lists everything at `lifecycle_status = 'Set'`,
oldest first, red-edged when overdue, with a "File the closing report" button
that is the **only route into `/pending/[id]`**, which is the **only place a Set
visit is closed**.

**To build.** Remove the button; show status only. Admins already see the list
without actions, so the read-only rendering exists.

**But see C2.** This is the change that breaks Rule 3, and it cannot ship until
Q2 is answered. Everything else in #15 is trivial; that one question is not.

**Also worth noting:** `/pending/[id]` should stay reachable read-only. It is
where a filed report is *read*, by the rep and by admins, and `report-view.tsx`
is already the read-only half of that page.

**Size** M (S for the screen, M for the replacement closing path).
**Migration** none.

---

### 16 & 17 — auto-checkout on submit, with the duration

**#17 is already built.** `plan_visit_minutes(checkin_at, checkout_at)` (0014) is
IMMUTABLE, deliberately not stored, and mirrored by `visitMinutes()` in
`validation/checkin.ts`, with an integration test that the two agree. The moment
#16 writes `checkout_at`, the duration works — no code, no column.

**Correcting the brief on FO011.** Auto-checkout does **not** collide with the
write-once guard. `daily_plans_checkin_final` (0016) guards **`checkin_at` only**;
`checkout_at` has no such trigger. So there is no conflict to resolve there.

What #16 does collide with is smaller and fixable: the manual `checkOut` action,
the `CheckOutButton` and `CloseWithoutCheckoutButton` on the Dashboard, and the
"Held" row's rendering — the Dashboard has to stop offering a button for
something that now happens by itself.

**The real constraint — one transaction.** Submitting the feedback form would
write `visits` (the report), `daily_plans` (`checkout_at`, coordinates,
accuracy) and possibly `visit_people`. `CLAUDE.md`: *"A write that touches more
than one table goes through a Postgres function so it is one transaction."*
Today `submitClosingReport` writes two tables without an RPC, ordered so a
partial failure is recoverable — adding an irreversible checkout to that makes
the ordering argument stop working.

**Migration M3: a new `public.close_visit()` RPC.** It must be:

- **SECURITY INVOKER**, like `log_visit()` — so RLS, the meeting gate, the photo
  guard and every other trigger still apply. A DEFINER function here would
  quietly bypass the entire security model.
- **a separate function, never a parameter added to `log_visit()`.** 0015's
  closing assertion requires exactly one `log_visit` overload, and adding a
  parameter creates a second one that makes every existing call ambiguous —
  the exact bug 0015 documents at length. This is a hard constraint.
- raising its own `FO0xx` codes, mapped by code (never by message) in
  `RPC_MESSAGES`. Note FO009/FO010/FO011 are **not** in that map today and fall
  through to the generic fallback — worth fixing while in there.

**Worth adding: `guard_checkout_final` (FO012).** Once check-out is automatic and
determines a *recorded duration*, it becomes the same kind of claim as the
check-in. The audit's F-4 reasoning applies symmetrically. Cheap, and it is
easier to add now than to retrofit.

**Size** M. **Migration** M3.

---

## Conflicts register

| # | Collides with | Severity | Resolution |
| --- | --- | --- | --- |
| 6 | never-block, stated in 7 places incl. a passing test | **High** | Enforce in action + UI; keep columns nullable; rewrite the test |
| 6 | #1 removes the location UI the block needs | **High** | Split by screen — silent on Log Visit, visible at check-in |
| 6 + 7 | together they can strand a rep with no GPS all day | **High** | The #7 escape must cover the #6 block too |
| 7 | #15 "no lingering pending" vs the abandoned-check-in escape | **High** | Keep `closeWithoutCheckout` for previous-day visits |
| 8 | `removeFromDailyPlan` lets a checked-in row be deleted → bypasses FO011 | **High** | One-line fix: `.is("checkin_at", null)` |
| 10 | `visits_follow_up_hidden_when_scheduled` **forbids** what #10 requires | **High** | Road (ii): drop it, make follow-up the single "when next" |
| 13 | 5 always-required + 6 conditional fields are all on the remove list | Medium | Rewrite `superRefine`; keep the columns |
| 13 | admin Review "Outcome" column + institute timeline go blank | Medium | Map the new fields into both |
| 14 | `visit_people.contact_type` is NOT NULL, form no longer asks | Medium | Write `'Other'`, or M6 |
| 15 | Set→Done has no other closing path (C2) | **High** | Needs Q2 before it can ship |
| 16 | manual checkout UI; multi-table write needs an RPC | Medium | M3, SECURITY INVOKER, separate from `log_visit()` |
| 3/4/5 | retire Rule 6, the weekly lock and the whole targets table (C1) | **High** | Needs Q1 |
| 16 | ~~FO011 write-once~~ | **None** | FO011 guards `checkin_at` only — no conflict |

---

## Migrations

Ordered by when each may be applied. 0014's rule holds: a migration that only
**adds** may go before the code; one that **tightens** goes immediately before
the code ships, or it breaks the running app.

| Ref | For | What | When | Risk |
| --- | --- | --- | --- | --- |
| **M1** | #7 | Partial unique index on `daily_plans (member)` where checked in and not checked out. Predicate identical to `daily_plans_checked_in_idx` | **Tightening — at ship time.** Check live data for a member with two open visits first; the index fails to build otherwise | Medium |
| **M2** | #8 | *None at plan level* — `daily_plans_unique_per_day` already holds. Only if Q8 says visits-level | — | — |
| **M3** | #16, #17 | `public.close_visit()` — SECURITY INVOKER, new function (never a `log_visit()` parameter), writes the report + stamps checkout in one transaction, raises mapped `FO0xx`. Optionally `guard_checkout_final` (FO012) | **Additive — safe before the code** | Low |
| **M4** | #10, #11 | Drop `visits_follow_up_hidden_when_scheduled`; add the conditional follow-up requirement. Road (ii) only | **Loosens then tightens — at ship time.** Re-validate against live rows first | Medium |
| **M5** | #12 | `visits.meeting_at` — **only if** the client wants a typed time rather than `checkin_at` | Additive | Low |
| **M6** | #14 | `visit_people.contact_type` nullable — **only if** `'Other'` is rejected | Additive | Low |
| — | #13 | **No migration. Deliberately.** Keep all ~25 closing-report columns and their CHECKs; stop collecting and stop asking. `report-view.tsx` skips nulls already, so history keeps rendering | — | — |
| — | #3, #4, #5 | **No migration.** `public.targets` keeps its columns, its rows and `targets_period_valid`. Same precedent as `institutes_covered` | — | — |

**Every new migration must:** be individually idempotent; be checked against
live data before a CHECK or unique index is added (0016's pattern — count the
violations first); carry a closing `do $$ … raise exception` block proving it
landed; and never assume the chain can be replayed.

---

## Protect these — audited behaviour the redesign must not break

1. **Rule 2, the meeting gate.** `enforce_meeting_gate()` (0001) *and*
   `enforce_checkin_before_meeting()` / FO009 (0014) are separate triggers on
   purpose — 0014 says so explicitly, so that dropping one leaves the other
   intact. #8 and #9 touch the same rows; neither may edit or merge these.
2. **Rule 12, the photo.** Stated three times (zod, `log_visit()` FO007, the
   `visits_photo_required` CHECK) plus `visits_photo_final`/FO008 write-once.
   The new short form must never become a path that edits `photo_url`.
3. **FO011, the write-once arrival.** #8's fix must *close* the
   delete-and-re-add bypass, never weaken the trigger. It is absolute by design
   — no admin exception, no service-role exception.
4. **`log_visit()` stays one overload.** 0015's assertion fails otherwise and
   every visit stops saving. M3 is a new function.
5. **SECURITY INVOKER on anything new.** `log_visit()` runs as the caller so RLS
   and every trigger apply. A DEFINER `close_visit()` would bypass the whole
   model.
6. **RLS.** `daily_plans_update` was widened in 0014 for admin close-outs;
   `visit_people` writes stay owner-only (an admin may read but not rewrite an
   account of who was met — there is a test); `institutes_guard_owner`/FO010
   keeps `registered_by` immutable.
7. **`todayISO()` ⇄ `app_today()`.** Two halves of one definition that must move
   together. #8's "same day" and any auto-close for #7 use these, never
   `current_date` — the server is UTC and would disagree with India after
   midnight.
8. **`dates.ts` formats everything.** The new meeting-time and duration displays
   go through it, or the server and an Indian browser disagree and React
   refuses to hydrate (#418).
9. **`weekCountEnd()` for #4.** Counting to Saturday drops every Sunday.
10. **The 3072 KiB ceiling.** Measure with
    `npm run build && npx wrangler deploy --dry-run --outdir /tmp/out` before and
    after. This redesign should *free* space, which is worth confirming rather
    than assuming.

---

## Safe build order

Four waves. The first two are genuinely independent and could ship this week;
the third is one indivisible release; the fourth waits on an answer.

### Wave 0 — independent, reversible, no migration

Pure UI subtraction. Nothing in here can strand a rep, and each is separately
revertible.

- **#2** drop "proof" (XS)
- **#5** remove Monthly (XS)
- **#3** remove the Daily target screen (S)
- **#4** weekly becomes a read-only count (S)
- **#8's one-line fix** — `.is("checkin_at", null)` on `removeFromDailyPlan` (XS)

That last one is in Wave 0 on purpose: it closes an FO011 bypass that exists
*today*, independently of everything else here.

**Gate:** Q1 (does retiring the commitment concept entirely have sign-off?) must
be answered before #3/#4/#5 merge, because together they retire Rule 6.

### Wave 1 — additive database work, deployable ahead of the UI

- **M3** — `close_visit()` and `guard_checkout_final`, applied but not yet
  called. Additive, so it is safe on the live database while the current flow
  keeps running.
- Add FO009/FO010/FO011 to `RPC_MESSAGES` (they fall through to the generic
  message today).

### Wave 2a — the short form, in place

Replace the rich closing report **without moving it**. It stays at
`/pending/[id]`, check-out stays manual, the flow is unchanged.

- **#13** short form; **#14** person name + phone; **#10/#11** follow-up rules
  (with **M4**); **#12** meeting time
- Map the new fields into the admin Review Outcome column and the institute
  timeline (the blank-column problem)
- Rewrite `closing-report.test.ts` and the `superRefine`

**Why separate:** this is the largest single piece of work and it carries no
flow risk. If it regresses, the old form comes back without touching check-in.

### Wave 2b — the flow rework, ONE release

These six cannot be split. Ship any one alone and the app is in a state where a
rep can get stuck: #6 without #7's escape strands a rep with poor GPS; #7
without #16 leaves visits open forever; #9 without #16 forces a rep into a form
with no way out; #16 without the form having moved has nothing to trigger it.

- **#6** location required at check-in (with the humane messaging and retry)
- **#1** location silent on Log Visit (the other half of the split)
- **#7** one active visit — **M1**, applied immediately before deploy
- **#9** check-in → Log Visit redirect
- **#16 / #17** auto-checkout via `close_visit()`, duration free
- The feedback form moves into the visit flow (C3)
- Retire the manual `CheckOutButton`; keep `closeWithoutCheckout` as the escape
- Rewrite `rules.test.ts:2339` to assert the action refuses while the column
  stays nullable

**Rehearse M1 on a fresh database first** (the chain is forward-only), and check
live `daily_plans` for any member with two open check-ins before applying it.

### Wave 3 — Pending, once C2 is answered

- **#15** read-only notice board
- The replacement Set→Done closing path (Q2)

`/pending` cannot go actionless before its replacement exists, or Rule 3's
lifecycle stops closing.

---

## Open questions

Ordered by how much they block.

**Q1 — targets (blocks Wave 0).** #3, #4 and #5 together mean nothing is ever
committed to a number again, which retires `public.targets`, Rule 6's
submit/lock/reopen, and the admin's reopen flow. Is that intended, or should
some commitment survive somewhere?

**Q2 — closing a "Set" session (blocks Wave 3).** With Pending read-only, how
does a session scheduled for next Tuesday become "Done"? Preferred answer: the
feedback form offers it at the rep's next check-in at that institute.

**Q3 — #4's scope.** "How many meetings were done this week" — Meetings only, or
all eight metrics with their achieved figures?

**Q4 — #6's threshold.** Does a *poor* location (a 1 km+ network fix, which the
app already detects) block, or only no location at all? Recommendation: block
only on nothing, warn on poor.

**Q5 — #6's escape.** If a rep genuinely cannot get a fix — basement staff room,
no GPS on the device — what should happen? Under #6 + #7 they can do no work at
all that day.

**Q6 — #2's reach.** Rep-facing only, or does "Proof photo" in the admin Review
and dialogs change too?

**Q7 — #7's stuck visit.** Rep checks in, phone dies, never submits. Cleared by
the rep next day, auto-closed at midnight, or an admin job?

**Q8 — #8's unit.** One *plan* per institute per day (already enforced), or one
*visits row*? The second would refuse a legitimate meeting-plus-olympiad day.

**Q9 — #9's strictness.** Auto-redirect only (small, safe), or a hard lock that
bounces every other screen until the visit is logged (medium, and it can trap
someone)?

**Q10 — #10's flag.** Store "next session set?" as a real boolean column for
reporting, or derive it from `follow_up_date is not null`?

**Q11 — #12's meaning.** Is the meeting time the server-stamped check-in
(recommended, free, cannot be faked), or a time the rep types?

**Q12 — #13's response note.** Free text into `management_feedback` (a report
field) or `notes` (the visit's own field, already on the Log Visit screen)? Two
free-text boxes on a 30-second form is one too many.

**Q13 — #13's blank columns.** The admin Review "Outcome" column and the
institute timeline currently read `visit_outcome`, `activities_conducted` and
`discussion_summary`. What should they show once those stop being collected?

**Q14 — #14's contact type.** Write `'Other'` (no migration) or make the column
nullable (M6)? And is the phone number mandatory?

**Q15 — the 30-second target.** Check in (up to 12s waiting for GPS) + photo +
form. The photo capture and the location wait are the two irreducible costs. Is
30 seconds the goal for the *form*, or for the whole loop?
