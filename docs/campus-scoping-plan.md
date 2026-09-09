# Part C — hard campus scoping: analysis & build plan

**Analysis only. No code, no migration.** This one is a security boundary rather
than a feature: a missed policy is not a bug that looks wrong on a screen, it is
a Bangalore rep reading Gandhinagar's pipeline. So the RLS section below is
written to be exhaustive, and every table in the database is accounted for —
including the ones that turn out not to need changing, because "we checked and
it does not apply" and "we forgot" look identical in a list that only names the
tables that changed.

---

## 0. The finding that changes the shape of this — read first

**The two institutes in the database are not two of your five.**

| In `public.institutes` today | |
| --- | --- |
| `AMIT` | Ahmedabad, type `school` |
| `Airport School Ahmedabad` | Ahmedabad, type `school` |

Neither is Karnavati, UID, S-Vysha, G.D. Goenka or IQ City. They are **prospect
schools a rep visits** — sumit registered them, logged visits at them, and
photographed them.

Your five are the **university's own campuses** — the places reps work *from*.
`institutes` is the pipeline of schools they work *on*. Those are two different
kinds of thing that happen to share the word "institute", and the brief's
"2 already exist in the DB; don't duplicate" rests on them being the same.

This matters beyond bookkeeping. If the five went into `institutes`:

- they would appear in the daily-plan picker, so a rep could plan a visit to
  their own campus and check in there;
- each would carry one of the nine pipeline statuses ("First meeting done"), a
  registered_by, a status history — none of which means anything for your own
  premises;
- `institutes.campus_id` would have to point at a row in its own table, and the
  five would have to point at themselves;
- deleting or reassigning a campus would collide with `ON DELETE RESTRICT` from
  every visit ever logged.

**So the scoping unit is a new `public.campuses` table holding your five, and
`institutes` stays what it is: the prospect pipeline, now owned by a campus.**

Everything below follows from that. If the intent really was that reps visit
each other's campuses as prospects, say so — the plan changes substantially and
Q1 is the place to answer it.

---

## 1. Data model

### 1.1 The scoping unit is a CAMPUS, not a city and not an institute

You asked whether the unit is each of the five rows or a city that groups them.
**Neither collapses correctly:**

- **City fails.** Two of the five are both Gandhinagar — *Karnavati University
  Gandhinagar Campus* and *UID - Karnavati University Gandhinagar Campus*. A
  city key would merge them, and the requirement is one rep to exactly one
  campus.
- **The existing `institutes` table fails**, for §0's reasons.

A campus is its own entity with its own city, and two campuses may share a city.
That is exactly what a lookup table is for.

```
public.campuses
  id          uuid pk
  name        text not null unique      -- the five, exactly as written
  city        text not null             -- Gandhinagar, Bangalore, Delhi NCR, Kolkata
  short_name  text                      -- for a nav badge; optional
  active      boolean not null default true
  created_at  timestamptz not null default now()
```

Five seeded rows, and a lookup table rather than a CHECK-constrained text
column for one reason that has already bitten this codebase: 0010 had to name
the nine institute statuses in four places and then write an assertion block to
stop the copies drifting, because *a CHECK cannot contain a subquery*. Campuses
will be referenced by two foreign keys and a dropdown; a table gives one
authority and referential integrity for free.

### 1.2 Two new columns, and they are not symmetrical

| Column | Meaning | Nullable? |
| --- | --- | --- |
| `profiles.campus_id` | the campus this **rep** belongs to | **nullable** — see below |
| `institutes.campus_id` | the campus that **owns this prospect** | nullable + backfilled |

**`profiles.campus_id` must stay nullable, and that is a decision rather than a
concession.** An **admin has no campus** — they see everything, and forcing them
to pick one would either be a lie or would make `is_admin()` and the campus
predicate contradict each other. So:

- rep → campus required (enforced by a trigger, §4)
- admin → campus null

This is the shape `is_admin()` already implies, and it keeps the two ideas
orthogonal: role decides *whether* you are scoped, campus decides *to what*.

### 1.3 The predicate function

One `SECURITY DEFINER` helper beside `is_admin()`, following it exactly — it
reads `public.profiles`, and policies **on** `profiles` will reference it, so
without definer rights the two recurse:

```
public.my_campus() returns uuid   -- the caller's campus, null for an admin
```

Every policy then reads the same way, and there is one definition of "my
campus" rather than a subquery copied into fifteen policies:

```
using (public.is_admin() or campus_id = public.my_campus())
```

**`public.is_admin()` is not touched.** Admin visibility is unchanged
everywhere, which is what keeps this reviewable: the admin half of every policy
is the half that already existed.

---

## 2. RLS — every table, and why

This is the core. Below is **every table in the database**, not only the ones
that change, because the audit's M-3 finding was three tables nobody had listed.

### 2.1 Scoped by campus (the new boundary)

| Table | Today | Becomes | Note |
| --- | --- | --- | --- |
| `institutes` | `select using (true)` | `is_admin() or campus_id = my_campus()` | **The reversal.** §3 |
| `institutes` | `insert with check (registered_by = auth.uid())` | ...**and** `campus_id = my_campus()` | A rep cannot register into another campus |
| `institutes` | `update using (true) with check (true)` | `is_admin() or campus_id = my_campus()` on **both** | Today any rep may edit any institute |
| `institutes` | `delete using (is_admin())` | unchanged | |
| `institute_status_history` | `select using (true)` | `is_admin() or` the parent institute is in my campus | **Currently the whole registry's journey is readable by every rep.** A quiet leak: names, statuses and dates, without touching `institutes` |
| `materials` | `select using (true)` | see Q3 — recommend `campus_id` nullable, null = shared | Library is admin-written, all-read today |
| `materials` storage objects | `bucket_id = 'materials'` | must mirror whatever `materials` does, or the row is hidden and the file is not | Two layers, one rule |

### 2.2 Already tighter than campus — no change needed, and stated so

These are `member = auth.uid() or is_admin()` today. Member scoping is
**strictly stronger** than campus scoping while a rep belongs to one campus, so
none of them leaks across a campus boundary and none needs a campus predicate:

`visits` · `daily_plans` · `targets` · `visit_people` (via its parent visit) ·
`visit-photos` storage objects (foldername = uid).

**But they are only safe as long as the join is.** A rep's own visit row carries
`institute_id`; if a query joins `institutes(name)` and the institute policy is
open, the name of a *foreign* institute could still surface on their own row —
which is impossible in practice (their visits are at their own institutes) but
is the shape to check after the institutes policy tightens, because a join
against a table the caller cannot read returns **null**, not an error. §9.

**One judgement to confirm (Q4):** with campus scoping, should two reps at the
same campus see *each other's* visits? Today they cannot. Leaving it as member
scoping is the safe default and needs no work; widening it to campus is a
deliberate loosening.

### 2.3 Shared reference data — deliberately NOT scoped

Naming them so the decision is on the record:

`purposes` (admin-managed list, five values) · `location_states` /
`location_cities` / `location_areas` (the India geography tree — a Bangalore rep
needs Karnataka's cities) · `pincodes_cache` (India Post lookups) ·
`place_cache` (OpenStreetMap area names, keyed by rounded coordinates) ·
`institute_statuses` (the nine-value vocabulary).

None carries campus-identifying information. `place_cache` deserves one moment's
thought — it is keyed by coordinate cell, so in principle a rep could enumerate
cells and learn *that somebody looked one up*. It contains no institute, member
or visit reference, and it is already a shared cache written by the server. Not
worth scoping; worth having been asked.

### 2.4 Admin-only or system tables — unchanged

`profiles` (own-or-admin; see §5) · `photo_purge_runs` · `checkin_sweep_runs` ·
`weekly_targets_pre_0013` (dormant) · `targets` (dormant since stage 2).

### 2.5 Application surfaces to re-derive, screen by screen

RLS is the boundary; these are the places that must also *make sense* once it
bites. A screen that silently shows nothing is a support ticket, not a leak, but
it is still a defect.

| Surface | File | What changes |
| --- | --- | --- |
| Institutes list | `institutes.ts:listInstitutes` | Returns only the campus's. No code change — RLS does it — but the empty state must say why |
| Institute detail | `institutes.ts:getInstitute` | A cross-campus id becomes `null` → must render as not-found, not as a crash |
| Daily-plan picker | `visits.ts:listInstitutesForPicker` | Scoped by RLS automatically |
| Log Visit | `visits.ts` + the Stage 3 flow | Institute comes from the plan row, which came from the picker — already scoped |
| Pending | `visits.ts:getPendingVisits` | Member-scoped already |
| Dashboard | `page.tsx`, `week-summary.ts` | Member-scoped already |
| Activity report | `activity-report.ts` | Member-scoped; the `institutes(name)` join needs §9's null check |
| Admin Review | `admin-workspace.ts:listTeamVisits` | Admin sees all — unchanged |
| Admin Overview | `admin-workspace.ts:getOverview` | Unchanged; consider a per-campus breakdown later (Q6) |
| `/team` | `week-summary.ts:getTeamWeek` | Admin-only screen; add a campus column so the roster is readable |
| Materials | `materials.ts` | Depends on Q3 |
| Assign | `admin-workspace.ts` + `assignVisit` | §7 |

---

## 3. The shared-registry reversal — what assumed it, and what breaks

`institutes_select using (true)` is not an oversight; 0016 §3 states it as a
decision: *"the institute list is a shared registry, and Rule 4 says a status is
set by hand by whoever visited, not only by whoever registered the school."*
Reversing it touches five things.

**1. Reopen-closed (feature D) — unaffected.** Re-planning a closed institute is
`daily_plans` + the picker; both are inside one campus. The integration suite's
reopen tests stay true.

**2. The N-1 rule / `registered_by` — unaffected but now redundant in part.**
`institutes_guard_owner` (FO010) stops a rep reassigning ownership. Campus
scoping stops them *seeing* another campus's institute at all, so FO010's reach
shrinks to within-campus. **Keep it.** It is one trigger, it is audited, and it
still does real work between two reps on one campus.

**3. `institutes_update using (true)` — this is the sharp one.** Today **any rep
may edit any institute**: name, contacts, status. That was defensible for a
shared registry and is indefensible with hard isolation, and it is easy to miss
because the *select* policy is the one everyone thinks about. Both `using` and
`with check` must be scoped, or a rep who guesses a uuid can rewrite another
campus's school without ever being able to read it.

**4. The meeting gate — unaffected, and worth stating why.**
`enforce_meeting_gate()` and `enforce_checkin_before_visit()` are
`SECURITY DEFINER` and look up `daily_plans` by `(member, date, institute_id)`.
They **bypass RLS by design**, which is what makes them a guarantee rather than
a convenience. Campus scoping neither weakens nor is weakened by them: the plan
row was created through a scoped picker, so the gate is checking a row that was
already inside the campus. **No trigger changes.**

**5. `log_visit()` and `close_visit()` — unaffected, and this is load-bearing.**
Both are `SECURITY INVOKER`, so they run as the rep and every new policy applies
inside them automatically. A rep passing a foreign `institute_id` to
`log_visit()` fails the institutes read *inside the function's own transaction*.
**This is why the RPCs must stay INVOKER**; a DEFINER rewrite would punch a hole
straight through campus scoping, and §9 lists it as a guard.

---

## 4. Existing data — nullable, backfill, then a trigger

Follow the pattern that has worked three times now (0016's pre-flight counts,
0018's triggers-not-constraints):

**Step 1 — add nullable.** `profiles.campus_id` and `institutes.campus_id` both
nullable, so not one existing row has to change and nothing can fail on
application.

**Step 2 — seed the five campuses.** §6.

**Step 3 — backfill.** Both existing institutes are Ahmedabad schools. Ahmedabad
is ~25 km from Gandhinagar and they were registered by sumit, so
**`Karnavati University Gandhinagar Campus` is the sensible home** — but it is a
guess about your business, so it is Q2 rather than something I assign. sumit
(the only rep) gets the same campus. The two admins get `null`.

**Step 4 — enforce going forward with a TRIGGER, not NOT NULL.** Three reasons,
and the first is decisive:

- an admin legitimately has `campus_id = null`, so `NOT NULL` on `profiles` is
  simply wrong;
- a `NOT NULL` validates every existing row at the moment it is added, and the
  backfill in step 3 is a guess we may want to correct;
- the rule is conditional — *reps* need one — and a conditional rule is a
  trigger or a CHECK, and a CHECK on `profiles` would have to read `role` from
  the same row, which it can (so a CHECK is possible here) — but the
  `institutes` half genuinely cannot be a CHECK, because whether a row is
  "new" is not visible to one.

So: `enforce_profile_campus()` — a rep must have a campus — and
`enforce_institute_campus()` — a new institute must have one, defaulting to
`my_campus()` when the caller is a rep and it was not supplied. INSERT and
UPDATE, raising mapped `FO0xx` codes. Existing rows are never re-examined, which
is the whole reason 0018 used triggers.

**Pre-flight, 0016-style:** count the rows that would violate each rule before
adding it, and put the counts in the migration header.

---

## 5. Admin add-rep

`newMemberSchema` is `{ name, email, password, role }`. It gains
`campus_id`, required when `role === "rep"` and forbidden when
`role === "admin"` — a `superRefine`, mirroring the trigger so the admin gets a
sentence rather than a constraint rejection.

`createMember` (`admin-actions.ts:261`) creates the auth user, then inserts the
profile; the campus goes in that insert. `team-panel.tsx` gains a dropdown that
appears when the role is rep.

**Two things this exposes that are not in the brief:**

- **The three existing accounts have no campus.** sumit needs one assigned
  before scoping bites, or that rep sees nothing at all. Step 3's backfill
  covers it, but it must land in the *same* migration.
- **Nothing today lets an admin CHANGE a rep's campus.** People move. Without
  it the only remedy is SQL. Recommend a campus column plus an edit control on
  the Team panel in the same build — see Q5.

---

## 6. Seeding the five

None of the five exists, so there is nothing to reconcile — the "don't
duplicate" concern does not arise (§0). Seed all five into `public.campuses`,
idempotently (`on conflict (name) do nothing`), so a re-run is a no-op.

**Spelling — one I would not correct without you.** The other four read as
consistent with real institutions; #3 does not:

| # | As given | Note |
| --- | --- | --- |
| 1 | Karnavati University Gandhinagar Campus | reads correct |
| 2 | UID - Karnavati University Gandhinagar Campus | reads correct (UID = Unitedworld Institute of Design) |
| 3 | **UID - S-Vysha University Bangalore Campus** | **"S-Vysha" is very likely "S-VYASA"** (Swami Vivekananda Yoga Anusandhana Samsthana, Bangalore). I have not corrected it — see Q7 |
| 4 | UID - G.D. Goenka University Delhi NCR Campus | reads correct |
| 5 | IQ City UWSB Kolkata Campus | reads correct (UWSB = Unitedworld School of Business) |

I would rather ask than silently rename a real organisation in seed data that
becomes a `unique` key. Cities: Gandhinagar ×2, Bangalore, Delhi NCR, Kolkata.

---

## 7. Admin-assign across campuses

`assignVisit` puts a row on another member's `daily_plans` with
`assigned_by = auth.uid()`, guarded by `guard_plan_assignment()` (0005) and the
`daily_plans_insert` policy.

**Nothing today stops an admin assigning a Kolkata institute to a Bangalore
rep**, and after scoping that rep would see a plan entry for an institute they
cannot open — a broken row rather than a leak, but broken.

**Recommend refusing it**, in three places to match the house pattern: the
`assignVisitSchema` (a sentence), the server action (the check), and a trigger
extension to `guard_plan_assignment()` (the guarantee). The admin UI should also
filter the institute picker to the chosen rep's campus, which turns the refusal
into something they never hit. See Q8 for whether a deliberate cross-campus
assignment should ever be possible.

---

## 8. Migration, build order, size, deploy

### 8.1 Migration 0020 — one file

1. `public.campuses` + seed the five (idempotent)
2. `profiles.campus_id`, `institutes.campus_id` — both nullable FKs
3. `public.my_campus()` — SECURITY DEFINER, beside `is_admin()`
4. Backfill (Q2's answer) — institutes and sumit
5. Replace `institutes_select` / `_insert` / `_update`
6. Replace `institute_status_history_select`
7. `materials` + its storage policy, per Q3
8. `enforce_profile_campus()` / `enforce_institute_campus()` triggers
9. Extend `guard_plan_assignment()` for §7
10. Index `institutes(campus_id)` and `profiles(campus_id)`
11. Assertion block: the five seeded; `my_campus()` exists; **`is_admin()`,
    `enforce_meeting_gate`, `visits_require_checkin`, `daily_plans_checkin_final`
    and the single `log_visit` / `close_visit` overloads all still present**

### 8.2 Build order

- **Step 0** — 0020 written and rehearsed on a fresh database. Not applied.
- **Step 1** — `campuses` + the two columns + `my_campus()` + seed + backfill,
  with **no policy changes yet**. Additive and invisible; safe to apply early.
- **Step 2** — admin surfaces: add-rep dropdown, Team column, the edit control.
  Still no policy change, so an admin can set every campus correctly *before*
  anything depends on it. **This ordering is the point of splitting the
  migration in two** (see 8.4).
- **Step 3** — the policy flip and the triggers.
- **Step 4** — the screens: empty states, not-found handling, the assign filter.
- **Step 5** — tests: a second rep on a second campus in the integration suite,
  asserting they cannot read the first's institutes, history, picker or detail.

### 8.3 Size

Negligible — a dropdown, a column, a few strings. No new dependency. Currently
**2875 KiB of 3072**, ~197 KiB spare; expect single-digit KiB.

### 8.4 Deploy ordering, and a real hazard

**Splitting 0020 into 0020a (additive) and 0020b (the policy flip) is strongly
recommended**, because the two have opposite failure modes:

- Apply the **policy flip** before every rep has a campus and those reps see
  **nothing at all** — empty picker, empty institutes, and the meeting gate
  refusing every visit because they cannot reach an institute to plan one. That
  is a total outage for anyone unassigned.
- Apply the **additive half** early and nothing changes for anyone.

So: apply 0020a → deploy the admin UI → **assign every rep a campus and verify
none is null** → apply 0020b → deploy the rest. The gate between them is a
query, not a judgement:

```
select count(*) from public.profiles where role = 'rep' and campus_id is null;
```

Zero, or do not proceed.

---

## 9. What could break — the audited guards and the Stage 3 flow

| Guard | Risk | Mitigation |
| --- | --- | --- |
| **Meeting gate (Rule 2)** | None. DEFINER, bypasses RLS by design | Do not touch. Assert it still exists |
| **Presence guarantee FO009** | None, same reason | Assert |
| **Rule 12 photo / FO008** | None | Assert |
| **FO011 write-once arrival** | None | Assert |
| **`log_visit()` / `close_visit()` INVOKER** | **High if ever changed.** INVOKER is what makes campus scoping apply *inside* the RPCs. A DEFINER rewrite silently disables it | Assert INVOKER; state it in `CLAUDE.md` |
| **Single overload of each RPC** | 0015's failure mode. 0020 must not touch either signature | Assert `count = 1` for both |
| **Stage 3 forced chain** | Medium. The chain starts at the picker, which is now scoped. A rep with no campus gets an empty picker and **cannot start any visit** | The 8.4 gate |
| **`getInstitute()` cross-campus** | Returns `null` after scoping; the detail page must 404, not throw | Step 4 |
| **PostgREST joins** | `institutes(name)` against an unreadable row yields **null, not an error** — so a name silently becomes "Unknown institute" rather than failing loudly | Audit each of the five join sites in §2.5 |
| **Nightly sweep / purge** | DEFINER, no `auth.uid()`, so `my_campus()` is null inside them. They must not gain a campus predicate | Leave alone; note it |
| **Backup / restore** | `campuses` is a **new table**, so `npm run backup` will refuse to run until it is in `BACKUP_TABLES` — exactly as it did for `checkin_sweep_runs` | Add it in the same commit. It is real data, not telemetry: **back it up** |

---

## 10. Open questions

**Q1 (blocking) — is §0 right?** Are the five the university's own campuses
(reps work *from* them) rather than prospects they visit? The whole model turns
on this.

**Q2 (blocking) — where do the two existing Ahmedabad schools and sumit belong?**
Karnavati Gandhinagar is my guess; it is your business, not mine.

**Q3 — materials.** Shared library, or per-campus? Recommend `materials.campus_id`
nullable where **null means "everyone"**, so today's library keeps working
untouched and a campus-specific poster becomes possible. Whatever is chosen must
be applied to **both** the table and its storage policy.

**Q4 — do two reps on one campus see each other's visits?** Today they cannot
(member scoping). Leaving it is safe and free; widening it is deliberate.

**Q5 — can an admin move a rep between campuses?** Nothing allows it today.
Recommend building it now; without it a transfer needs SQL.

**Q6 — should `/team` and Overview group by campus?** Not required for
isolation. With five campuses a roster of five groups reads far better than a
flat list, but it is presentation and can wait.

**Q7 — "S-Vysha".** Confirm the spelling before it becomes a unique key.

**Q8 — cross-campus assignment.** Refuse outright (recommended), or allow an
admin to do it deliberately for a rep covering two regions?

**Q9 — the two Gandhinagar campuses.** They share a city. Do their reps share a
prospect pool, or is each school owned by exactly one of the two? Hard isolation
as specified says the latter — which means two reps in one city could each
approach the same school without seeing the other's history. Worth confirming
that is intended.
