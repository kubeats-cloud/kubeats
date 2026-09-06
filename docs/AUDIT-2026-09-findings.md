# Four-pass re-audit — findings and what was done

A full re-audit of the live site, run in four passes after the app grew status
categories, status history, reopen-closed, materials, daily/weekly/monthly
targets, the activity report, check-in/out and location accuracy. It replaces
the Phase 10 audit, which predates most of those.

**621 assertions. No security vulnerabilities. No cross-feature regressions.**

| Pass | Scope | Assertions | Outcome |
| --- | --- | --- | --- |
| 1 | Functional break-testing | 260 | 2 defects, 3 notes |
| 2 | Security / RLS / access control | 169 | 0 vulnerabilities, 3 observations |
| 3 | Cross-feature regression | 96 | 0 regressions, 1 low deviation |
| 4 | Migration & data integrity | 96 | 4 findings, production data 29/29 clean |

Test data was created and removed in every pass, with every baseline counter
verified back to its starting value.

---

## Fixed — migration 0016 and the branch alongside it

| Ref | Finding | Fix |
| --- | --- | --- |
| **M-3** | The backup was missing `visit_people`, `institute_status_history` and `materials`, and the whole `materials` bucket. A restore would have lost every closing-report contact and the entire status audit trail. | All three added to `BACKUP_TABLES`; both buckets backed up and restored; a live coverage check now fails the backup if any table is unaccounted for. |
| **F-1** | An institute could be stored with an empty name, no boards, or a 5000-character name — validated in zod only, and a rep can insert directly with the anon key. | `institutes_name_present`, `institutes_name_length`, `institutes_boards_present`. |
| **F-2** | Half a coordinate pair was storable: the range checks tested each coordinate independently. | `visits_coords_paired`, `daily_plans_checkin_coords_paired`, `daily_plans_checkout_coords_paired`. |
| **M-4** | Restoring onto a freshly migrated database duplicated seeded reference data — 85 + 88 cities became 173. | The restore contract is now "schema, not seed": `restore.mjs` clears the four backup-owned reference tables first. Documented in the runbook. |
| **M-2** | `0002` and `0008` had a bare `comment on function public.log_visit`, which becomes ambiguous once `0015` adds the 13-argument version — the same 42725 that broke `0015` in the first place. | Both now name their twelve arguments. |
| **N-1** | Any rep could reassign `institutes.registered_by` to themselves, with no audit trail. | `institutes_guard_owner` trigger, raising `FO010`. The registry stays open — any rep may still rename an institute or set its status per Rule 4 — but ownership stops moving. An admin may still correct it. |
| **F-4** | `daily_plans.checkin_at` could be overwritten, moving the arrival time and the derived duration. | `daily_plans_checkin_final` trigger, raising `FO011`. Write-once and absolute, following `visits_photo_final`: no exception for an admin or the service role. |
| **/weekly** | Returned HTTP 200 with the redirect buried in the streamed payload, so a browser followed it but `curl`, crawlers and non-JS clients did not. | Moved into `proxy.ts`, where it is a real 307. |

---

## Investigated and deliberately not fixed

### M-1 — the migration chain is forward-only

`0001` creates `weekly_targets`; `0013` renames it away. Replaying `0001` over a
migrated database collides on the constraint names that travelled with the
rename.

A fix was written and tested: free the old names in `0016`. It made things
worse. Freeing them let `0001` re-create the table, which then collided at
`0013` (`relation "weekly_targets_pre_0013" already exists`), which in turn
broke the guard that freed them. One collision became three.

The root cause is not a missing guard — it is that replaying `0001` asks for a
state the chain has moved past. **Each migration stays individually idempotent;
the chain as a whole is forward-only, and a rehearsal applies it to a fresh
database.** Recorded in `0016` section 5 and in the runbook.

---

## Accepted — known, and not defects

These were found, understood, and left alone on purpose.

### F-3 · Two institutes may share a name

There is no uniqueness constraint on `institutes`, so the same school can be
registered twice. **Accepted:** two branches can legitimately share a name, and
`daily_plans_unique_per_day` keys on `institute_id`, so duplicates remain
independently plannable rather than silently merging. A hard constraint would
refuse a real case in order to prevent a tidiness problem.

### F-5 · `0000000000` is a valid mobile number

`^[0-9]{10}$` accepts it. **Accepted:** the constraint is doing exactly what it
says, and it is a shape check, not a reachability check. Anything stricter
starts guessing which Indian number ranges are real, which is a list that would
go out of date.

### N-2 · `SUPABASE_SERVICE_ROLE_KEY` appears as a string in the client bundle

It is the variable **name**, inside the zod schema in `src/lib/env.ts`, which is
bundled whole. **No value is present** — the audit confirmed this by checking
the key's unique signature and payload segments, both absent. (A first scan
reported a leak; that was a false positive, because the anon and service keys
share 110 identical leading characters.) **Accepted:** the name is not a secret,
and splitting `env.ts` to shed a dead schema would cost more clarity than the
few bytes are worth.

### M-6 · A rebuild recreates `weekly_targets_pre_0013`

Production dropped that preserved table after `0013`; a fresh chain recreates
it. **Accepted:** it is the pre-rename backup of the weekly targets, harmless,
and dropping it is a one-line decision an operator can repeat.

---

## Still only testable on a real phone

Nothing here is a finding — it is what the audit could not reach, and it has not
moved since pass 1.

- **Real GPS quality**: whether the 12-second `watchPosition` window actually
  captures a satellite fix outdoors, and what accuracy reps see indoors.
- **The real camera**: `getUserMedia`, the rear-facing default, and the
  `capture="environment"` fallback.
- **EXIF stripping** on photographs from a real device.
- **Live Nominatim**: real area names, the 3.5s timeout, and its rate limits
  under a full team.
- **Genuine two-device concurrency** — the audit raced parallel API calls, not
  two thumbs on two phones.
- **The pg_cron purge firing** on its own schedule.
- **The institute form as a journey**: the pincode → city → area cascade and the
  city-alias dedup, as a person experiences them.
