# Client feedback — mapping analysis

**Analysis only. No code, no migrations, nothing built.** The purpose of this
document is to say, for each of the client's twelve requests, whether it is
something the app already does, something already built under a different name,
something genuinely new, or something that contradicts a decision taken on
purpose — *before* any of it is estimated or built.

Read alongside `CLAUDE.md`, which states most of the deliberate decisions the
requests brush against.

---

## The twelve requests

The feedback is one paragraph per topic; several paragraphs carry more than one
request. Split into the smallest testable units, there are twelve.

| # | Request |
| --- | --- |
| R1 | Remove "total institutes covered" from the weekly target tab |
| R2 | A daily meeting target is set as *institute + purpose of meeting* |
| R3 | The institute picker shows only that rep's own registered institutes |
| R4 | "Purpose of meeting" is a fixed seven-value list, with free text under *Other* |
| R5 | Every meeting on the daily target opens in Log Visit and stays open until closed |
| R6 | A first meeting is closed by a follow-up date |
| R7 | Session done is closed on completion, capturing number of students, session taken by, topic, total number of students |
| R8 | Campus visit done is closed only by the number of students who visited campus |
| R9 | Log Visit's *Activity* dropdown is driven by the daily-target purpose |
| R10 | A new *Event* option in the target tab: event type, event date, event venue |
| R11 | Events appear on the admin dashboard as a calendar of who is busy with what |
| R12 | Pending lists every visit not yet closed; Log Visit closes them by status |

---

## Summary table

| # | What exists today | Verdict | Size | Migration |
| --- | --- | --- | --- | --- |
| R1 | `institutes_covered` — the ninth metric, added on purpose by migration 0013 | **RENAME-OR-REWIRE** (reverses a recent deliberate addition) | Small | No (leave the column) |
| R2 | `dailyPlanSchema` = `institute_id` + `purpose`; `DailyPlan` on the Dashboard | **ALREADY DONE** | None | No |
| R3 | Shared registry: `institutes_select` is `using (true)`; `registered_by` exists but filters nothing | **CONFLICTS** with a documented, re-audited decision | Small as a filter / Large as a model change | No / Yes |
| R4 | `public.purposes` — an admin-managed list, seeded with five values, editable in Settings | **RENAME-OR-REWIRE + CONFLICTS** (kills the admin panel; collides with the status vocabulary) | Small–Medium | Yes, if purposes gain a stable key |
| R5 | "Open for today" in Log Visit is exactly the unheld plan rows | **HALF ALREADY DONE, HALF GENUINELY NEW** (carry-over past today is new) | Medium | Yes |
| R6 | Rule 5 already forces a follow-up date for two statuses; a meeting has no close state at all | **GENUINELY NEW** | Small–Medium | Yes |
| R7 | `students_attended`, `session_topic`, `students_reached` all exist and two are already required | **MOSTLY ALREADY DONE** — only "session taken by" is new | Small | Yes (one column) |
| R8 | `students_attended` exists but is discarded for a campus visit | **GENUINELY NEW** (a real gap) | Small | Yes (one column) |
| R9 | `activity` is a fixed six-value list, independent of the plan's purpose | **RENAME-OR-REWIRE + CONFLICTS** (three metrics become unreachable) | Medium–Large | Probably yes |
| R10 | Three of the nine institute statuses are *about* an event; no event object exists | **GENUINELY NEW** (complements, does not duplicate) | Medium | Yes (new table) |
| R11 | No calendar anywhere in the app | **GENUINELY NEW** | Large | No (an index, maybe) |
| R12 | Pending = `visits.lifecycle_status = 'Set'`; open/closed is already a property of every status | **PART ALREADY DONE, PART NEW** | Medium | Depends on R5/R6 |

---

## R1 — remove "total institutes covered"

**What exists.** `institutes_covered` is a real, working metric. It is:

- a column on `public.targets` (migration 0013), carried by
  `targets_non_negative`;
- the ninth entry in `METRICS` in `src/lib/validation/weekly.ts`, with
  `source: "distinct-institutes"`;
- computed in `src/lib/targets.ts:106` as
  `new Set(visits.map(v => v.institute_id)).size`;
- asserted in four test files (`tests/unit/periods.test.ts`,
  `tests/unit/weekly-metrics.test.ts`, `tests/unit/validation.test.ts`,
  `tests/integration/rules.test.ts`).

**Verdict: RENAME-OR-REWIRE, and it reverses a recent deliberate addition.**
Migration 0013's own header says it "adds `institutes_covered`, a ninth metric
the other eight cannot express: it is a count of DISTINCT institutes, not a
count of rows." Someone asked for it not long ago. That does not make removing
it wrong — it makes it worth confirming that the client means the metric, not
its placement.

**To build.** Small. Drop the `METRICS` entry, the `institutes_covered: count`
line from `targetsSchema`, and the assignment in `achievedFrom()`; update the
four test files. **Leave the database column alone** — it defaults to 0, it
breaks nothing, and dropping it would need a migration to earn back a column
that might be asked for again.

**Questions for the client.**

- **Q1.** The screen is now *Targets*, covering daily, weekly and monthly.
  Should "Institutes Covered" disappear from all three periods, or only from
  the weekly view?
- **Q2.** Remove the metric entirely, or keep counting it and simply stop
  asking the rep to commit to a number for it?

---

## R2 — a daily meeting target is institute + purpose

**Verdict: ALREADY DONE.** This is exactly what the Dashboard does today.

`dailyPlanSchema` in `src/lib/validation/visit.ts` is two fields:
`institute_id` (a uuid) and `purpose` (text).
`src/components/dashboard/daily-plan.tsx` renders precisely that pair — an
institute select and a purpose select — and `addToDailyPlan` writes the row.
`CLAUDE.md` states it as ownership: "On the Dashboard a rep adds today's planned
visits (institute + purpose from the admin-managed purposes list)."

**Nothing to build.** The client may be describing this because they have not
seen the Dashboard flow, or because they expect it on the *Targets* tab rather
than the Dashboard.

**Question for the client.**

- **Q3.** The client calls this "Daily meeting, in the Target tab". Today it
  lives on the Dashboard, and that placement is load-bearing (see below). Is
  the request to *move* the daily-plan flow onto the Targets tab, or simply a
  description of behaviour they want, which already exists?

Moving it is not cosmetic: `CLAUDE.md` says "The Dashboard owns the daily-plan
create-and-track flow. There is no Daily tab", because the meeting gate checks
a visit against `daily_plans` rows, so a meeting cannot be logged unless the
Dashboard flow put it on the plan first. Moving the *form* is possible; moving
the *concept* to Targets would sit it beside a table (`public.targets`) that
holds integer counters and nothing else.

---

## R3 — the institute dropdown shows only that rep's registered institutes

**What exists.** The institute registry is **shared by design, and that design
has been re-affirmed twice**:

- migration 0001, on the RLS policy: *"institutes — A shared registry: everyone
  reads and contributes, only admins remove"*, with `institutes_select` set to
  `using (true)`;
- `institutes.registered_by` exists (defaults to `auth.uid()`, and the insert
  policy requires it to be the caller) — but **nothing filters on it**.
  `listInstitutesForPicker()` in `src/lib/visits.ts:29` selects every row with
  no member filter at all;
- migration 0016 §3, four commits ago, fixing audit finding N-1:
  *"`institutes_update` is `using (true) with check (true)`, which is
  deliberate: the institute list is a shared registry… So the registry stays
  open — names, contacts and status are still editable by any rep, exactly as
  before — and this one column stops moving."*

**Verdict: CONFLICTS with a deliberate decision.**

**The clash, plainly.** Today two reps can work the same school: one registers
it, either logs a visit, either sets its status, and
`institute_status_history` records the journey across both of them. Filtering
the picker by `registered_by` makes the school invisible to the second rep —
they can still *see* it on the Institutes tab (RLS still returns it) but cannot
plan a visit to it. Three concrete consequences:

1. **Admin assignment breaks half-way.** `/assign` puts a `daily_plans` row on a
   rep's day for *any* institute. That row would still show in their "Open for
   today" list, but the same rep could not re-plan the same school themselves
   the next day. The picker and the assignment would disagree about what a rep
   is allowed to visit.
2. **A rep leaving orphans their schools.** `registered_by` is
   `on delete set null`. Delete a profile and every school they registered has
   `registered_by = null`, so it appears in *nobody's* picker. Migration 0016
   deliberately kept an admin able to correct `registered_by` for exactly this
   case — but only an admin, and only one row at a time.
3. **A second rep cannot cover for the first.** Which is what a shared registry
   is for.

**To build.** Two very different sizes, depending on what the client means:

- *Just the picker* — add `.eq("registered_by", user.id)` to
  `listInstitutesForPicker()`. **Small, no migration**, RLS unchanged, and every
  consequence above still applies.
- *A real ownership model* — an institute belongs to a rep, RLS enforces it,
  admins reassign. **Large, needs a migration**, and it touches Assign, Review,
  the admin Institutes screen, `institute_status_history` attribution, and the
  0016 owner guard.

**Questions for the client.**

- **Q4.** Does "registered institutes of that particular user" mean *the rep who
  first created the record* (`registered_by`, which exists), or *the rep the
  school is assigned to* (which does not exist — today only individual visits
  are assigned, not institutes)?
- **Q5.** When two reps work the same school — a colleague covering a territory,
  or a handover — should the second rep be able to plan a visit to it? If yes,
  this is a filter with an "all institutes" escape hatch, not an ownership
  model.
- **Q6.** What should happen to a rep's schools when they leave the team?

---

## R4 — "purpose of meeting" as a fixed seven-value list

**What exists.** Three separate vocabularies, and the request touches all three.

**1. The purposes list** — `public.purposes`, an **admin-managed** flat table,
seeded in 0001 with five values, edited at Settings → *Meeting purposes*
(`src/components/settings/purposes-panel.tsx`). Stored on a plan as text, so
retiring an option does not rewrite history.

**2. The nine institute statuses** — `INSTITUTE_STATUS_CATALOGUE`, each carrying
an open/closed category, mirrored by `public.institute_statuses`.

**3. The six activities** — `ACTIVITIES`, two of which carry a Set → Done
lifecycle.

Here is how the client's seven land against all three:

| Requested purpose | Existing purpose (0001 seed) | Existing institute status | Existing activity + lifecycle |
| --- | --- | --- | --- |
| First meeting | — | **First meeting done** (open) | `meeting` |
| Session set | **Fix a session** | **Session scheduled** (open) | `session` / Set |
| Session done | **Complete a session** | **Session done** (closed) | `session` / Done |
| Campus visit set | **Fix a campus visit** | **Campus visit scheduled** (open) | `campus_visit` / Set |
| Campus visit done | **Complete a campus visit** | **Campus visit done** (closed) | `campus_visit` / Done |
| Follow up meet | — | — (`Follow-up discussion` is a closing-report activity) | `meeting` |
| Other | **Other** | — | — |

**Verdict: RENAME-OR-REWIRE of the existing purposes list, plus two conflicts.**

**Answering overlap (a) directly:** the requested values are **the same concept
as the existing purposes list**, five of the seven near-verbatim ("Fix a
session" → "Session set"). They are **not** the institute statuses — a purpose
is the *intent* recorded before the visit, a status is the *outcome* recorded
after — but the client has chosen wording that is almost identical to the
status vocabulary, which is the problem.

**Clash 1 — three things would share one name.** After this change, "Session
done" would be a purpose, an institute status, *and* (as `sessions_done`) one of
the target metrics. Three different tables, three different meanings, one
phrase. A rep asking "why does it say Session done twice" is a support call, and
a developer asking "which one does this query mean" is a defect.

**Clash 2 — the admin panel dies.** `public.purposes` exists so an admin can
add or retire a purpose without a deploy. Hard-coding seven values makes the
Settings panel a list that shows things nobody can pick, which is worse than
removing it. Either the panel goes, or the seven values are simply *re-seeded*
into the existing table and the list stays admin-managed.

**Free text under *Other* is nearly free.** `daily_plans.purpose` is already
`text not null`, and `dailyPlanSchema` already validates it as free text up to
120 characters. Only the UI restricts it to the list. Storing the typed words in
that same column needs **no migration**.

**To build.** Small if the seven values are re-seeded into `public.purposes` and
the *Other* field writes free text into the existing column — **no migration**.
Medium and **needs a migration** if the purposes need a stable machine key (a
`purposes.key` column), which R9 below effectively requires: deriving an
activity from a free-text label by string-matching is the kind of thing that
breaks the first time someone edits a label.

**Questions for the client.**

- **Q7.** Should the purposes list stay admin-editable in Settings (re-seeded
  with the seven values), or become fixed in code so nobody can change it?
- **Q8.** "Session done" would then name a purpose, a status and a metric.
  Are different words acceptable for the purpose — e.g. "Complete a session",
  which is what it is called today?
- **Q9.** The three activities with no purpose in the list — Olympiad
  Registration, Application Form, Admission — are three of the target metrics.
  Should they get purposes too, or are they never planned in advance? (See R9;
  this is the same question from the other end.)

---

## R5 — meetings stay open in Log Visit until closed

**What exists — and this is half the request already working.** Log Visit's
"Open for today" panel is built from `openPlan`, which is exactly the daily-plan
entries with `meetings_actual IS NULL` — the ones not yet held. A meeting can
*only* be logged by picking one of them (`log-visit-form.tsx`: "A meeting's
institute is whichever plan row was picked — never free-form"). So "all meetings
will be opened in the Log Visit tab whatever is set in daily target"
**already happens**.

**What is genuinely new: "until it is closed".** Today the answer is "until the
end of the day". Three places hard-code today, and they must agree:

| Where | What it says |
| --- | --- |
| `getTodayPlan()` — `src/lib/visits.ts` | `.eq("date", todayISO())` |
| `log_visit()` — migration 0002 | `and dp.date = v_today` |
| `enforce_meeting_gate()` — migration 0001 | `and dp.date = new.date` |

An unheld plan entry from yesterday is invisible today, and the gate would
refuse it even if it were visible. Carry-over is a real change to the meeting
gate, which `CLAUDE.md` names as one of the load-bearing rules.

**Verdict: HALF ALREADY DONE, HALF GENUINELY NEW.**

**The conflict to settle first.** The gate exists so a logged meeting is
evidence that a rep was at a named school on a named day. If Monday's unheld
entry can be logged on Wednesday, the visit's date (Wednesday) and the plan's
date (Monday) diverge — and **Rule 7 counts the Meetings metric from
`daily_plans.date`**, so a meeting held on Wednesday would score in Monday's
week. That is a reporting change, not just a UI one.

**To build.** Medium, and it **needs a migration** — both `log_visit()` and
`enforce_meeting_gate()` change, and the gate is the app's most safety-critical
trigger. Also: `daily_plans` is unique on `(member, date, institute_id)`, so a
carried-over entry cannot simply be re-dated onto a day that already has one for
the same school.

**Questions for the client.**

- **Q10.** How long does an unheld plan entry stay open — forever, or until some
  cut-off? A rep with fifty stale entries has a list they cannot use.
- **Q11.** If Monday's planned meeting is actually held on Wednesday, which week
  should it count towards — the week it was planned or the week it happened?
- **Q12.** Should a rep be able to cancel a planned meeting that never happened,
  rather than leaving it open forever?

---

## R6 — a first meeting is closed by a follow-up date

**What exists.** Two things, neither of which is quite this.

1. **Rule 5 already forces a follow-up date — for two statuses only.**
   `FOLLOW_UP_REQUIRED_FOR` in `src/lib/validation/visit.ts` is
   `["Pending for management approval", "Invited principal for event"]`, backed
   by the `visits_follow_up_required_when_awaiting` CHECK. "First meeting done"
   is not one of them, deliberately: `CLAUDE.md` explains that those two alone
   "wait on someone else's answer with nothing scheduled to bring them back".
2. **A meeting has no close state at all.** `visits.closed_at` is stamped only
   by the closing report, and only when `lifecycle_status` is non-null — which a
   meeting's never is. Migration 0006 says it outright: *"a meeting never gets
   `closed_at` — it is complete the moment it is logged"*, and the
   `visits_photo_final` rule was written the way it was **because** of that.

**Verdict: GENUINELY NEW.** Giving a meeting an open/closed life is a new
concept, and it is the request that most changes the model.

**To build.** Small–medium, and it **needs a migration**. The narrow version —
add "First meeting done" to `FOLLOW_UP_REQUIRED_FOR` and to the CHECK — is a
well-trodden change: migration 0010 renamed that exact constraint when it grew
from one status to two, and `CLAUDE.md` records that the two halves must move
together. The broad version — a meeting that is *open* until a follow-up lands
— is new columns and new state.

**Question for the client.**

- **Q13.** Does "closed by a follow-up date" mean (i) the rep must enter a
  follow-up date before the first meeting can be saved, or (ii) the meeting
  stays open in Pending until a *later* visit actually happens on that date?
  These are very different features: (i) is one validation rule; (ii) is a new
  lifecycle plus everything in R12.

---

## R7 — what session-done asks at closing

**What exists — most of it.** The rich closing report (migrations 0005 and 0009,
`src/lib/validation/closing-report.ts`) already asks:

| Requested | Existing field | Status today |
| --- | --- | --- |
| number of students | `students_attended` | Exists; **already required** when a session activity is ticked |
| topic of session | `session_topic` | Exists; **already required** likewise |
| total number of students | `students_reached` *(probably — see Q14)* | Exists, optional, described as "distinct from `students_attended`" |
| session taken by | — | **Nothing.** `other_faculty_present` records who *else* was there, not who delivered |

Beside them, already captured: `session_class`, `session_streams`,
`session_duration_mins`, `other_faculty_count`, `session_participation`,
`student_questions`.

**Answering overlap (b) for sessions: yes, three of the four are already
captured, and two are already mandatory.** Only "session taken by" is new.

**Verdict: MOSTLY ALREADY DONE.**

**The bigger question hiding in this request.** The existing closing report has
about thirty fields and five that are *always* required — at least one activity
conducted, at least one person met, a discussion summary, a visit outcome and a
primary outcome — plus the conditional session block. The client describes a
close with four questions. **That reads like a replacement, not an addition.**
If it is a replacement, this is not a small change: it is deleting a feature
that was built to a spec and is enforced by CHECK constraints in 0005 and 0009.

**To build.** Small — one column for "session taken by" plus a form field —
**needs a migration**. Large if the intent is to replace the report.

**Questions for the client.**

- **Q14.** "Number of students" and "total number of students" — what is the
  difference? Two readings: (i) students who attended vs. the school's total
  strength for that class (which the app already stores as
  `institutes.class12` per stream), or (ii) attended vs. reached, which is
  `students_attended` / `students_reached` and already exists.
- **Q15.** "Session taken by" — a free-text name, a pick from the reps on the
  team, or the school's own faculty? (If it is always the logging rep, the app
  already knows: `visits.member`.)
- **Q16.** **The important one.** Are these four questions *added to* the
  existing closing report, or do they *replace* it? The existing report asks for
  people met, discussion summary, outcome and primary outcome on every filed
  report.

---

## R8 — campus visit done, closed by the number of students who visited

**What exists — and this is a genuine gap.** `students_attended` exists as a
column, but `src/lib/closing-actions.ts:132` writes it as:

```ts
students_attended: session ? input.students_attended : null,
```

where `session = hasSession(input.activities_conducted)` — true only for
"Career guidance session" or "Seminar or workshop". **"Campus visit" is not one
of them.** So a campus-visit report that captured a student count would have it
thrown away on save. The same applies to `students_reached`.

**Answering overlap (b) for campus visits: no, this is not captured today.**
The column exists but is deliberately session-scoped, so the number has nowhere
to live.

**Verdict: GENUINELY NEW.**

**To build.** Small. Two shapes:

- Widen the session gate so a campus visit keeps `students_attended` — **no
  migration**, but then one column means two different things depending on the
  activity, which makes every later report query ask "which kind of student
  count is this?"
- A separate `campus_students_visited` column — **needs a migration**, and keeps
  the two counts distinguishable in reporting. Recommended.

**The conflict, plainly.** "Closed **only** by taking information about number
of students" says a campus visit needs one question to close. Today it needs the
whole report: five always-required fields plus at least one person met. That is
a deliberate design — 0005's header explains that the report asks for what
happened and then "insists only on the parts that follow from it" — but "only
one question" would strip four required fields from an activity that currently
has them.

**Question for the client.**

- **Q17.** Does "closed only by" mean the student count is the *only* question
  asked for a campus visit — dropping the people met, the discussion summary and
  the outcome — or that it is the one *additional* question that must be
  answered before a campus visit can be marked done?

---

## R9 — the Activity dropdown driven by the daily-target purpose

**What exists.** Today they are independent. `ACTIVITIES` is a fixed list of six
in `src/lib/validation/visit.ts`, rendered as a free choice in
`log-visit-form.tsx`. The plan's purpose is shown on the "Open for today" card
as a subtitle and does nothing else. A rep can plan "Fix a session" and log a
Meeting; nothing objects.

**Verdict: RENAME-OR-REWIRE, and it is the most structural request in the set.**

The seven requested purposes map almost perfectly onto (activity, lifecycle)
pairs — see the table under R4. That is not a coincidence: the client has
re-derived the activity vocabulary as a purpose vocabulary. Wiring one to the
other is coherent and would remove the "planned a session, logged a meeting"
mismatch.

**Two conflicts.**

**1. Three metrics become unreachable.** Olympiad Registration, Application Form
and Admission have no purpose in the client's list — and all three are target
metrics (`olympiad`, `application`, `admission`) with their own columns on
`public.targets` and their own rows on the Targets screen. If Activity is
restricted to what the plan's purpose implies, a rep can no longer log any of
the three, and three committed targets can never be achieved.

**2. It extends the meeting gate to everything.** Today **only** meetings are
gated by the plan (`enforce_meeting_gate` checks `new.activity = 'meeting'`).
Sessions, campus visits, olympiad registrations, application forms and
admissions can be logged against any registered institute with no plan row at
all — which is what lets a rep record something that came up unplanned.
Deriving Activity from the plan makes the plan mandatory for everything. That
may well be what the client wants, but it is a much larger change than the
sentence suggests, and it interacts with R5: an unplanned school would need a
plan entry created on the spot.

**To build.** Medium–large, and probably **needs a migration** — reliably
mapping a purpose to an activity means a stable key on `public.purposes`
(see Q7), not string-matching an editable label.

**Questions for the client.**

- **Q18.** How does a rep log an Olympiad registration, an application form or
  an admission if Activity comes from the plan's purpose? Add purposes for
  them, or keep those three as a free choice?
- **Q19.** What happens when something unplanned comes up — a school visited on
  the way past, a session that materialised on the day? Today that is logged
  freely; under this change it would need a plan entry first.
- **Q20.** Should the purpose *lock* the activity (rep cannot change it) or
  merely *default* it (pre-selected, still changeable)?

---

## R10 — an Event option in the target tab

**What exists — and answering overlap (d).** Three of the nine institute
statuses are about an event:

- **Invited principal for event** (open) — and Rule 5 already forces a follow-up
  date on it, because it waits on someone else's answer;
- **RSVP received** (closed);
- **Will not come** (closed).

`ACTIVITIES_CONDUCTED` in the closing report also offers "Seminar or workshop".

**They do not duplicate the request — they presuppose it.** The three statuses
record an institute's *relationship to* an event: we invited them, they said
yes, they said no. **The event itself does not exist anywhere in the app.** No
type, no date, no venue, no table, no row. A rep can record "Invited principal
for event" and nothing in the system can say which event.

**Verdict: GENUINELY NEW, and it completes something already half-built.**

**The structural clash.** "One more option in the target tab" does not fit
`public.targets`. That table is nine integer counters keyed by
`(member, period, period_start)`, with `targets_period_start_aligned`,
`targets_non_negative` and the `enforce_target_lock` trigger. An event has a
type, a date and a venue — none of which is a number, and none of which belongs
in a row that gets *locked* when a rep submits their week. This is a new table
that a Targets sub-view happens to link to, not a tenth column.

**To build.** Medium, **needs a migration**: a new `public.events` table (type,
date, venue, owner, timestamps), its RLS policies and grants written out
explicitly (0001's blanket grant cannot reach a table created later — the same
note appears in 0011, 0012 and 0013), and a form. Navigation is fine as asked:
`CLAUDE.md` allows a screen that earns its place off the bottom bar, and an
Event view under Targets is one tap deep, like `/data` and `/report`.

**Questions for the client.**

- **Q21.** Should an event link to the institutes invited to it — so
  "Invited principal for event", "RSVP received" and "Will not come" say *which*
  event, and an admin can see who is coming? That is the natural completion of
  the three statuses, but the client did not ask for it.
- **Q22.** Who owns an event — the rep who created it, or the whole team? Can
  two reps both be working the same fair?
- **Q23.** Is an event a *plan* (something coming up) or a *record* (something
  that happened)? Does it get closed, and if so, with what?

---

## R11 — an admin calendar of who is busy with what

**What exists.** **Nothing.** There is no calendar anywhere in the app — a
search for one turns up only lucide icon names (`CalendarRangeIcon` on a stat
tile, `CalendarClockIcon` on the Assign screen). The admin Overview is
deliberately plain: *"No charts. A team of twenty produces a number small enough
to read as a number, and a sparkline of five data points is decoration
pretending to be analysis."*

**Verdict: GENUINELY NEW, and the largest item in the set.**

**Note that the request is wider than events.** "A calendar where the admin can
see details of who is busy in which activity" is not an events calendar — it is
a team calendar, which means plotting three different things on one grid:
`daily_plans` (planned and assigned visits, with check-in/out), `visits` (what
actually happened), and the new events table. Each has a different date column
and a different notion of "who".

**To build.** Large. Probably **no migration**, though a `(date, member)` index
on `daily_plans` would earn its place. Build it as a hand-rolled CSS-grid month
view — see the budget note below.

**The deployment budget is a real constraint here.** `CLAUDE.md`: Cloudflare
Workers free plan is 3072 KiB gzipped and the app is at 2949 KiB — HANDOVER puts
the headroom at 106 KiB. A calendar library would very likely exceed it, and
over the line the **deploy** fails while the build still passes. The documented
answer is the Workers Paid plan at $5/mo, which is a plan change and nothing
else. Worth telling the client before the feature is built rather than after.

**Questions for the client.**

- **Q24.** Does the calendar show only events, or every rep's planned visits and
  logged activity too?
- **Q25.** Month view, week view, or a day-at-a-time list? On a phone a month
  grid of twenty reps is unreadable; this is an admin screen, so a desktop-first
  layout may be right — which would be the first screen in the app to be so.
- **Q26.** Is it read-only, or can an admin create and reassign from it?

---

## R12 — Pending lists everything not closed; Log Visit closes by status

**What exists.**

- **Pending** (`getPendingVisits`, `src/lib/visits.ts:160`) is a single
  condition: `.eq("lifecycle_status", "Set")`. That is sessions and campus
  visits only. The page says so: *"Sessions and campus visits you have set but
  not yet closed."* **Meetings never appear**, because a meeting is complete the
  moment it is logged.
- **Closing** happens on `/pending/[id]`, a detail screen off Pending — the
  closing report form. Filing it sets `lifecycle_status = 'Done'` and stamps
  `closed_at`.
- **Open vs. closed is already a first-class property of every status.**
  `INSTITUTE_STATUS_CATALOGUE` pairs each of the nine with `open` or `closed`,
  and `public.institute_statuses` plus `institute_status_category()` say the
  same thing in SQL. "Session done", "Campus visit done", "RSVP received" and
  "Will not come" are already **closed**; the other five are **open**.
- **Log Visit already sets the status.** `status_set_to` travels through
  `log_visit()`, which updates `institutes.status` in the same transaction and
  leaves a row in `institute_status_history`.

**Answering overlap (c): partly the same mechanism relabelled, partly not.**
The Set → Done lifecycle, the "Open for today" list and the open/closed status
catalogue between them already implement most of "things stay open until
closed". What is missing is that **the three mechanisms do not agree on what
"open" means**: a plan entry is open until held, a session is open until Done,
an institute is open until its status says closed, and a meeting is never open
at all.

**Verdict: PART ALREADY DONE, PART GENUINELY NEW.** Widening Pending to "all
pending visits which are not closed" means adding unheld daily-plan entries and
un-closed meetings — which only exist if R5 and R6 are built first.

**"Closed on the basis of status" is closer than the client may realise.** The
app already knows that "Session done" is a closed status and "Session
scheduled" is an open one, from a single source of truth on each side. Using
that to close the loop when a rep picks a status in Log Visit is a rewiring of
existing parts, not a new mechanism.

**To build.** Medium. No migration if it is a query change plus a status→close
rule; **a migration if meetings gain a close state** (that is R6's cost, not
this one's).

**Questions for the client.**

- **Q27.** Should closing move *into* Log Visit? Today a rep logs the visit on
  Log Visit and files the closing report on a separate screen off Pending. "In
  Log Visit when someone does the log visit it will be closed" reads like one
  screen doing both.
- **Q28.** Should Pending list unheld *plan entries* (a meeting planned but not
  yet held) alongside open *visits*? Those are rows in two different tables and
  would need one merged list.
- **Q29.** If a rep picks a closed status ("Session done") on a visit that was
  never a "Set" session, should that still close something?

---

## Cross-cutting observations

**1. The requests are not independent.** R4 → R9 → R5 → R6 → R12 form one chain:
purposes get keys, activity is derived from the purpose, the plan carries past
today, meetings gain a close state, and Pending shows all of it. Building any
one of them in isolation is fine; building them in the wrong order means
rewriting the earlier ones. R1, R7, R8, R10 and R11 are independent and can be
done in any order.

**2. Three of the requests reduce something that was built deliberately.**
R1 removes a metric migration 0013 was written to add. R8's "closed only by"
strips four required fields off the campus-visit report. R7 may or may not
replace the whole closing report — Q16 is the single most consequential
unanswered question in this document. None of these is wrong; all three should
be a decision rather than a side effect.

**3. One request contradicts a documented, recently re-audited decision.** R3.
The shared registry is stated in migration 0001, restated in migration 0016 §3
four commits ago, and the sharing model is what makes admin assignment and rep
handover work. It can be changed — but as a decision taken with Q4–Q6 answered,
not as a dropdown filter added quietly.

**4. Deployment size.** 106 KiB of headroom on the Workers free plan. R10 and
R11 together are the largest addition since that measurement. Measure before,
not after:

```bash
npm run build && npx wrangler deploy --dry-run --outdir /tmp/out   # "Total Upload:"
```

The documented answer if it goes over is the $5/mo Workers Paid plan, not more
trimming.

**5. Test impact.** R1 touches four test files. R5 and R9 touch the meeting-gate
suites in `tests/integration/rules.test.ts`, which are the tests that exist
specifically to catch the two halves of a load-bearing rule drifting apart.
Those suites are the point, not an obstacle — but they mean R5 and R9 are
larger than their UI surface suggests.

---

## The questions, gathered

Ordered by how much they change what gets built.

| # | Question | Blocks |
| --- | --- | --- |
| **Q16** | Do the new closing questions **add to** the existing closing report or **replace** it? | R7, R8 |
| **Q4–Q6** | What does "that rep's institutes" mean, and what happens to shared schools and to a departing rep's schools? | R3 |
| **Q18–Q20** | How are Olympiad / Application / Admission logged, and what about unplanned visits, if Activity comes from the purpose? | R9, R4 |
| **Q13** | Does "closed by a follow-up date" mean *required at save*, or *stays open until the follow-up happens*? | R6, R12 |
| **Q10–Q12** | How long does an unheld plan entry stay open, which week does a late meeting count in, and can one be cancelled? | R5 |
| **Q24–Q26** | Does the calendar show only events or all activity; which view; read-only? | R11 |
| **Q7–Q9** | Do purposes stay admin-editable, can the wording differ from the statuses, do the other three activities get purposes? | R4 |
| **Q17** | Is the student count the *only* question for a campus visit, or one *more* question? | R8 |
| **Q14–Q15** | "Number of students" vs "total number of students"; who is "session taken by"? | R7 |
| **Q21–Q23** | Do events link to invited institutes; who owns one; does one get closed? | R10 |
| **Q27–Q29** | Does closing move into Log Visit; does Pending list plan entries too; what closes on a closed status? | R12 |
| **Q1–Q2** | Remove "Institutes Covered" from all three periods or just weekly; remove the metric or just the commitment field? | R1 |
| **Q3** | Is the daily-plan flow to *move* to the Targets tab, or is this a description of what already exists on the Dashboard? | R2 |
