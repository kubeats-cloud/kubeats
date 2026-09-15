# Rep-owned institutes — plan & migration design

**All six decisions are locked** (§14); this is the version to build from.
Steps 1–3 are application-only and land before the migration.

This layers a second, tighter boundary
inside the campus boundary 0020b established: an institute belongs to the rep
who registered it, and no other rep sees it — not even one on the same campus.

The app is LIVE. Section 12 is the build order that reflects that.

Read alongside `CLAUDE.md` (campus scoping is a security boundary, not a
filter), `docs/campus-scoping-plan.md`, and `docs/phase2-flow-rework-plan.md`
§6, because Stage 5's Pending is the screen this changes most.

---

## 0. The headline, before anything else

> **Every institute read in the app goes through RLS with no explicit filter.
> So this is one policy change, and the application barely moves.**

All eight institute queries — the registry list, the detail page, the daily-plan
picker, the assign picker, Stage 5's Pending, the batched name lookup, the
report's institute block, the admin's usage counts — say `from("institutes")`
and let the policy decide. Narrow the policy and every one of them narrows with
it, in the same request, with no chance of a caller being forgotten.

That is worth stating first because it is the opposite of the usual shape of an
access-control change, and it is what makes this feature small. What is NOT
small is the handful of places where the *consequences* land: Pending's meaning,
reassignment, and two gaps that already exist and get sharper.

---

## 1. The rule

| | Sees | May edit | May reassign |
| --- | --- | --- | --- |
| **Rep** | only institutes they registered, **within their campus** | the same set | never |
| **Admin** | every institute, in every campus | every institute | yes — but only to a rep **on that institute's campus** |

Campus stays the outer guardrail. Ownership is the inner one. A rep must satisfy
**both**.

> **D-A — LOCKED: strict AND.**
> `registered_by` normally implies the campus, because a rep can only register
> into their own (`institutes_insert`, 0020b §1). The two can drift exactly once:
> an admin moves an institute to another campus, or moves a REP to another
> campus, without changing the owner.
> The client's rule is "stacks on campus", and it means a rep transferred to
> another campus stops seeing the institutes they registered in the old one —
> which is what a campus boundary is *for*. The consequence is accepted and
> stated: transferring a rep orphans their pipeline until an admin reassigns it.
> §7's admin surface is what makes that visible rather than mysterious, and
> §7's owner filter (D-F) is what makes working through it bearable.

---

## 2. The RLS change, exactly

### `institutes_select`

```sql
-- now
using (public.is_admin() or campus_id = public.my_campus())

-- becomes
using (
  public.is_admin()
  or (
    campus_id = public.my_campus()
    and registered_by = (select auth.uid())
  )
)
```

### `institutes_update`

**Both halves, again.** 0020b caught this one the first time and the reasoning is
unchanged: `using` decides which rows may be targeted, `with check` decides what
they may become. Scope only the first and a rep could move an institute *into*
their own name; scope only the second and they could edit a foreign row as long
as they left the owner alone.

```sql
using (
  public.is_admin()
  or (campus_id = public.my_campus() and registered_by = (select auth.uid()))
)
with check (
  public.is_admin()
  or (campus_id = public.my_campus() and registered_by = (select auth.uid()))
)
```

The `with check` half now also means a rep cannot hand an institute to somebody
else. `guard_institute_owner` (FO010) already refuses that; this is the second
lock on the same door, which is how the rest of this schema is built.

### `institutes_insert` — **already correct, and worth saying so**

```sql
with check (
  public.is_admin()
  or (registered_by = (select auth.uid()) and campus_id = public.my_campus())
)
```

0020b wrote this to stop a rep registering into another campus. It happens to be
exactly the ownership rule as well: a rep registers **in their own name**, so
every institute they create is already theirs. **No change.**

### `institutes_delete` — unchanged

`using (public.is_admin())`. Deleting an institute was always an admin's, and
`on delete restrict` from `visits` still refuses one with history.

### `institute_status_history_select` — **this is the one that would be missed**

0020b called this "the quiet one" for good reason, and the same trap is here.
The policy scopes through the parent institute by campus:

```sql
-- now
using (
  public.is_admin()
  or exists (
    select 1 from public.institutes i
    where i.id = institute_id and i.campus_id = public.my_campus()
  )
)
```

Leave it and a rep reads **the full status journey of every colleague's
institute on their campus** — the institute ids, what happened to them and when
— without ever selecting from `institutes`. Tightening only `institutes_select`
would move the leak here rather than close it.

```sql
-- becomes: the same predicate the institute itself now uses
using (
  public.is_admin()
  or exists (
    select 1 from public.institutes i
    where i.id = institute_id
      and i.campus_id = public.my_campus()
      and i.registered_by = (select auth.uid())
  )
)
```

### Not touched, and why

* **`materials_select`** — campus-scoped and nothing to do with institutes. A
  poster belongs to a campus, not to a school.
* **`visits_*` and `daily_plans_*`** — already `member = auth.uid() or
  is_admin()`. A rep's own work was never visible to another rep.
* **`institute_statuses`** — a vocabulary, read by everyone. Unrelated.

---

## 3. `registered_by` stops being bookkeeping

Today it is an audit stamp. 0016 added FO010 because the audit's N-1 finding was
that any rep could rewrite it, and the comment on that function still says what
it was then:

> "*who registered this school is administrative bookkeeping that an admin can
> legitimately fix after a person leaves the team*"

After this change that sentence is wrong in a way that matters. **FO010 becomes
a security control**: the column decides who can see the row, so changing it is
granting and revoking access. Its comment has to be rewritten to say so, or the
next reader will treat it as a tidy-up.

### ⚠ The nullable-owner hazard, and it is the sharpest thing in this plan

`0001_init.sql`:

```sql
registered_by uuid references public.profiles (id) on delete set null default auth.uid()
```

**`ON DELETE SET NULL`.** Delete a profile and every institute that rep
registered has its owner set to null — and a null `registered_by` matches no
rep's predicate, so those institutes become **invisible to every rep at once**,
with no error and nothing on any screen to say what happened. The pipeline does
not break; it silently empties.

That is survivable and it is not hypothetical: "after a person leaves the team"
is the exact case FO010's own comment describes.

Three ways to handle it, and they are not exclusive:

| | |
| --- | --- |
| **Recommended** | Leave the FK alone and make the state VISIBLE: the admin registry shows an **Unassigned** owner in `danger` tone, and reassigning is one tap (§7). An orphan is then a thing an admin can see and fix, not a mystery. |
| Also worth doing | The migration's assertion block **counts** institutes with a null owner and raises a NOTICE naming them, so the state is known at apply time rather than discovered later. |
| Considered, rejected | `ON DELETE RESTRICT`, which would refuse to delete a profile that ever registered anything. It converts a quiet problem into a loud one at the wrong moment — an admin removing a departed rep is doing routine housekeeping and should not be blocked by it. |

> **D-B — LOCKED: Unassigned-plus-notice.** The foreign key is not changed and
> profile deletion is never blocked.
>
> One consequence worth naming, because nothing else surfaces it: an orphaned
> institute also drops out of **every rep's Pending**, even though its status is
> still open. That is correct under "orphaned until reassigned" — but it means
> work can go quiet with nobody told. The Unassigned badge is therefore
> load-bearing rather than decorative; it is the only thing on any screen that
> says an institute has fallen out of circulation.

---

## 4. Reassignment

### FO010 already allows it — confirmed

`guard_institute_owner()` refuses a change to `registered_by` only when
`caller is not null and not public.is_admin()`. So an admin may reassign today,
and so may the service role and the SQL editor (where `auth.uid()` is null).
**Nothing needs unlocking.** What needs adding is the constraint on *where* it
may move to.

### The new rule: a new owner must be on the institute's campus

Without it, an admin could hand a Gandhinagar school to a Bangalore rep. The
rep's predicate requires **both** conjuncts, so that rep still could not see it —
the institute would simply vanish into a state where nobody but an admin can
reach it. A silent no-op is worse than a refusal.

Extend `guard_institute_owner()` (same trigger, same signature, reproduced in
full — a function cannot be patched):

```
if the new owner's profiles.campus_id is distinct from the institute's campus_id
  raise 'That rep is not on this institute's campus.'  -- FO025
```

Null on either side is left alone, following FO023's precedent: a restore or a
seed writes rows with no caller, and an admin has no campus of their own to
compare.

### `guard_plan_assignment` (FO023) must widen from campus to ownership

This is the second thing that would be missed. An admin can assign a visit to a
rep, and FO023 currently checks only that the institute is in **that rep's
campus**. After this change that is no longer sufficient: an institute on B's
campus but owned by A, assigned to B, puts a plan entry on B's Dashboard for an
institute B cannot open — precisely the broken row 0020b added the campus check
to prevent, one boundary in.

So the check becomes **ownership**, which implies the campus:

```
if the institute's registered_by is distinct from new.member
  raise 'That institute belongs to another rep.'   -- FO023, widened
```

> **D-C — LOCKED: refuse.** Assigning a visit is scheduling; moving ownership is
> a permissions change. And it would not move one visit — it would move the
> institute's whole pipeline, its history, its status and its row in the other
> rep's Pending, silently, from a dropdown the admin thinks is about Tuesday.
>
> The message names the remedy, because the remedy is two taps away:
> **"Reassign the institute to this rep first, then assign the visit."**

---

## 5. ⚠ Gap G1 — a rep can already plan an institute they cannot see

**This exists today, across campuses, and rep-ownership makes it sharper.**

`daily_plans_insert` is `with check (member = (select auth.uid()))` — there is no
institute test at all. And `guard_plan_assignment()` **returns early** for a rep
planning their own day:

```sql
-- Planning your own day is not an assignment, whatever the form sent.
if new.member = caller then ... return new; end if;
```

with the comment *"the picker did the scoping"*. The picker is therefore the
only thing standing between a rep and an institute id they should not have. That
was a modest gap while the boundary was a whole campus; with a per-rep boundary
the set they should not touch is far larger, and the gap is worth closing.

**What actually happens today if someone posts a foreign institute id:**

1. `daily_plans` row inserts — nothing refuses it.
2. Check-in succeeds — `daily_plans_update` is `member = auth.uid()`.
3. `log_visit()` inserts the visit — `visits_insert` is `member = auth.uid()`,
   and the FK to `institutes` **bypasses RLS**, as every referential check does.
4. `log_visit()` then runs `update public.institutes set status = ...`. It is
   SECURITY INVOKER, so `institutes_update` applies, no row matches, and it
   raises **FO006 "That institute no longer exists."** — the whole transaction
   rolls back.

So logging is *accidentally* blocked, and only because stage 4b made a status
compulsory: with `p_status_set_to` null the update is skipped and the visit
would persist. **An accident is not a control.**

And step 2 is not blocked at all: a rep can burn their one-open-visit slot
(`daily_plans_one_open_visit`, FO013) on an institute they cannot see, then be
unable to finish it or check in anywhere else. That is a self-inflicted denial
of service through a tampered form, which is a small thing, but a real one.

### D-D — LOCKED: fix it properly, and in THREE parts

Blocking the plan INSERT closes the tampering route and does **not** close the
stuck case. The sharpest version of that needs no tampering at all:

> Rep A is checked in at institute X, mid-visit. An admin reassigns X to rep B.
> A can no longer see X, so `log_visit()`'s `update institutes` matches no row
> and raises FO006 — and A cannot check in anywhere else, because FO013 allows
> one open visit. A is stuck until the overnight sweep, and the visit is lost.

So the control is three rules, not one:

| | Rule | Code | Fires on |
| --- | --- | --- | --- |
| **Plan** | a plan row's institute must satisfy `registered_by = member` | **FO026** | `daily_plans` INSERT, and UPDATE of `institute_id` |
| **Arrive** | the same check when the arrival is stamped — catches a row that was fine when planned and is not now | **FO026** | `daily_plans` UPDATE of `checkin_at` |
| **Reassign** | refuse while the current owner holds an OPEN check-in at that institute | **FO025** | `institutes` UPDATE of `registered_by` |

The third is the one that actually closes the stuck case. The alternatives are
worse: letting `log_visit()` bypass RLS would punch a hole straight through the
boundary this feature exists to draw, and auto-closing A's check-in loses a real
visit. Refusing costs an admin a few hours with a clear sentence — *"that rep is
at this institute now; reassign when they have finished."*

**ONE PREDICATE SERVES BOTH PATHS.** A rep planning their own day and an admin
assigning to a rep both end at `registered_by = new.member`, because the widened
FO023 already guarantees that before an assigned row exists.

**A trigger rather than an RLS predicate**, because a policy cannot produce a
sentence: a rep who hits this deserves "that institute is not yours" rather than
a silent zero-row write.

**The escape hatch survives, and is load-bearing.** A dead plan row — planned
legitimately, then reassigned away, not yet checked in — is still removable:
`removeFromDailyPlan` is member-scoped, filters on `checkin_at is null`, and
touches no institute. So a rep is never holding something they cannot clear. It
renders as "No longer yours" (D-E) until they do.

**An orphaned institute (null owner) is refused by the same predicate**, which
is correct: nothing should be planned against an institute that has fallen out
of circulation until an admin assigns it.

---

## 6. Every consumer, and whether RLS covers it

| Where | Query | Covered by the policy change? |
| --- | --- | --- |
| Registry list (`/institutes`) | `listInstitutes()` | ✅ automatic |
| Institute detail | `getInstitute(id)` | ✅ automatic — a foreign id becomes `notFound()` |
| Status timeline on that page | `getInstituteStatusHistory()` | ✅ **once §2's history policy is also changed** |
| Daily-plan picker | `listInstitutesForPicker()` | ✅ automatic |
| Admin assign picker | same function, admin RLS | ⚠ **needs an explicit filter** — an admin sees everything, so the picker must narrow to the chosen rep's institutes, or every assignment trips FO023 |
| Log Visit | reads the plan row, not institutes | ✅ nothing to do |
| Reopen-closed warning | `reopeningInstitute()` over the picker list | ✅ automatic — it operates on whatever the picker returned |
| **Pending** (Stage 5) | `getOpenFollowUps()` | ✅ automatic — see §8 |
| Visit report | `closing-report.ts` institute block | ✅ automatic; ⚠ see §9 for reassigned history |
| Batched name lookup | `instituteNames()` | ✅ automatic; ⚠ see §9 |
| Activity report | `institutes(name, type)` embed | ✅ automatic; ⚠ see §9 |
| Admin status panel usage counts | `listStatusRows()` | ✅ admin-only screen, admin RLS |
| Materials | campus-scoped, no institute link | ✅ unaffected |

**One explicit filter in the whole feature**, and it is on the admin side where
RLS deliberately does not narrow. Everything else is the policy.

---

## 7. The admin surface — recommendation

Two additions, both small, and deliberately no new screen. `CLAUDE.md`'s
restraint rule is about tabs, and this needs none.

**1. Owner on the registry list.** One muted line under the institute name:
`Registered by Sumit Rajput`, or **Unassigned** as a `danger` badge when
`registered_by` is null (§3). Admin-only — a rep sees only their own, so the
line would say the same thing on every row and tell them nothing.

**2. Reassign on the institute detail page**, admin-only card: the current
owner, and a picker of **reps on that institute's campus** with a confirm.

Why the detail page rather than a Settings panel: it is already the one screen
about one institute, an admin chasing a specific school is already there, and a
Settings list would be a second registry to keep in step with the first. It is
also where an admin arrives from the registry line above.

`registered_by` is **not currently selected anywhere** — `COLUMNS` in
`institutes.ts` omits it and the `Institute` interface has no owner field — so
this is a column plus a joined profile name, not a restructure.

> Also worth a line: `institutes.ts:38` still says *"The registry is shared — the
> RLS select policy is `true`"*. That has been untrue since 0020b and would be
> doubly untrue after this. It should be corrected in the same pass.

---

## 8. Pending — the RLS change narrows it correctly, by construction

Stage 5's `getOpenFollowUps()` is two queries:

1. `institutes` where the status is open → **campus-scoped today, rep-scoped
   after this**, automatically.
2. `visits` at those institutes, for attribution → already `member = auth.uid()
   or is_admin()`.

So a rep's Pending narrows from *their campus's* open institutes to *their own*,
with **no change to the query**. That is a direct consequence of Stage 5 having
been built on `institutes.status` rather than on each visit — the choice was
made for other reasons and pays off here.

Three follow-on effects:

* **Attribution becomes trivially always-self.** A rep can now only see open
  institutes they own, and only their own visits — so `item.mine` is true for
  every row a rep sees. The `memberName` line stays for the ADMIN view, where it
  is the whole point.
* **The empty state is now wrong.** It reads *"Every institute in your campus is
  either finished or has not been visited yet."* It must become **"yours"**, not
  "your campus". Flagged when Stage 5 shipped; this is the change that makes it
  due.
* **The header copy** — "Institutes you have left open" — is already right, and
  becomes literally true rather than approximately.

Admin Pending is unchanged: admins see everything, read-only, exactly as D10
settled.

---

## 9. Supersession, and what happens to a reassigned institute's history

### Cross-rep supersession becomes unreachable through the app

Stage 5 handles the case where rep A logs "Session scheduled" and rep B later
logs "Session done", closing the loop and removing A's row. With rep-private
institutes, **B cannot see, plan, check in at or log a visit at A's institute**
— every step of the chain is now closed to them, and the widened FO023 closes
the admin-assignment route as well.

So the case disappears from the UI. **Keep the logic anyway**, for two reasons:
it costs nothing (the query reads `institutes.status`, which is already the
right answer whoever set it), and rows written *before* this change can still
have two reps' fingerprints on one institute. It stops being load-bearing and
becomes defensive, which is the right direction of travel.

### ⚠ Reassignment orphans the previous owner's own history — and this needs a decision

Move institute X from A to B. A's past visits at X are still A's: `visits` is
member-scoped and nothing about them changes. But every screen that shows a
visit resolves the institute's NAME through `institutes` under the caller's RLS —
`instituteNames()`, the report's institute block, the activity report's embed.
A can no longer read X, so those lookups miss and `instituteNameOr()` prints
**"Not in your campus"** against A's own history, while logging a scoping
warning on every render.

That is coherent in the sense that nothing leaks, and poor in the sense that a
rep's own past work goes anonymous.

| Option | Verdict |
| --- | --- |
| Accept it, and reword the label | Cheapest. `INSTITUTE_OUT_OF_SCOPE` currently says "Not in your campus", which after this is often the wrong reason. Something like **"No longer yours"** covers both. |
| Widen `institutes_select` to include "institutes I have visited" | **Reject.** RLS gives one SELECT, so this would put the institute back in the picker and back in Pending — defeating the feature to fix a label. |
| A SECURITY DEFINER function returning **names only**, for institutes the caller has a visit at | **Recommended.** Surgical: it exposes one string for a row the caller already provably holds a visit against, and grants no listing, no filtering and no detail. `instituteNames()` calls it instead of selecting. |

> **D-E — LOCKED: do BOTH, in the same release.**
>
> The deferral in the first draft assumed nothing could be reassigned yet. Steps
> 1–3 ship the reassign button, so from that moment it can be — and the argument
> for doing the function now is not really the label, it is the **log noise**:
> without it every reassignment turns every one of that rep's historical visit
> rows into a scoping warning on every render, and an error log that cries wolf
> is worse than no log.
>
> So: `INSTITUTE_OUT_OF_SCOPE` becomes **"No longer yours"**, which covers both
> causes, and the names come from a SECURITY DEFINER lookup returning **names
> only** for institutes the caller holds a visit at.

---

## 10. Existing data — no backfill, and the design is safe if there were

The client's project has **~0 real institutes** (cleaned). Every institute the
app has ever created sets `registered_by` explicitly in `institute-actions.ts`,
and the column defaults to `auth.uid()` besides, so there is nothing to fill in.

Designed to be safe if that were not true:

* The policy is additive in the sense that matters — it **narrows**, so a row
  with a wrong owner becomes invisible to a rep rather than visible to the wrong
  one. The failure mode is "cannot see my own work", which is loud, not "can see
  someone else's", which is silent.
* The migration **counts and names** institutes with a null owner (§3) rather
  than assuming there are none.
* Nothing is rewritten. No `update institutes set registered_by = …` appears
  anywhere in this plan; an owner is only ever set by the app at registration or
  by an admin through §7.

---

## 11. Migration 0028 — design

**One migration.** Policies and guards only; no column is added, dropped or
back-filled.

1. `institutes_select`, `institutes_update` — the narrowed predicate (§2).
   `institutes_insert` and `institutes_delete` **restated unchanged**, so the
   file stands on its own against a fresh restore and a reader sees all four
   together.
2. `institute_status_history_select` — the same predicate through the parent.
3. `guard_institute_owner()` reproduced in full, with the same-campus
   reassignment check added — **FO025**. Its comment rewritten: this is a
   security control now, not bookkeeping.
4. `guard_plan_assignment()` reproduced in full, its campus check widened to
   ownership — **FO023**, same code, wider rule.
5. A new trigger on `daily_plans` closing gap G1 — **FO026** (§5).
6. Assertion block:
   * all four `institutes_*` policies exist, and both halves of `_update` are
     scoped;
   * the history policy mentions `registered_by`;
   * FO010's, FO023's and FO026's triggers are attached;
   * **campus isolation has not regressed** — `my_campus()` still exists, the
     three 0020b policies are present, `enforce_profile_campus` (FO021) and
     `enforce_institute_campus` (FO022) are still attached;
   * the audited neighbours on `visits` are all still there — the meeting gate,
     the presence guarantee, FO016, the photo write-once, FO024;
   * a count of institutes with a null `registered_by`, raised as a NOTICE.

### Is it deploy-coupled?

**No, and it is safe to apply before the code ships.** The app reads whatever
RLS returns and has no hard-coded expectation of seeing a colleague's
institutes; the narrowing simply takes effect. What lands early is a *visible
behaviour change* for reps, not a broken screen — so it should go out with the
announcement rather than quietly ahead of it.

The one thing that must NOT go early is the widened FO023, if an admin is
mid-way through assigning: an assignment that worked yesterday may be refused
today. That is the rule working, but it is worth telling the admin first.

---

## 12. Build order

Deliberately **admin tooling first**, so that the moment ownership starts
deciding visibility there is already a way to see and fix it.

| # | Step | Migration | Risk |
| --- | --- | --- | --- |
| **1** | Admin sees ownership: `registered_by` + owner name on the registry and the detail page, "Unassigned" badge, **and filter-by-owner** (D-F) | none | none — additive, admin-only, no behaviour change for reps |
| **2** | Admin reassign control on the institute detail page | none | none — FO010 already permits it; FO025 arrives in step 4 and only narrows where it may point |
| **3** | Admin assign-visit picker filtered to the chosen rep's institutes | none | none — prevents step 4's widened FO023 from refusing ordinary assignments |
| **4** | **Migration 0028** — the rule goes live | 0028 | the real change. Reps' lists narrow on their next request |
| **5** | Wording: Pending's empty state → "yours"; `INSTITUTE_OUT_OF_SCOPE` → "No longer yours"; the stale `institutes.ts:38` comment | none | none |
| **6** | The name-resolution function for a reassigned institute's history (§9), **in this release** per D-E | in 0028 | none — additive function, grants names only |
| **7** | Tests, `CLAUDE.md`, size | none | — |

Steps 1–3 can ship together and are invisible to reps. Step 4 is the one with a
before and an after.

### Rollback

Step 4 reverts by restoring 0020b's predicate on the three policies — a policy
is replaceable in place, nothing is lost, and no data has moved. Steps 1–3 and 5
are `git revert`. That is the advantage of a feature that adds no column: there
is nothing to un-migrate.

---

## 13. Flags

| | |
| --- | --- |
| **F1** | **`ON DELETE SET NULL` on `registered_by`.** Deleting a departed rep's profile makes every institute they registered invisible to all reps at once, silently. §3 — the recommended answer is to make it visible rather than to change the FK. |
| **F2** | **`institute_status_history_select` must be narrowed in the same migration.** Tightening only `institutes_select` moves the leak instead of closing it: a rep would still read every same-campus colleague's status journey without touching `institutes`. |
| **F3** | **G1 — `daily_plans_insert` has no institute check and FO023 returns early for a rep planning their own day.** Pre-existing, already true across campuses; rep-ownership sharpens it. Logging is *accidentally* blocked only because stage 4b made a status compulsory, and an accident is not a control. §5. |
| **F4** | **FO023 must widen from campus to ownership**, or an admin assignment puts an unopenable row on a rep's Dashboard — the exact failure the campus check was added for, one boundary in. |
| **F5** | **The admin assign-visit picker needs an explicit filter.** Admin RLS shows every institute, so without it most assignments would trip the widened FO023. This is the only explicit filter the feature needs. |
| **F6** | **Reassignment anonymises the previous owner's own history** until §9's name lookup exists. Not a leak; a poor read of a rep's own past work. |
| **F7** | **`institutes_update` needs BOTH halves scoped.** 0020b caught this exact omission once already. |
| **F8** | **Strict AND means a transferred rep loses their old pipeline** (D-A). Correct under "campus is the outer guardrail", and worth the client hearing before a rep is moved. |
| **F9** | **FO010's comment becomes false.** It describes `registered_by` as bookkeeping an admin may tidy; after this it is an access grant. Wording is not cosmetic here — it is what tells the next reader how carefully to tread. |

---

## 14. Decision record — all six, locked

| # | Decision | Recommendation |
| --- | --- | --- |
| **D-A** | Strict `campus AND owner`, or owner alone? | **LOCKED: strict AND.** Matches "stacks on campus"; transferring a rep orphans their pipeline until reassigned (F8), accepted |
| **D-B** | Handle the null-owner orphan by FK change, or by making it visible? | **LOCKED: visible** — "Unassigned" in the admin registry plus a migration notice. The foreign key is unchanged and profile deletion is never blocked |
| **D-C** | Admin assigning a visit at another rep's institute: refuse, or auto-reassign? | **LOCKED: refuse** (FO023), with the message naming the remedy: "Reassign the institute to this rep first, then assign the visit." |
| **D-D** | Close gap G1 now, or note it? | **LOCKED: close it now, in three parts** — FO026 on plan + arrive, FO025 refusing reassignment while the owner is mid-visit. §5 |
| **D-E** | Reassigned history: reword the label, or add the name function? | **LOCKED: both, same release.** The reassign button makes it reachable, and the log noise is the real cost |
| **D-F** | Bulk reassign for a departing or transferred rep? | **LOCKED: no bulk action in v1.** One-at-a-time reassign, PLUS a **filter-by-owner on the admin registry** so an admin can pull up "everything rep A registered" and work down it. D-A's lock makes this matter more than it first looked: transferring a rep orphans their whole pipeline at once, and without the filter that is an unbounded hunt across a list |

---

**§12 is the order.** Steps 1–3 are application-only and invisible to reps;
migration 0028 is a separate branch and a separate review.
