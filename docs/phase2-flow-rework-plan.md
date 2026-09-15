# Phase 2 — purpose, status, closing report and Pending: plan & migration design

**Plan only. No code, no migration. All ten decisions are locked** (§12); this
is the version to build from.

Phase 2 is the second interlocking rework: it removes a control the visit form
has always had, turns a vocabulary that has been baked into CHECK constraints
since 0001 into admin-managed data, strips four fields off a report that shipped
weeks ago, and changes what the word "pending" means. Every one of those four
touches the other three.

**The app is LIVE and in use.** So this plan is written to a second constraint
that `docs/stage3-plan.md` did not have: *every stage must be deployable on its
own, against a running app, without a window in which the database and the code
disagree.* Section 10 is the part that matters most.

Read alongside `CLAUDE.md`, `docs/stage3-plan.md` (what shipped last),
`docs/flow-redesign-plan.md` and `docs/feedback-mapping.md` — Phase 2 answers
three questions that document left open (Q18, Q19, Q20).

---

## 0. The one-sentence summary

> **The activity vocabulary stays fixed and the purpose list becomes the
> admin-managed layer on top of it. The status vocabulary becomes admin-managed
> data. These are opposite answers to superficially identical requests, and the
> reason is arithmetic: seven of the eight weekly metrics are counted by
> `activity`, and nothing anywhere is counted by `status`.**

Everything in sections 3 and 4 follows from that sentence.

### The decisions, at a glance

| | Decision | Answer |
| --- | --- | --- |
| **D1** | What produces a `meeting`? | No new "Meeting" purpose. Existing purposes declare their activity; **"First meeting" and "Other" → `meeting`**. 0026 seeds Follow-up, Olympiad, Application and Admissions — §3.3 |
| **D2** | Follow-up: date, or date and time? | ~~Both, pre-filled~~ → **DATE ONLY.** Client reversed it after Stage 1 shipped; migration **0023** drops the time from FO016 |
| **D3** | Save the date on a Done session / campus visit? | **Yes** — fix `log_visit()`, one `case` expression, same signature |
| **D4** | Who owns that date field? | **One field.** Strictness from the purpose: Set → required "Tentative…"; Done → optional, pre-filled, "Session date" |
| **D5** | One student count or two? | **One.** `students_reached` goes dormant, reversibly |
| **D6** | Keep "Is a next session set?" | **Remove it.** The status drives follow-up visibility — and this fixes a live dead end |
| **D7** | The "open loops" counts | **Remove both** — rep Dashboard tile *and* admin Team column. Pending is the single source |
| **D8** | Rename or delete a status? | **The FKs decide.** `restrict` lets an unused status rename/delete cleanly and refuses one in use; retire via `is_active` |
| **D9** | Compulsory status: trigger or form? | **Trigger.** The one deploy-coupled statement in the plan |
| **D10** | Admin Pending launch? | **Read-only**, plus an "Assign this follow-up" shortcut as its own small stage |

### What those answers bought

* **`close_visit()` never changes in Phase 2.** D3 puts the date on the *log*
  form, where `p_expected_date` already exists; D5 is the app passing `null`. So
  there is no signature change, no overload drop, none of 0019/0022's ceremony.
* **The only function touched is `log_visit()`, by body only** — same signature,
  so 0015's exactly-one-overload assertion holds with no drop guard, and
  `create or replace` keeps the grants.
* **That change is a loosening** — it stores something currently discarded, and
  the live app never sends a date on a Done visit — so it is **safe to apply
  early** rather than at deploy time.
* **Three migrations, one of them deploy-coupled**, plus one optional
  comment-only file (§7).
* **Two pieces of code are deleted rather than left orphaned**:
  `openLoopsByMember()` (D7) and `RICH_ACTIVITIES` / `needsClosingReport()`.

---

## 1. Why the two vocabularies get opposite treatment

The client's two requests read alike — "let an admin add purposes" and "let an
admin add statuses" — and they are not alike at all.

| | `activity` (6 values) | `status` (9 values) |
| --- | --- | --- |
| Where the vocabulary lives | `visits_activity_valid` CHECK (0001), `ACTIVITIES` in `validation/visit.ts` | `institutes_status_valid` + `visits_status_set_to_valid` CHECKs (0010), `institute_statuses` table (0010), `INSTITUTE_STATUS_CATALOGUE` in `validation/institute.ts` |
| What counts by it | **Seven of the eight weekly metrics.** `METRICS` in `validation/weekly.ts` keys `sessions_set`, `sessions_done`, `campus_visits_set`, `campus_visits_done`, `olympiad`, `application`, `admission` on `(activity, lifecycle_status)` — and `public.targets` has **one integer column per metric** | **Nothing.** No metric, no target column, no rollup |
| What behaviour hangs off it | `enforce_meeting_gate` (Rule 2), `log_visit()`'s `meetings_actual = 1`, `visits_lifecycle_matches_activity` | The open/closed category, and that is all |
| Can a new value be added by an admin? | **No.** A seventh activity would be a metric with no column on `targets`, no row on the Targets screen and no place in `tallyVisitMetrics()` — invisible in every total, which is worse than not existing | **Yes**, provided it declares open or closed |

So:

* **Purposes** become the admin-managed list, and each purpose row declares
  *which of the six fixed activities it counts as*. An admin can add as many
  purposes as they like; the arithmetic underneath never moves.
* **Statuses** become admin-managed rows in a table that already exists
  (`public.institute_statuses`, created by 0010 for exactly this reason), with
  the open/closed category as the one thing a new row must declare.

`institute_statuses` was built as "the database's single source of truth for the
mapping" and `institute_status_history.status` is **already a foreign key to
it** (0011). The table was designed for this. What was never designed for it is
the pair of CHECK constraints that duplicate the list — §4.2.

---

## 2. Probe the live database before any of this is written

`docs/stage3-plan.md` §1 checked the live data first, and three constraints in
the obvious design turned out to be unbuildable. Do the same here.

| # | Probe | Design assumes |
| --- | --- | --- |
| ~~P3~~ | `select label from public.purposes order by label;` | **ANSWERED (2026-09-15): six rows** — *First meeting* (added 2026-09-15), *Other*, *Fix a session*, *Complete a session*, *Fix a campus visit*, *Complete a campus visit*. So a meeting-mapped purpose exists and Meetings will not go silent. The column is `label`, not `name`. §3.3 |
| P1 | `select distinct status from public.institutes where status is not null;` and the same for `visits.status_set_to` | Every value is one of the nine. **If not, the CHECK→FK swap in §4.2 fails to build** |
| P2 | `select count(*) from public.visits where status_set_to is null;` | **> 0 is expected** — "No change" has always been offered. Confirms D9's rule must be a TRIGGER, not a NOT NULL or a CHECK |
| P4 | `select purpose, count(*) from public.daily_plans group by 1 order by 2 desc;` | Which purpose labels are in history, so 0024's `purpose_id` backfill can be checked for misses |
| P5 | `select count(*) from public.visits where status_set_to is not null and follow_up_time is null and public.institute_status_is_open(status_set_to);` | Pre-0018 rows exist with no time. Confirms Pending must render "no date recorded" rather than assume one |
| P6 | `select count(*) from public.institutes i where public.institute_status_is_open(i.status);` | The size of the new Pending list on day one. If it is large, the rep's first sight of the new screen is a backlog — worth knowing before it is a surprise |
| P7 | `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.institutes'::regclass,'public.visits'::regclass) and contype = 'c';` | Confirms which CHECKs are actually installed, against the file record |

P3 unblocks D1. P1 is the one that can stop the plan. P2 and P5 decide whether
two rules can be constraints (they cannot) — the same finding, for the same
reason, as 0018.

---

## 3. Area A — purpose becomes the single source of "what kind of visit"

### 3.1 What exists today

* `public.purposes` (0001) is `(id, label, created_at)` — a flat list of labels,
  seeded with five: *Fix a session*, *Fix a campus visit*, *Complete a session*,
  *Complete a campus visit*, *Other*. Admin-managed through `PurposesPanel` +
  `addPurpose` / `removePurpose`; `purposes_write` is `is_admin()`.
* `daily_plans.purpose` is **text**, a snapshot of the label. Not a foreign key,
  deliberately — history keeps the wording it was recorded under.
* `PURPOSE_ACTIVITY` in `src/lib/validation/visit.ts` maps four of those five
  labels to `{activity, lifecycle}`. **It is a lookup on the editable label**,
  and the file already says so: *"renaming a purpose in Settings silently drops
  it out of this map"*. `"Other"` is deliberately absent — the rep picks.
* `log-visit-form.tsx` renders an **Activity** `<Select>` (six options) and, when
  the activity has a lifecycle, a **Set / Done** `<Select>`. Both are pre-filled
  from `activityForPurpose(plan.purpose)` and both stay editable.
* The activity is then carried in a hidden field and posted to `log_visit()`.

### 3.2 The purpose → activity map (D1)

**No new "Meeting" purpose is created.** Every purpose row — seeded or
admin-added — declares which of the six fixed activities it counts as. This is
the seed for `purposes.activity` / `purposes.lifecycle`:

| Purpose (`purposes.label`) | Exists? | `activity` | `lifecycle` | Free text? | Rule 7 metric it feeds | Other behaviour it turns on |
| --- | --- | --- | --- | --- | --- | --- |
| **First meeting** | live | `meeting` | — | no | **Meetings** | `enforce_meeting_gate`; `log_visit()` sets `daily_plans.meetings_actual = 1` |
| **Other** | live | `meeting` | — | **yes** | **Meetings** | as above, plus the typed note |
| **Fix a session** | live | `session` | `Set` | no | Sessions Set | `expected_date` **required** — "Tentative session date" (D4) |
| **Complete a session** | live | `session` | `Done` | no | Sessions Done | may close an earlier "Set" via `closes_visit_id`; `closed_at` stamped |
| **Fix a campus visit** | live | `campus_visit` | `Set` | no | Campus Visits Set | `expected_date` **required** (D4) |
| **Complete a campus visit** | live | `campus_visit` | `Done` | no | Campus Visits Done | may close an earlier "Set"; `closed_at` stamped |
| **Olympiad registration** | **0026 seeds** | `olympiad` | — | no | Olympiad Registrations | one-shot, no lifecycle |
| **Application forms** | **0026 seeds** | `application` | — | no | Application Forms | one-shot, no lifecycle |
| **Admissions** | **0026 seeds** | `admission` | — | no | Admissions | one-shot, no lifecycle |
| **Follow-up** | **0026 seeds** | `meeting` | — | no | **Meetings** | as First meeting — the second and later visits to a school |
| *(any admin-added purpose)* | — | admin picks one of the six | per the rule below | admin's choice | whichever the activity feeds | whichever the activity turns on |

`lifecycle` is non-null **iff** the activity is `session` or `campus_visit` —
the same rule as `visits_lifecycle_matches_activity` (0001), mirrored as a CHECK
on `purposes` so an admin cannot create a purpose that produces a row the visits
table will refuse.

### 3.3 The Meetings metric — resolved by probe P3

`meeting` is the headline weekly metric and the only activity that flips
`daily_plans.meetings_actual = 1`. Today the *only* route to it is the Activity
selector, whose default is `"meeting"`. Delete the selector and the Meetings
metric is fed by whatever purposes map to `meeting` — and by nothing else. So
the risk was a week in which every rep's headline number quietly read zero.

**Probe P3 (2026-09-15) closes it.** `public.purposes` holds six rows, and
**"First meeting" is one of them** (added 2026-09-15). With *First meeting* and
*Other* both mapping to `meeting`, the metric keeps a live source and nothing
has to be seeded to protect it.

Two things the probe also settled, both carried into the table above:

* **Olympiad registration, Application forms and Admissions do not exist as
  purposes.** They are seeded by 0026 with Stage 3, which is the file that also
  makes the selector unnecessary. Until then those three metrics are reachable
  only through the selector — which is precisely why the seed and the selector's
  removal ship together.
* **There is no "Follow-up" purpose either, and 0026 seeds one.** *First
  meeting* is the only meeting-shaped row, so a second visit to the same school
  is currently planned as "First meeting" — which is wrong on its face — or as
  "Other", which buries an ordinary follow-up under the free-text catch-all.
  Both map to `meeting`, so no metric moves either way; what improves is that
  the plan says what the visit actually is. **Locked: 0026 seeds
  "Follow-up" → `meeting`.**

So 0026's purpose seed is exactly four rows:

| Label | `activity` | `lifecycle` | Free text? |
| --- | --- | --- | --- |
| Follow-up | `meeting` | — | no |
| Olympiad registration | `olympiad` | — | no |
| Application forms | `application` | — | no |
| Admissions | `admission` | — | no |

Seeded `on conflict (label) do nothing`, like 0001's own purpose seed, so
re-running the migration cannot duplicate a row or overwrite a label an admin
has since edited.

### 3.4 "Other" and its free text

`purposes` gains `requires_note boolean not null default false`, true for
*Other*. `daily_plans` gains `purpose_note text` (length-checked at 300, and
required when the chosen purpose demands one — enforceable as a trigger, not a
CHECK, because the rule spans two tables).

**Store the note separately; do not fold it into the label.** Writing
`"Other: dropped off brochures"` into `daily_plans.purpose` would stop the value
matching any `purposes` row, which is precisely the lookup the activity now
depends on.

### 3.5 Resolve the purpose by id, not by label

`daily_plans` gains `purpose_id uuid references public.purposes (id) on delete
set null`, backfilled from the label. `purpose` stays as the text snapshot, so
history is unaffected and renaming a purpose no longer silently drops a plan out
of the mapping — the weakness `validation/visit.ts` already documents.

Corollary: `removePurpose` becomes a **retire** (`is_active = false`), not a
delete. A deleted purpose leaves `purpose_id` null and the activity unresolvable
for any plan row not yet logged (F8).

### 3.6 Every place that reads `activity`, and what happens to it

The headline: **nothing downstream of `activity` changes.**

| Where | What it does | Change |
| --- | --- | --- |
| `visits_activity_valid` CHECK (0001) | the six keys | **untouched** |
| `visits_lifecycle_matches_activity` CHECK (0001) | Set/Done iff session or campus_visit | **untouched**, and now mirrored on `purposes` |
| `enforce_meeting_gate()` (0001) | Rule 2 | **untouched** |
| `METRICS` / `tallyVisitMetrics()` (`validation/weekly.ts`) | Rule 7's arithmetic | **untouched** |
| `public.targets` columns | one per metric | **untouched** |
| `week-summary.ts`, `activity-report.ts` | count by activity | **untouched** |
| `admin-workspace.ts` + `visit-review.tsx` | the review filter's activity dropdown | **untouched** (still six) |
| `log_visit()` (0015) — meeting gate, `meetings_actual = 1`, `v_lifecycle` | Rules 2, 3, 7 | **untouched except one `case`** — D3, §4.6 |
| `ACTIVITIES` / `ACTIVITY_KEYS` / `hasLifecycle` (`validation/visit.ts`) | the vocabulary; `visitSchema.activity: z.enum(ACTIVITY_KEYS)` | **stays** — it stops being a control, it does not stop being the vocabulary |
| `expectedDateRequired()` / `expectedDateLabel()` | Set ⇒ a tentative date, labelled per activity | **extended** for D4's Done case |
| `PURPOSE_ACTIVITY` / `activityForPurpose()` | label → `{activity, lifecycle}`, four entries | **replaced** by the `purposes` row. Delete the constant |
| `log-visit-form.tsx` Activity `<Select>` and Set/Done `<Select>` | free choice | **both removed**; two hidden fields fed from the plan's purpose |
| `feedback-actions.ts` `logAndFileVisit` → `p_activity` | posts the activity | **stays**; the value is now derived, not typed |
| `activities.ts` `ACTIVITY_LABELS` | a **second** copy of the six labels | duplicate of `ACTIVITIES`. Collapse into one while the file is open |
| `validation/closing-report.ts` `RICH_ACTIVITIES` / `needsClosingReport()` | **dead — nothing calls it** | **delete** (Stage 1) |

### 3.7 What Area A reverses, and what it settles

* It **reverses stage 3's answer to its own Q7** — *"does the rep still pick the
  activity with the purpose shown beside it?"* — answered then as "yes",
  answered now as "no". The removal is a deletion of a control, not of a rule,
  so nothing is orphaned in the database.
* It **answers `feedback-mapping.md` Q18**: olympiad / application / admission
  get purposes. That closes R9's first conflict — "three metrics become
  unreachable" — outright.
* R9's second conflict, *"it extends the meeting gate to everything"*, **no
  longer exists**: 0018 already widened the presence guarantee to every
  activity, so every visit already runs off a plan row. Nothing new is gated.
* It **answers Q20**: the purpose *locks* the activity.

### 3.8 The one thing Area A makes possible that is worth refusing

With the activity fixed by the purpose, the status the rep chooses can disagree
with it — purpose *Fix a session* (`session`/`Set`) alongside status *Session
done*. **Leave that alone.** They answer different questions: the purpose says
what the rep did (and is what the metrics count), the status says where it
leaves the institute. Today's app already permits exactly this combination.
Deriving the lifecycle from the *status* instead would hang Rule 7's arithmetic
off the admin-managed vocabulary, which is the one thing §1 exists to prevent.

---

## 4. Area B — status becomes admin-managed data

### 4.1 What exists today, in four places

| Place | What it holds | Written by |
| --- | --- | --- |
| `public.institute_statuses` (0010) | `(status PK, category, sort_order)` — the nine rows, RLS `select` for everyone, **no write policy at all** | a migration |
| `institutes_status_valid` CHECK (0010) | the nine literals | a migration |
| `visits_status_set_to_valid` CHECK (0010) | the nine literals | a migration |
| `INSTITUTE_STATUS_CATALOGUE` (`validation/institute.ts`) | the nine, with categories, in display order — **the app's single source of truth** | the repo |

Plus two things that already do the right thing and must not be disturbed:
`institute_status_category()` / `institute_status_is_open()` (0010) **read the
table** rather than restating the list, and `institute_status_history.status`
(0011) is **already a foreign key** to it. And one rule that depends on all of
it: `enforce_follow_up_when_open()` / **FO016** (0018) asks
`institute_status_is_open()`, so it covers a status added tomorrow without being
touched.

### 4.2 The redesign: the CHECKs become foreign keys (D8)

**The two CHECK constraints are the only real blocker, and they are a trap in
the most dangerous direction.** An admin inserting a row into
`institute_statuses` would succeed — and the status would then be *unusable*:
every attempt to set it on an institute or a visit fails with a raw 23514.

```sql
alter table public.institutes drop constraint institutes_status_valid;
alter table public.institutes  add constraint institutes_status_fk
  foreign key (status) references public.institute_statuses (status)
  on update restrict on delete restrict;

alter table public.visits drop constraint visits_status_set_to_valid;
alter table public.visits  add constraint visits_status_set_to_fk
  foreign key (status_set_to) references public.institute_statuses (status)
  on update restrict on delete restrict;
```

* `status` is the table's primary key, so it can be referenced.
* Both build **only if** probe P1 comes back clean. Guard it with a `do $$` block
  that counts orphans and raises a sentence, the way 0018 §4 does for the
  one-open-visit index — a half-applied migration is the failure mode to avoid.
* FK validation ignores RLS, so a rep's insert is checked exactly as an admin's.

**`restrict` is what implements D8, and it needs no extra code.** The rule falls
straight out of the constraint:

| Admin action | What happens |
| --- | --- |
| Rename a status **never used** | Succeeds. This is the typo case, and it is the one people actually hit |
| Rename a status **in use** | Refused by the FK (23503). Mapped to a sentence: *"That status is already on visits. Add the corrected one and retire this."* |
| Delete a status **never used** | Succeeds |
| Delete a status **in use** | Refused by the FK. Retiring is the answer |
| Retire any status | `is_active = false` — gone from the picker, every past record still reads |

0011's history FK defaults to NO ACTION, which refuses in the same cases, so the
three constraints agree without being told to.

`visits_follow_up_required_when_awaiting` (0010) **stays**. It names two literal
statuses and is a strict subset of FO016's trigger, so it decides nothing — but
it is kept for exactly the reason 0018 kept it: dropping it would silently lose
a guarantee if the trigger ever went. Worth one comment noting that a status
*retired and replaced* by an admin is covered by the trigger, not by this CHECK.

### 4.3 The lookup table gains its configuration

```sql
alter table public.institute_statuses
  add column is_active           boolean not null default true,
  add column tone                text    not null default 'neutral',
  add column asks_expected_date  boolean not null default false,
  add column asks_session_detail boolean not null default false,
  add column asks_head_count     boolean not null default false,
  add column created_by          uuid references public.profiles (id) on delete set null,
  add column created_at          timestamptz not null default now();
```

Seeded for the nine. Everything except the two `asks_expected_date` marked **(D3)**
reproduces today's behaviour exactly, so nothing else on screen changes:

| Status | category | tone | asks_expected_date | asks_session_detail | asks_head_count |
| --- | --- | --- | --- | --- | --- |
| First meeting done | open | success | — | — | — |
| Session scheduled | open | warning | **yes** | — | — |
| Session done | closed | success | **yes (D3)** | **yes** | **yes** |
| Campus visit scheduled | open | warning | **yes** | — | — |
| Campus visit done | closed | success | **yes (D3)** | — | **yes** |
| Pending for management approval | open | danger | — | — | — |
| Invited principal for event | open | warning | — | — | — |
| RSVP received | closed | success | — | — | — |
| Will not come | closed | neutral | — | — | — |

`tone` carries the exact colours `status-badge.tsx` uses today, with a CHECK
`tone in ('success','warning','danger','neutral')`. It is a **column and not a
derivation** because `CLAUDE.md` is explicit: *"Badge colour tracks the outcome,
not the open/closed category — 'First meeting done' is green and still open."*
Nothing can compute it.

**Also drop `institute_statuses_sort_order_unique`** (F7). It is a trap for
admin-managed rows: two admins adding a status, or any reordering, collides with
a 23505 that reads as a bug. Replace it with a plain index and order by
`(sort_order, status)` so ties stay deterministic.

### 4.4 Who may write it

`institute_statuses` has **no write policy at all** today. Add, following 0011's
lesson that grants must be spelled out rather than inherited:

```sql
revoke all on public.institute_statuses from authenticated, anon;
grant select, insert, update, delete on public.institute_statuses to authenticated;

create policy institute_statuses_insert ... with check (public.is_admin());
create policy institute_statuses_update ... using (public.is_admin())
                                          with check (public.is_admin());
create policy institute_statuses_delete ... using (public.is_admin());
```

A delete policy **is** included, because D8 makes deleting an unused status a
legitimate admin action; the FKs are what stop it being a dangerous one.

The admin panel is a sibling of `PurposesPanel` on `/settings`: add a status
(label + open/closed + tone + the three tick boxes), rename or delete one while
unused, retire one that is in use. **Ship the retire path with the panel**, or
an admin's only route to removing a used status is an error message.

### 4.5 The per-status conditional fields

> **A closed vocabulary of FIELD GROUPS in code; which groups a status asks for
> is DATA. Everything off by default, so a status an admin adds behaves exactly
> like the generic open/closed option until they say otherwise.**

Why not fully free-form: every field is a **column on `public.visits`**.
"Admin-defines-the-fields" would mean an EAV blob — nothing could report on it,
no CHECK could constrain it, `report-view.tsx` could not render it, and
`close_visit()` could not carry it.

| Group | Fields it shows | Column(s) |
| --- | --- | --- |
| *(the follow-up)* | follow-up **date** (D2) | `follow_up_date` — `follow_up_time` is dormant from 0023 |
| `asks_expected_date` | the session / campus-visit date (D4) | `expected_date` |
| `asks_session_detail` | topic, taken by | `session_topic`, `session_taken_by` |
| `asks_head_count` | number of students — **one count** (D5) | `students_attended` |

**The follow-up is deliberately NOT a flag. It *is* the category.** An open
status with a hypothetical `asks_follow_up = false` would be a status the form
never asks about and `enforce_follow_up_when_open()` (FO016) then refuses at the
database — an admin could create a status no rep could ever successfully use.
Open ⇒ follow-up, full stop. That is Rule 5, and it is in the database.

### 4.6 D2, D3 and D4, as built

**D2 — the follow-up is a DATE. ⚠ REVERSED after Stage 1 shipped.**

It was first settled as "keep both, pre-fill the time to 11:00" — a time is what
makes Pending sortable into a day rather than a pile, and pre-filling removed the
fiddle without losing the data. That shipped, and the client then asked for the
date alone.

So **migration 0023** replaces `enforce_follow_up_when_open()` with one that asks
for `follow_up_date` and nothing else, the Time control and
`DEFAULT_FOLLOW_UP_TIME` are deleted, and `visits.follow_up_time` goes **dormant
rather than dropped** — it keeps every value recorded between 0018 and 0023.
`visits_follow_up_required_when_awaiting` (0010) is untouched: it only ever
required the DATE.

**0023 only LOOSENS**, which makes it the first migration in this plan that is
safe to apply before *or* after its deploy. Apply-first is still preferred: the
other order leaves FO016 refusing every open-status visit until it is run.

One consequence for Area D: Pending's rows sort by day, not by time of day. That
is what the client asked for and it is worth noticing rather than discovering.

**D3 — `log_visit()` stops discarding the date.** Today it writes

```sql
case when v_lifecycle and p_lifecycle_status = 'Set' then p_expected_date else null end
```

so a date submitted on a **Done** visit is thrown away. The fix is that one
expression, in a `create or replace` with the **identical signature** — so there
is still exactly one `log_visit` overload (0015's assertion), the grants survive,
and no drop guard is needed. Reproduce the body in full, as 0006, 0008 and 0015
each did, with the changed line marked.

It is a **loosening** — the live app never sends a date on a Done visit, because
the field is only rendered when the lifecycle is `Set` — so it is safe to apply
early and rides in 0025 alongside the `asks_expected_date` seed that makes the
field appear.

**D4 — one field, strictness from the purpose.** Shown when *either* the purpose
says `Set` or the chosen status has `asks_expected_date`:

| Situation | Label | Required? | Pre-filled? |
| --- | --- | --- | --- |
| Purpose says **Set** | "Tentative session date" / "Tentative campus visit date" | **yes** — today's exact rule and message | no |
| Status asks and purpose says **Done** | "Session date" / "Campus visit date" — no "Tentative", it already happened | no | **today's date**, so a session held last Thursday is a one-tap correction |

One field, one column, one place the rule is written. `expectedDateLabel()` gains
the lifecycle as an argument so "Tentative" is not printed over a past event.

### 4.7 "No change" goes, and status becomes compulsory (D9)

* `log-visit-form.tsx` drops the `NO_CHANGE` option.
* `visitSchema.status_set_to` becomes required.
* **In the database this is a TRIGGER**, not a NOT NULL and not a CHECK. Probe
  P2 confirms what is already certain: live visits carry a null `status_set_to`,
  because "No change" has always been offered, so either would refuse to build.
  A trigger fires only on the rows it is given — exactly 0018's reasoning for its
  four, and it leaves every existing null row legal and readable.

```
enforce_status_required()   -- before insert on public.visits
                            -- raises FO0xx when status_set_to is null
```

**This is the one statement in the whole plan that is strictly deploy-coupled**
(F4): applied before the new app ships, it breaks every rep who picks "No
change" on the live app.

### 4.8 The app side: the catalogue stops being the source of truth

`INSTITUTE_STATUS_CATALOGUE` becomes **the seed, and the fallback** — the nine
values a fresh database is created with, and the list the app falls back to if
the status read fails.

The mechanical consequence: **`statusCategory()`, `isOpenStatus()`,
`isClosedStatus()`, `statusesInCategory()` and `followUpRequired()` stop being
pure functions over a constant and take the live catalogue as an argument**, and
`visitSchema` becomes a **factory** — `makeVisitSchema(statuses)` — built once on
the server from the loaded list and once in the browser from the same list passed
as props. One shape, one set of rules, two entry points, which is the pattern
`feedback.ts` already uses for its two schemas.

| Consumer | Today | Becomes |
| --- | --- | --- |
| `visitSchema.status_set_to` refine | `.includes()` over `INSTITUTE_STATUSES` | schema factory over the loaded list; **required** (D9) |
| `followUpRequired()` | `isOpenStatus(status)` | same question, catalogue passed in |
| `log-visit-form.tsx` status `<Select>` | groups by `STATUS_CATEGORIES`, offers "No change" | list from props, grouped the same way, **no "No change"** |
| `feedback.ts` `needsSessionDetail()` / `needsCampusCount()` | `status === "Session done"` / `"Campus visit done"` — **hard-coded literals** | `status.asks_session_detail` / `status.asks_head_count` |
| `status-badge.tsx` `VARIANTS` | a nine-key `Record` | the row's `tone` |
| `status-timeline.tsx` | `statusCategory(change.status)` | catalogue passed in |
| `institutePickerLabel()` / `reopeningInstitute()` | `isClosedStatus()` | catalogue passed in |
| `institutes.ts` status history | derives the category | catalogue passed in |
| `tests/unit/institute-status.test.ts` | asserts the nine exactly | asserts the **seed**, and the shape of an arbitrary catalogue |
| `tests/integration/rules.test.ts` `institute_status_category` suite | asserts app **==** database, both directions | asserts the seed is **a subset of** the database, and that categories agree for every row the database has |

That last row is a genuine loss of a guard and should be stated as such: the test
that currently fails if either half moves alone becomes a test that fails only if
the *seed* drifts. What replaces the lost half is the FK — the database can no
longer hold a status the vocabulary table does not have.

### 4.9 What Area B must not break

| Guard | Why it survives |
| --- | --- |
| **Rule 5 / FO016** | `enforce_follow_up_when_open()` asks `institute_status_is_open()`, which reads the table. A status added tomorrow is covered without a line changing |
| **Rule 4's audit trail** | `institutes_touch_status` (0001) and `institutes_record_status_change` (0011) key on the column, not on its vocabulary. Untouched |
| **The history FK** | `institute_status_history.status` already references `institute_statuses`. Untouched — and it is why `restrict` is the right call on the two new FKs |
| **Campus scoping (0020b)** | `institutes_select/update` and `institute_status_history_select` key on `campus_id`, not on status. Untouched. The **new** Pending query is where campus isolation has to be re-proved — §9 |
| **`log_visit()` SECURITY INVOKER** | D3 changes one `case` expression inside the body and nothing else |
| **The meeting gate** | not touched by Area B at all |

---

## 5. Area C — the closing report, simplified

### 5.1 Why this costs no migration

`close_visit()` takes every report field as a **defaulted parameter**. A field
leaving the form is the new app simply passing `null`. The column stays (and
still renders an old report), the parameter stays (unused), and **nothing in the
database changes**.

That is the exact mirror of what 0019's own header says about a field coming
back: *"a field coming back is a form change, and a migration only because
`close_visit()` has to carry it."* Going the other way, there is nothing for it
to carry. With D3 putting the session date on the **log** form and D5 removing a
field rather than adding one, **`close_visit()` is not touched in Phase 2 at
all.**

### 5.2 Field by field

| Field | Today | Phase 2 | Column | Consequence |
| --- | --- | --- | --- | --- |
| Notes / "What did they say?" | free text, `notes` | **stays**, relabelled "How did it go?" | `notes` | none — already the plain free-text box the brief asks for |
| Is the institute interested? | yes/no `Choice` | **removed** | `institute_interested` → **dormant** | `visit-review.tsx` surfaces it — §5.4 |
| How did the visit end? | `VISIT_OUTCOMES` dropdown | **removed** | `visit_outcome` → **dormant** | `admin-workspace.ts` selects it and `visit-review.tsx` renders it — §5.4 |
| How did management respond? | `MANAGEMENT_RESPONSES` dropdown | **removed** | `management_response` → **dormant** | rendered by `report-view.tsx` for old reports |
| How did students respond? | `STUDENT_RESPONSES` dropdown | **removed** | `student_response` → **dormant** | rendered by `report-view.tsx`; also selected by `institutes.ts` |
| Who did you meet — name | required | **stays** | `met_name` | — |
| Who did you meet — mobile | optional | **stays** | `met_phone` | — |
| Number of students | two counts since 0022 | **one** (D5) | `students_attended` | `students_reached` → **dormant**, reversibly. `report-view.tsx` already labels by era, so old reports still read correctly |
| Session topic / taken by | shown when status = Session done | **stays**, driven by `asks_session_detail` | `session_topic`, `session_taken_by` | — |
| "Is a next session set?" | yes/no gating the date fields | **removed** (D6) | — | see §5.3 |
| Follow-up date + time | shown when the yes/no said yes | **stays**, shown by the status's category, time pre-filled (D2) | `follow_up_date`, `follow_up_time` | see §5.3 |
| Session / campus-visit date | asked only on a "Set" | **also on Done**, optional, pre-filled (D3, D4) | `expected_date` | needs 0025's `log_visit()` fix or it is discarded |
| Does this close an earlier plan? | the open-loop offer | **stays — do not remove** | `closes_visit_id` | Rule 7's Set→Done arithmetic (§6.3) |

### 5.3 D6 removes a live dead end, and one more thing with it

The Yes/No is not merely redundant. **Today it can strand a rep.** Choose an open
status and answer "No": `FeedbackFields` renders hidden empty follow-up inputs,
`visitSchema.superRefine` still requires them because `followUpRequired(status)`
is true, and the error summary names "Follow-up date" — **pointing at a box that
is not on the screen.** There is no way forward except guessing.

Removing the Yes/No fixes it: the status decides. Open → date and time shown and
required. Closed or none → shown and optional, because 0010 deliberately kept
"they said no, ask again next intake" permitted.

**And it exposes a second, smaller bug worth closing in the same pass.** The
follow-up fields live in *both* schemas. On the log path `logAndFileVisit` sends
`feedback.follow_up_date` to `log_visit()`; on the **feedback-only recovery
path** `submitFeedback` calls `close_visit()`, **which does not write
`follow_up_date` or `follow_up_time` at all** — so anything the rep types there
is silently discarded. No data is lost (the values were written at log time) but
the field is a lie.

*Recommended, and included in Stage 1:* the follow-up belongs to `visitSchema`,
where the rule already is. Remove it from the feedback schema, render it from the
log form, and **stop asking for it on the feedback-only form**, which cannot save
it. *Minimal alternative if you want Stage 1 smaller:* leave the schemas alone
and just hide the inputs on the recovery form — but that leaves the discarded
field in place, which is the orphaned-code shape we are trying to avoid.

### 5.4 The photo: live camera only

`capture-fields.tsx` offers two buttons, **Take photo** (in-page `getUserMedia`,
rear camera, via `camera-capture.tsx`) and **Upload photo** (a plain
`<input type="file">`). Remove the second, its `uploadRef` input and its handler.

**Keep the native fallback.** The third input — `capture="environment"`, already
mounted and hidden — is what fires when `getUserMedia` is unavailable or refused,
and it opens the device's own camera app. It is a live camera, not a gallery, so
it is inside the rule. Removing it too would mean: any device where
`getUserMedia` fails cannot attach a photo, Rule 12 blocks the save, and **the
rep cannot log the visit at all.**

> **Flag (F1): desktop.** `capture="environment"` is a *hint*; on a desktop
> browser it degrades to a file picker, which is the gallery by another name.
> With the upload button gone, a desktop user with no webcam has no route to a
> photo. Reps are on phones, so this is acceptable — but an admin testing on a
> laptop will hit it, and should be told rather than left to discover it.

### 5.5 The two screens that read the withdrawn fields

Neither breaks — both already skip an empty value — but both go quieter for new
visits:

* `report-view.tsx` renders "Outcome", "Management response" and "Student
  response". Old reports keep them; new ones show fewer rows. **Correct as-is.**
* `visit-review.tsx` / `admin-workspace.ts` surface `visit_outcome` and
  `institute_interested` as the admin's at-a-glance summary of a visit. With both
  withdrawn, **that summary goes blank for every new visit.** Stage 3 hit the
  identical problem and logged it as *"Review 'Outcome' + institute timeline go
  blank — remap"*. Remap again: the status the visit set is now the most
  informative single value, and after D9 it is compulsory, so it is a better
  summary than the one it replaces.

---

## 6. Area D — Pending reworked

### 6.1 What "pending" means today, and what it will mean

| | Today | Phase 2 |
| --- | --- | --- |
| Section 1 | **Reports not finished** — `getUnreportedVisits()`, visits with `reported_at is null` | **stays — §6.4** |
| Section 2 | **Open loops** — `getPendingVisits()`: `visits` where `lifecycle_status = 'Set' and closed_at is null` | **replaced** by "follow-ups owed" |
| Action | none; a read-only notice board | **tap to launch a real follow-up visit** (reps only — D10) |
| Scope | RLS: rep sees own, admin sees the team's | unchanged |
| Duplicated by | the Dashboard tile and the Team column | **nothing** — both are deleted (D7) |

### 6.2 The new query

> **A Pending row is an institute whose CURRENT status is OPEN, attributed to the
> visit that set it.**

Driving it off `institutes.status` rather than off each visit is deliberate:

* it is the same value as the badge on `/institutes`, so the two screens cannot
  disagree;
* it collapses correctly — an institute visited five times shows **one** row, not
  five;
* it handles supersession across reps. Under campus scoping two reps share a
  campus; if A logs "Session scheduled" and B later logs "Session done", the loop
  is closed and it must leave Pending.

Attribution — and therefore the rep's scope and the follow-up date — comes from
the most recent `visits` row at that institute whose `status_set_to` equals the
institute's current status. RLS on `visits` is `member = auth.uid() or
is_admin()`, so **a rep sees the ones they set and an admin sees all**, which is
exactly the scoping the brief asks for, for free.

```
open institutes                  -- institute_status_is_open(institutes.status)
  ⋈ latest attributing visit     -- member, follow_up_date, follow_up_time, notes, date
```

**Implementation: do the dedupe in the application, not in SQL.** PostgREST
cannot express `distinct on`, and the row counts are small (probe P6 says how
small). A `security_invoker` view is the upgrade path if it ever stops being
small.

> **Flag (F2): if it is ever built as a VIEW it MUST be `with (security_invoker =
> true)`.** A view defaults to running as its owner, which would hand every rep
> every other rep's visits and walk straight through both the per-rep RLS and
> 0020b's campus boundary in one line. This is the single most
> security-sensitive line in the plan.

Edge cases to render rather than hide:

* **No attributing visit** — the status was set by a direct update, or by a rep
  who has since gone. Visible to admins as "set directly"; invisible to reps.
* **No follow-up date** — probe P5 says pre-0018 rows exist. Render "no date
  recorded" rather than assuming one. Overdue = `follow_up_date < todayISO()`,
  which replaces the current `expected_date` comparison in `pending-list.tsx`.
  There is no time to sort within a day: D2 was reversed to a date only, so
  Pending orders by day and by nothing finer.

### 6.3 What happens to "open loops" (D7)

**The Set→Done machinery is not deleted, only un-listed.** All of this stays,
because it is Rule 7's arithmetic, not a screen:

* `closes_visit_id`, `closed_at`, `visits_open_set_idx`
* `openLoopsAt()` — the per-institute offer in the closing form
* `close_visit()`'s FO019 re-check of the loop being closed
* `CLAUDE.md`'s "closing a Set no longer moves it" paragraph

**What is deleted is the duplicate count, in both places:**

| Removed | Where |
| --- | --- |
| The rep Dashboard "Open loops" tile | `today-snapshot.tsx`, and its prop from `app/(app)/page.tsx` |
| The admin Team "Open loops" column | `team-snapshot.tsx`, and its prop from `app/(app)/team/page.tsx` |
| `openLoopsByMember()` | `lib/visits.ts` — **delete the function**; nothing calls it once both callers are gone |

Pending becomes the single view of what is owed. One number, one meaning, one
screen.

### 6.4 "Reports not finished" must stay on Pending

The brief says Pending shows open statuses, *"NOT unfinished reports (a visit
can't save without a finished report)"*. That premise is **almost** right, and
the gap is load-bearing.

Logging and filing are **one submit but two RPCs** (`log_visit()` then
`close_visit()`), and `feedback-actions.ts` documents the seam: if the first
succeeds and the second fails, the visit exists unreported and **the rep is still
checked in**. With one-open-visit-at-a-time, that stops them working anywhere
else until it is finished.

`getUnreportedVisits()` on `/pending` is the **only** route back to such a visit
once the day rolls over: the Dashboard shows *today's* plan, and a visit logged
yesterday whose report never landed is not on it.

> **Remove that block and you can strand a rep for a day** (F10). Keep it. It may
> be retitled ("Finish these first") and it stays above the follow-ups, because
> it is both more urgent and quicker.

### 6.5 Tapping a Pending item (D10)

**For a rep**, the row launches a real follow-up visit. A visit requires, in
order: a `daily_plans` row for `(member, today, institute)`, a check-in on it,
then the log. So the launch is: **create the plan row, then hand off to the
Dashboard to check in.**

1. **Already checked in elsewhere?** Refuse with the institute's name, reusing
   the Dashboard's `openElsewhere` wording. FO013 and
   `daily_plans_one_open_visit` would refuse it anyway; saying it first turns a
   dead end into a sentence.
2. **Ask for the purpose.** Never pick it silently — after Area A **the purpose
   is the activity is the metric**. Pre-select the likeliest next step and let
   the rep confirm.
3. **Upsert the plan row** on `(member, date, institute_id)`, the same conflict
   target `addToDailyPlan` uses. **If a row already exists for today and is
   already checked in, do not overwrite its purpose** — navigate to it instead.
   `guard_checkin_cycle_final`/FO014 protects the *delete* path, not a purpose
   update, so this one is the application's to get right.
4. **Redirect to the Dashboard**, anchored on the new entry, where
   `CheckInButton` lives.
5. The follow-up visit runs the ordinary chain and sets a status. **If the new
   status is closed, the institute leaves Pending by itself** — no button, no
   "resolve", nothing to forget. That comes free from §6.2 driving off
   `institutes.status`.

**For an admin, Pending is READ-ONLY.** An admin has no campus
(`enforce_profile_campus`/FO021) and does not do field visits; a launch would
create a plan row on the *admin's* own day, which is not the intent.

**Instead they get "Assign this follow-up"** — wired to the existing
`assignVisit`, institute pre-filled, rep defaulted to whoever the row is
attributed to. It reuses an audited path already guarded by
`guard_plan_assignment`/FO023 to stay inside the rep's campus, and adds no new
writer. **It is Stage 5b, its own small stage**, so Stage 5 stays tight.

> **Flag (F3): this brushes a `CLAUDE.md` rule.** *"The Dashboard owns the
> daily-plan create-and-track flow… a second writer in front of the `daily_plans`
> row rule 2 checks is what screen ownership exists to prevent."* The resolution
> is step 4: Pending **seeds** a plan row and immediately hands over; it never
> owns check-in, never owns logging and never tracks. There is still exactly one
> screen where a visit is tracked. `assignVisit` is already a second writer under
> the same reasoning. `CLAUDE.md` needs a paragraph saying so, or the next reader
> will treat this as drift.

---

## 7. Migration design

**Three migrations, exactly one of them deploy-coupled**, plus an optional
comment-only file. `close_visit()` is not touched; `log_visit()` is touched by
body only.

**0023 is already spoken for** — `0023_follow_up_date_only.sql`, the D2 reversal
(§4.6). It shipped as a follow-up to Stage 1 rather than as part of any stage
below, which is why the numbering here starts at 0024.

### 0024 — purposes become typed *(additive; safe at any time)* — **BUILT**

Shipped as `supabase/migrations/0024_typed_purposes.sql`. It is **narrower than
the design below**: it adds `activity` only, and deliberately leaves `lifecycle`,
`requires_note`, `is_active`, `sort_order`, `daily_plans.purpose_id` and
`daily_plans.purpose_note` to 0026, which is the file that seeds the four new
purposes anyway. The chain is forward-only, so none of them needs 0024 reopened.

⚠ **`lifecycle` is the one that blocks Stage 3.** Without it "Fix a session" and
"Complete a session" both map to `session` and are indistinguishable, so Set/Done
cannot be derived from the purpose. 0026 must add it, back-fill Set/Done for the
four existing session and campus-visit purposes, and carry it on the four it
seeds.

The design as originally planned, for 0026 to finish:

```sql
alter table public.purposes
  add column activity      text,
  add column lifecycle     text,
  add column requires_note boolean not null default false,
  add column is_active     boolean not null default true,
  add column sort_order    integer;

-- backfill the seeded labels from §3.2;
-- any purpose an admin added that this file does not know: default to 'meeting'
--   and RAISE NOTICE naming each one, so the admin reviews it;
-- then: alter column activity set not null

constraint purposes_activity_valid
  check (activity in ('meeting','session','campus_visit','olympiad','application','admission'))

constraint purposes_lifecycle_matches_activity
  check (case when activity in ('session','campus_visit')
              then lifecycle is not null and lifecycle in ('Set','Done')
              else lifecycle is null end)
```

Written with an explicit `case` for the same reason 0001's
`visits_lifecycle_matches_activity` is: a CHECK only rejects FALSE, so the
natural-looking `or` form evaluates to NULL for a session with a null lifecycle
and lets the row straight through.

```sql
alter table public.daily_plans
  add column purpose_id   uuid references public.purposes (id) on delete set null,
  add column purpose_note text;
-- backfill purpose_id from the label
constraint daily_plans_purpose_note_length
  check (purpose_note is null or length(purpose_note) <= 300)
```

**Safe early:** every column is nullable or defaulted, and the live app neither
reads nor writes any of them. The new purposes are **not** seeded here — see
0026.

### 0025 — statuses become data, and `log_visit()` keeps the date *(additive plus a constraint swap; safe at any time)*

1. The new columns on `institute_statuses` (§4.3) and the seed for the nine.
2. Drop `institute_statuses_sort_order_unique`; add a plain index.
3. A `do $$` guard counting values not in the table (probe P1, restated so the
   file stands on its own), raising a sentence rather than half-applying.
4. `institutes_status_valid` → `institutes_status_fk`;
   `visits_status_set_to_valid` → `visits_status_set_to_fk`, both `restrict`
   (§4.2 / D8).
5. Explicit `revoke` / `grant` plus the three admin write policies (§4.4).
6. **D3: `log_visit()` reproduced in full with the one changed `case`**, same
   signature, so there is exactly one overload and the grants survive. A
   loosening, which is why it is safe in this file rather than the next.
7. A closing assertion block: both FKs exist and are `restrict`, the nine rows
   are present with their categories and tones, `institute_status_is_open()`
   still answers correctly, and `log_visit` / `close_visit` still have exactly
   one overload each — 0022's pattern, because that is the check that catches an
   accident.

**Safe early, with one rule (F5):** the live app's status dropdown is hard-coded,
so it cannot offer a status it does not know and cannot break. **But no status
may be added until Stage 4a is live.** A status added early would show as an
unstyled "neutral" badge, would make `isClosedStatus()` false so the picker stops
warning about a closed institute, and would be rejected by the old `visitSchema`.
Not corrupting — confusing. Apply 0025 early; ship the admin panel with 4b.

### 0026 — the tightening *(deploy-coupled: apply immediately before the deploy)*

Two statements:

1. `enforce_status_required()` → **FO0xx**, `before insert on public.visits`
   (§4.7 / D9). ⚠ Applied early, every "No change" on the live app fails.
2. Seed the four new purposes — *Follow-up*, *Olympiad registration*,
   *Application forms*, *Admissions* — each with its `activity` / `lifecycle` /
   `requires_note` from §3.2, `on conflict (label) do nothing`.

### 0027 — comment-only retractions *(optional; any time)*

Following 0021's precedent of retracting a notice a later change made untrue:
mark `visit_outcome`, `management_response`, `student_response` and
`institute_interested` dormant, and retract 0022's "live again" note on
`students_reached` (D5) rather than leaving the column describing a field nothing
collects. Can be merged into 0026 if you would rather have three files.

### What needs no migration at all

* The whole of Area C — the four withdrawn fields, the second student count, the
  Yes/No, the camera (§5.1).
* Removing the Activity and Set/Done selectors.
* The whole of Area D, including D7's deletions and D10's assign shortcut.

---

## 8. Conflicts register — what Phase 2 reverses

| # | Conflict | Shipped in | Severity | Resolution |
| --- | --- | --- | --- | --- |
| C1 | The Activity selector is a deliberate answer to stage 3's Q7 | stage 3 | Medium | Delete the control; the vocabulary and every rule keyed on it stay |
| C2 | `PURPOSE_ACTIVITY` maps by editable label and the file says it is fragile | 0001 / stage 3 | Medium | `purposes.activity` + `daily_plans.purpose_id` |
| C3 | Nothing produces a `meeting` once the selector is gone | — | ~~High~~ **Closed** | Probe P3: "First meeting" is live, and maps to `meeting` alongside "Other" (§3.3) |
| C4 | `INSTITUTE_STATUS_CATALOGUE` is the app's source of truth, asserted both directions by an integration test | 0010 | **High** | It becomes the seed; the test becomes a subset assertion; the FK takes over the half that mattered |
| C5 | Two CHECK constraints hard-code the nine statuses | 0001 / 0010 | **High** | Dropped, replaced by FKs to the table that already existed for this |
| C6 | `institute_statuses_sort_order_unique` collides on any admin insert | 0010 | Medium | Dropped; order by `(sort_order, status)` |
| C7 | `status-badge.tsx` has a nine-key colour `Record` | 0010 era | Medium | `tone` column, seeded with today's exact colours |
| C8 | `needsSessionDetail()` / `needsCampusCount()` hard-code two status literals | stage 3 | Medium | `asks_session_detail` / `asks_head_count` |
| C9 | "No change" is offered and `status_set_to` is nullable everywhere | 0001 | **High** | D9: trigger, not NOT NULL — live rows hold null (P2) |
| C10 | The three closing dropdowns were added weeks ago by 0019 | 0019 | Medium | Form-only removal; columns and parameters stay. **No migration** |
| C11 | The second student count was added by 0022 | 0022 | Medium | D5: dormant again, comment-only retraction. **Never a column drop** |
| C12 | "Is a next session set?" duplicates the status, and today it can strand a rep | stage 3 | **High** | D6: remove it; the status drives visibility (§5.3) |
| C13 | The gallery upload is one of two documented routes in `capture-fields.tsx` | stage 3 | Medium | Remove the gallery; **keep the native camera fallback** (F1) |
| C14 | Pending is documented as read-only with no action for anybody | stage 3 | **High** | One action for reps, seed-and-hand-off (F3); admins stay read-only (D10) |
| C15 | `openLoopsByMember()` feeds two screens with the old meaning of "open" | stage 3 | Medium | D7: both screens lose the count; **the function is deleted** |
| C16 | `visit_outcome` / `institute_interested` are the admin review's summary | 0019 | Medium | Remap to the status, as stage 3 remapped it once already |
| C17 | `expected_date` on a Done visit is discarded by `log_visit()` | 0015 | **High** | D3: one `case` expression, same signature, in 0025 |
| C18 | `close_visit()` never writes `follow_up_date`, so the recovery form discards it | 0018/0019 | Medium | §5.3 — the follow-up moves to `visitSchema`; the recovery form stops asking |
| C19 | `RICH_ACTIVITIES` / `needsClosingReport()` are dead code | stage 3 | Low | Delete in Stage 1 |

---

## 9. The guards, and how each is proved still standing

| Guard | Proof |
| --- | --- |
| **Rule 2, the meeting gate** | Existing suite untouched. Add: a plan whose purpose maps to `meeting` still refuses a visit with no plan row |
| **Presence guarantee FO009** | Existing suite untouched — Phase 2 neither widens nor narrows it |
| **Rule 3 / `visits_lifecycle_matches_activity`** | New: every `purposes` row produces an `(activity, lifecycle)` pair the visits CHECK accepts. Assert it **from the table**, so an admin-added purpose is covered |
| **Rule 5 / FO016** | New: a status **added by an admin** and marked open still refuses a visit with no follow-up date and time. This proves §1's claim about the trigger |
| **Rule 7 counting** | Unchanged suite. Add: a week logged purely from purposes tallies identically to the same week logged by picking activities by hand |
| **Rule 12, the photo** | Existing suite untouched; add a source-level assertion that the in-page camera is the only offered route, in the style of `log-visit-form.test.ts` |
| **D3's fix** | New: a Done session with a date keeps it; a Set still stores its own; a one-shot activity still stores none. Plus: `log_visit` still has exactly one overload |
| **Status vocabulary** | Every seeded status exists in the database with its seeded category; every database row has a valid category and tone; `institute_status_is_open()` agrees with the app for every row **the database has** |
| **The FK swap / D8** | New: an unknown status is refused (23503 now, 23514 before); a status **in use** cannot be renamed or deleted; an **unused** one can |
| **Compulsory status / D9** | New: a visit with a null `status_set_to` is refused (FO0xx); a pre-existing null row is still readable and still legal |
| **Campus isolation (0020b)** | **The one to be most careful about.** New: a rep in campus A cannot see a Pending row for an institute in campus B, and cannot launch a follow-up at one. Prove it against the new query, not against `institutes_select` |
| **RLS on Pending** | New: a rep sees only rows attributed to their own visits; an admin sees all and gets no launch action |
| **One overload each** | `log_visit` and `close_visit` still exactly one, per 0015's and 0022's assertions |
| **`close_visit()` is INVOKER** | 0022's assertion block already checks this and is not disturbed |
| **FO011 / FO013 / FO014** | Untouched; existing suites must stay green, especially once Pending starts creating plan rows |

---

## 10. The final stage list

**Seven stages. Each is independently deployable and independently revertible.**
Only Stage 4b is coupled to a migration on the same day.

| # | Stage | Migration | Coupling | Blocked by |
| --- | --- | --- | --- | --- |
| **1** | Closing report + live camera | none | none | nothing — **start here** |
| **2** | Purposes become typed | 0024 | apply any time before | ✅ **built** |
| **3** | The Activity selector goes | 0026 (seed + `lifecycle`) | apply before | Stage 2, and 0026 adding `lifecycle` |
| **4a** | Statuses come from the database | 0025 | apply any time before | nothing |
| **4b** | Admin statuses panel + compulsory status | 0026 part 1 | ⚠ **apply immediately before deploy** | Stage 4a live |
| **5** | Pending reworked | none | none | Stage 4b |
| **5b** | Admin "Assign this follow-up" | none | none | Stage 5 |
| **6** | Docs, tests, size | 0027 (optional) | none | all of the above |

### Stage 1 — closing report + live camera *(no migration)*

Remove the four withdrawn fields and the second student count; remove the Yes/No
and let the status drive the follow-up (fixing the dead end); pre-fill the time;
remove the gallery upload; remap the admin review summary; delete
`RICH_ACTIVITIES`. Full scope in §14.

*Ships alone.* Reverts with `git revert`. Nothing in the database moves, so there
is no ordering hazard at all, and it is net negative on the bundle.

### Stage 2 — purposes become typed *(0024; additive)*

Apply 0024 whenever convenient. Deploy: `PurposesPanel` gains the activity /
lifecycle / free-text controls and a retire action; `activityForPurpose()` reads
the purpose row instead of the label map; `addToDailyPlan` writes `purpose_id`.

**The Activity selector stays**, pre-filled as it is today. Behaviour is
unchanged for a rep; only the source of the prefill moves. This is what de-risks
Stage 3.

### Stage 3 — the selector goes

Seed the new purposes. Deploy: the Activity and Set/Done selects are deleted, the
hidden fields are fed from the plan's purpose, and "Other" shows its free-text
box.

**One precondition, and it is absolute:** every row in `public.purposes`
carries an `activity` — which 0024's `not null` guarantees, with its notice as
the admin's review list (F6).

The seed adds four purposes, none of which exist yet (P3): **Follow-up,
Olympiad registration, Application forms and Admissions** (§3.3 has the table).
It ships *with* the selector's removal rather than before it, because until the
selector goes three of those four metrics are reachable only through it.

### Stage 4a — statuses come from the database *(0025; additive)*

Apply 0025 whenever convenient. Deploy: the catalogue becomes the seed, the
status helpers take a catalogue argument, `visitSchema` becomes a factory, the
badge reads `tone`, the conditional fields read `asks_*`, and D4's date field
appears on a Done session — which is what 0025's `log_visit()` fix is for.

Apart from that one new field, **nothing visible changes** — the same nine
statuses, categories, colours and conditional fields. That is the point: a
substitution of the source, proved by everything else looking identical.

### Stage 4b — admin statuses panel + compulsory status *(0026 part 1)*

Deploy the panel and the compulsory status **with** 0026's trigger, applied
immediately before. The only tightly coupled pair in the plan:

* trigger before deploy → every "No change" on the live app fails;
* deploy before trigger → a window in which a visit can still be saved with no
  status, and Area D's premise quietly has holes in it.

Apply, then deploy, close together — the instruction 0018, 0019 and 0022 all
carry.

### Stage 5 — Pending *(no migration)*

The new query, the retitled sections, the rep launch flow and its guards, and
D7's deletions: both "open loops" counts and `openLoopsByMember()` itself.

### Stage 5b — admin "Assign this follow-up" *(no migration)*

The one admin action on Pending, wired to the existing `assignVisit`. Separate so
Stage 5 stays tight; skip it entirely if read-only is enough.

### Stage 6 — documentation, tests and size

`CLAUDE.md` needs real edits, not a note: the screen-ownership paragraph (F3),
the "Pending is a read-only notice board" paragraph, the closing-report
field-set paragraph, the two-student-counts paragraph (D5), the photo paragraph
("the photo arrives one of two ways"), Rule 4's "nine fixed values" language
throughout, and a new paragraph stating §1's asymmetry — the decision the next
reader will most want explained. `docs/feedback-mapping.md` Q18/Q19/Q20 can be
marked answered. Measure the bundle.

### Rollback, per stage

| Stage | Revert |
| --- | --- |
| 1, 3, 5, 5b | `git revert`. No schema dependency |
| 2 | `git revert`. 0024's columns are additive and harmless when unread |
| 4a | `git revert`. 0025's columns, FKs and `log_visit` fix are all harmless when unread — **unless a status has been added**, in which case the old app cannot render it. This is why the panel is not in 4a |
| 4b | `git revert` **and** drop the status-required trigger — otherwise the reverted app's "No change" is refused |

---

## 11. Size

The budget is **3072 KiB gzipped, currently 2966 KiB — about 106 KiB spare**, and
`CLAUDE.md` warns that figure has been wrong in both directions. Measure before
and after:

```bash
npm run build && npx wrangler deploy --dry-run --outdir /tmp/out   # "Total Upload:"
```

| | estimated Δ |
| --- | --- |
| **Stage 1**: three `Picker`s, two `Choice`s, one number input and three vocabulary arrays leave the client bundle | **−3 to −6 KiB** |
| **Stage 1**: the gallery upload path | **< −1 KiB** |
| **Stage 3**: the Activity and Set/Done `<Select>`s | **−1 to −2 KiB** |
| **Stage 4a**: status list moves from a compile-time constant to props | ~0 (less JS, slightly more RSC payload) |
| **Stage 4b**: admin statuses panel (a sibling of `PurposesPanel`) | **+4 to +8 KiB** |
| **Stage 2**: purposes panel gains activity / lifecycle / note controls | **+1 KiB** |
| **Stage 5**: Pending launch sheet | **+3 to +5 KiB** |
| **Stage 5**: two snapshot tiles and a query deleted | **−1 KiB** |
| **Net estimate** | **roughly flat; worst case +8 KiB** |

**Ceiling risk: low.** No new dependency is needed for anything in Phase 2.
Measure at Stage 4b, the one that only adds.

---

## 12. Decision record — all ten, locked

| # | Decision | Answer | What it costs |
| --- | --- | --- | --- |
| **D1** | What produces a `meeting` | No new "Meeting" purpose. Existing purposes declare their activity: **"First meeting" and "Other" → `meeting`**; session and campus-visit purposes → their pair. 0026 seeds four more: **Follow-up → `meeting`**, Olympiad → `olympiad`, Application → `application`, Admissions → `admission`. Admin-added purposes each declare one of the six | **Fully resolved.** Probe P3 (2026-09-15): six live rows, "First meeting" among them, so Meetings keeps a source with or without the seed (§3.3) |
| **D2** | Follow-up date, or date and time | **DATE ONLY.** Originally "both, pre-filled"; the client reversed it after Stage 1 was live | Migration **0023** — replaces `enforce_follow_up_when_open()`. A pure loosening, so safe to apply any time. `follow_up_time` dormant, not dropped |
| **D3** | Save the date on a Done session / campus visit | **Yes.** `log_visit()`'s one `case` expression, same signature | One function body in 0025. A loosening, so safe early |
| **D4** | Who owns the date field | **One field.** Purpose says Set → required, "Tentative…". Status asks and purpose says Done → optional, pre-filled with today, "Session date" | `expectedDateLabel()` gains the lifecycle as an argument |
| **D5** | One student count or two | **One.** `students_reached` dormant, reversibly | App-only. A comment-only retraction of 0022 |
| **D6** | Keep "Is a next session set?" | **Remove it.** The status drives visibility | Fixes a live dead end, and exposes C18 — the recovery form's discarded follow-up (§5.3) |
| **D7** | The "open loops" counts | **Remove both** — Dashboard tile and Team column — and delete `openLoopsByMember()` | App-only. `openLoopsAt()` and the Set→Done arithmetic are untouched |
| **D8** | Rename or delete a status | **The FKs decide.** `on update/delete restrict`: unused renames and deletes cleanly, in-use is refused with a friendly message; retire via `is_active` | No extra guard code — the constraint *is* the rule |
| **D9** | Compulsory status | **Trigger**, INSERT-only, so existing null rows stay legal | The one deploy-coupled statement (F4) |
| **D10** | Admin Pending | **Read-only**, plus "Assign this follow-up" as Stage 5b | Reuses `assignVisit` and FO023; adds no new writer |

---

## 13. Flags — things that would break the running app

| | |
| --- | --- |
| **F1** | Removing the native `capture="environment"` fallback along with the gallery button. Rule 12 blocks the save, so a device where `getUserMedia` fails cannot log a visit **at all**. Desktop has no route either way — say so rather than let an admin discover it |
| **F2** | If Pending's dedupe is ever built as a SQL view it **must** be `with (security_invoker = true)`, or it runs as owner and defeats both the per-rep RLS and 0020b's campus boundary in one line |
| **F3** | Pending's launch action is a second writer in front of `daily_plans`, which `CLAUDE.md` names as the thing screen ownership exists to prevent. The resolution — seed and hand off, never track — has to be written into `CLAUDE.md`, or it reads as drift |
| **F4** | Applying 0026's compulsory-status trigger before the deploy breaks every "No change" on the live app. It is the only statement in the plan with that property |
| **F5** | Adding a status before Stage 4a is live leaves it unrenderable and unvalidatable by any client still holding the hard-coded catalogue |
| **F6** | Removing the Activity selector before **every** purpose has an activity leaves a plan entry that cannot be logged at all. Also: removing it before 0026 seeds Olympiad / Application / Admissions makes those three metrics unreachable, which is why the seed and the removal are one stage |
| **F7** | `institute_statuses_sort_order_unique` will reject an admin's second status with a raw 23505 unless it is dropped in 0025 |
| **F8** | Deleting a purpose (rather than retiring it) leaves `purpose_id` null and the activity unresolvable for any plan row not yet logged |
| **F9** | The CHECK→FK swap fails to build if probe P1 finds any status outside the nine. Guard it, or the migration half-applies |
| **F10** | `getUnreportedVisits()` is the only route back to a visit whose report never landed once the day rolls over. Removing that block from Pending can strand a rep, still checked in, for a day |

---

## 14. Stage 1 scope, in full

**No migration. No schema dependency. Reverts with `git revert`.**

### Remove

| Field | File |
| --- | --- |
| "Is the institute interested?" yes/no | `feedback-fields.tsx`, `validation/feedback.ts` |
| "How did the visit end?" dropdown | same |
| "How did management respond?" dropdown | same |
| "How did the students respond?" dropdown | same |
| "Students who participated" (D5) | same — and the participated ≤ present refine goes with it |
| "Is a next session or meeting set?" (D6) | same |
| "Upload photo" button, `uploadRef`, its file input and handler | `capture-fields.tsx` |
| `RICH_ACTIVITIES`, `needsClosingReport()` — dead | `validation/closing-report.ts` |

### Change

* **Relabel** the notes box and its section to "How did it go?"; the remaining
  count to a single "Number of students", keeping the contextual help line
  ("Everyone who was in the room" / "…who came to see the campus").
* **Follow-up visibility** now comes from `followUpRequired(status)`, which the
  component already receives: open → shown and required; closed or none → shown
  and optional. This is what fixes the dead end in §5.3.
* **Pre-fill the time** (D2) when a follow-up date is first chosen.
* **Move `follow_up_date` / `follow_up_time` out of the feedback schema** into
  `visitSchema`, where the rule already lives, and stop asking for them on the
  feedback-only recovery form, which cannot save them (C18). *Say if you want
  this deferred and Stage 1 kept to deletions only.*
* **`feedback-actions.ts`**: pass explicit `null` for `p_institute_interested`,
  `p_visit_outcome`, `p_management_response`, `p_student_response` and
  `p_students_reached` at both call sites, each with a one-line comment saying
  the column is dormant — so a reader sees a decision, not an omission.
* **`capture-fields.tsx`**: the module comment documents "two ways, and only
  these two". Rewrite it for one way plus the native fallback, including F1's
  desktop note. The single Take-photo button goes full width.
* **Admin review summary** (C16): remap `visit_outcome` / `institute_interested`
  to the status the visit set, in `admin-workspace.ts` and `visit-review.tsx`.

### Keep, explicitly

`met_name` / `met_phone`; `students_attended`; `session_topic` /
`session_taken_by`; the `closes_visit_id` open-loop offer; the hidden
`capture="environment"` input; every withdrawn column and every `close_visit()`
parameter; `VISIT_OUTCOMES` / `MANAGEMENT_RESPONSES` / `STUDENT_RESPONSES` in
`validation/feedback.ts`, because `report-view.tsx` still renders old reports —
they simply stop reaching the client bundle.

### Tests and docs

* `tests/unit/feedback.test.ts` — the `next_meeting_set` rule and the
  two-count rule both go; replace with the status-driven follow-up rule.
* New source-level assertion that the gallery route is gone, in the style of
  `tests/unit/log-visit-form.test.ts`.
* `CLAUDE.md`: the closing-report field-set paragraph, the two-student-counts
  paragraph, and the "photo arrives one of two ways" paragraph.
* Optional: write 0027 now (comment-only) so `students_reached` stops describing
  a field nothing collects.

### Expected size

**Net negative, −3 to −7 KiB.** Measure before and after.

---

**Stop here for review.** Nothing has been built. §10 is the order; §14 is what
Stage 1 touches.
