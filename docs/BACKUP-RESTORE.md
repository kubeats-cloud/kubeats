# Backing up and moving KUbeats

Everything you need to take a copy of this system, and to stand it up somewhere
else — a new Supabase project, a client's self-hosted Supabase, or a plain
Postgres server.

Read the first section before you need it. The rest is a procedure to follow
with the building on fire.

---

## The four domains, and why they are separate

A database dump is not a backup of this application. Four different things hold
state, they live in different places, and they come back in a particular order.

| Domain | Where it lives | How it moves |
| --- | --- | --- |
| **1. Table rows** | `public` schema | `pg_dump`, or `npm run backup` |
| **2. Auth users** | `auth` schema, behind the Auth API | Dump the `auth` schema, or `npm run backup`. **Passwords cannot move** unless you dump `auth` at the SQL level. |
| **3. Photos** | Storage, private `visit-photos` bucket | Files, not rows. `npm run backup`, or the Storage API. |
| **4. Supabase-only pieces** | Vault + pg_cron | **Cannot be exported at all.** Re-created by re-running migration `0004`. |

Skip domain 2 and the restore fails immediately: `profiles.id` references
`auth.users`, so every row that names a person is refused. Skip domain 4 and
nothing appears broken — photos simply stop being deleted, quietly, forever.

---

## For the client: who does what, and when

**This is the section to read if you are not the developer.** Three jobs. If
nobody is named against each one, they will not happen.

| | Job | Who | How often |
| --- | --- | --- | --- |
| 1 | **Take the backup** | The client, on the client's machine | Weekly, automatically |
| 2 | **Check the backup is readable** | The client | Quarterly, 2 minutes |
| 3 | **Prove it actually restores** | Developer or a technical helper | Once at handover, then yearly |

### Why the client, and not the developer

A backup that lives on the developer's laptop is not the client's backup. When
the engagement ends, so does the arrangement — usually without anyone noticing
until the day it is needed. **Job 1 belongs on a machine the client controls and
keeps switched on.**

### Job 1 — the weekly backup (Windows)

Run this once, in a Command Prompt, replacing the path if the project lives
somewhere else. It creates a scheduled task that runs every Sunday at 20:00.

```
schtasks /create /tn "KUbeats weekly backup" ^
  /tr "cmd /c cd /d \"D:\free lance\" && npm run backup" ^
  /sc weekly /d SUN /st 20:00 /rl highest
```

Then prove it works, rather than assuming:

```
schtasks /run   /tn "KUbeats weekly backup"
schtasks /query /tn "KUbeats weekly backup" /v /fo LIST
```

A new folder should appear under `backups\`. **If it does not, the schedule is
not working and you have no backups** — the task will keep reporting success
while doing nothing if the path is wrong.

Three things that stop this working, all of them silent:

- **The machine must be awake at 20:00 on Sunday.** A laptop that is shut takes
  no backup and reports no error. Pick an hour the machine is reliably on.
- **`npm` must be available to the account the task runs as.** The command above
  was tested on the handover machine; on a different one, run it by hand first.
- **Nothing deletes old backups.** They accumulate forever. Delete anything
  older than about three months, or take `--no-photos` weekly and a full one
  monthly — photos are almost all of the size.

On macOS or Linux, the same thing in `crontab -e`:

```
0 20 * * 0 cd /srv/kubeats && /usr/bin/npm run backup >> /var/log/kubeats-backup.log 2>&1
```

### Where backups must be kept

> **A backup holds personal data: names, mobile numbers, GPS coordinates of
> where staff were standing, and photographs of school premises.**

Two rules, and they pull in opposite directions, so both matter:

1. **Not only on the machine that runs the app.** A laptop that is lost, stolen
   or dies takes the app and its only backup together. Send them somewhere else
   — a synced folder or an external drive:

   ```
   npm run backup -- --out "C:/Users/<you>/OneDrive/kubeats-backups"
   ```

2. **Somewhere you would be willing to defend.** Not a shared drive the whole
   office can browse, not a personal phone, not an unencrypted USB stick left in
   a drawer. If the client has a policy about staff data, this is covered by it.

`backups/` is excluded from version control, so a backup cannot reach GitHub by
accident. Everything else about where it goes is a decision someone has to make
on purpose.

### Job 2 — the quarterly check (2 minutes)

```
npm run backup:verify -- backups/<timestamp>
```

Reads the backup on its own terms — no internet, no passwords, no Supabase
account needed, so it works on a copy from an external drive years later. It
prints a line per check and ends with either `Backup verified` or a count of
failures, and exits non-zero on failure so it can be scheduled too.

It confirms the backup is **readable and internally consistent**: every table
file present and valid, row counts matching what the manifest claims, every row
carrying the key a restore needs, photo files present and not truncated, and no
API keys accidentally captured. It cannot tell you whether the backup matches
the live system today — nothing offline can — which is what job 3 is for.

### Job 3 — the yearly restore rehearsal

A backup nobody has restored is a hypothesis. See
**"Proving a backup actually restores"** below. Do it once before handover, so
the client is told "we have restored this", which is a different claim from "we
have backups".

---

## Routine backup

```bash
npm run backup                  # → ./backups/<timestamp>/
npm run backup -- --no-photos   # rows and users only, much faster
npm run backup -- --out D:/field-ops-backups
npm run backup:verify -- backups/<timestamp>   # check one, offline
```

It reads the same `.env.local` the app uses and writes:

```
backups/2026-09-04T10-29-54-117Z/
  manifest.json          what was taken, and what could not be
  tables/*.json          one file per table
  auth-users.json        ids, emails, confirmation state — no password hashes
  storage/visit-photos/  the photo files, in their per-user folders
```

`backups/` is git-ignored. **It contains personal data — names, phone numbers,
locations, photographs of school premises.** Keep it somewhere you would be
willing to defend in a conversation about data protection.

### On a schedule

Windows Task Scheduler, daily at 01:00:

```
schtasks /create /tn "KUbeats backup" /tr "cmd /c cd /d D:\field-ops && npm run backup" /sc daily /st 01:00
```

Linux or macOS, in `crontab -e`:

```
0 1 * * * cd /srv/field-ops && /usr/bin/npm run backup >> /var/log/field-ops-backup.log 2>&1
```

Prune old ones yourself; nothing deletes them. A month of daily backups of a
twenty-person team is a few hundred megabytes, almost all of it photos.

### If you are on Supabase Pro

You also get automated daily database backups in the dashboard
(Database → Backups). Those cover domains 1 and 2 and **not** 3 or 4. They are a
good safety net and not a substitute for the above.

---

## Full export, the SQL way

Use this for a real move. `npm run backup` is for routine safety; `pg_dump`
gives you the auth schema *including password hashes*, which the API cannot.

Get the connection string from **Supabase → Project Settings → Database →
Connection string → URI**, and export it:

```bash
export DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres'
```

```bash
# 1. Application data
pg_dump "$DATABASE_URL" --data-only --schema=public -Fc -f fieldops-data.dump

# 2. Auth users, with their password hashes
pg_dump "$DATABASE_URL" --data-only --schema=auth -t auth.users -Fc -f fieldops-users.dump

# 3. Photos — files, so not pg_dump's job
npm run backup -- --out ./photos-only
```

If you do not have `pg_dump`, the Supabase CLI carries its own:
`npx supabase db dump --db-url "$DATABASE_URL" --data-only -f fieldops-data.sql`.

---

## Restoring into a new project

Follow the order. Each step depends on the one before it.

### 1. Create the project and apply the migrations

Run `0001` → `0002` → `0003` → `0004` → `0005` → `0006` → `0007` → `0008` in the
SQL editor, exactly as `README.md` describes. In order, and all of them: `0006`
and `0008` each replace `log_visit()` in full, so a run that stops early leaves
the older definition in place — and stopping before `0008` leaves the database
reading "today" from the server's calendar while the app reads India's, which
breaks the meeting gate between 00:00 and 05:30 IST.

The schema, RLS, triggers, indexes, the storage bucket and the seed data all
come from these files — nothing else is needed to rebuild the structure.

### 2. Restore auth users — before any rows

**With password hashes** (people keep their existing passwords):

```bash
pg_restore -d "$NEW_DATABASE_URL" fieldops-users.dump
```

**Without** (from `npm run backup`, or a project you no longer have SQL access
to): the restore script recreates each account with its **original id** and a
random password. Everyone then needs a new temporary password from
**Settings → Team**, or a password-reset link. Their data still finds them
because the ids match.

Password hashes are not available through the Auth admin API. If you need
people to keep their passwords, you need the SQL-level dump above — decide this
before you decommission the old project.

### 3. Clear the seeded reference rows

Migration `0001` seeds 36 states, 85 cities and 5 purposes with **fresh** ids.
Your dump has the same places with **different** ids. Restore on top and it
fails on the unique constraint on `location_states.name`, and then every city,
area and institute fails on the foreign key behind it.

```sql
truncate public.location_states, public.purposes cascade;
```

This is the step people skip. Skipping it produces a wall of foreign-key errors
that look like a corrupt dump and are not.

### 4. Restore the rows

```bash
pg_restore -d "$NEW_DATABASE_URL" fieldops-data.dump
```

If the dump predates migration `0006`, it may contain visits with no
`photo_url`. That migration's CHECK is added `NOT VALID`, so it does not reject
rows already in the table — but it does reject them on the way *in*. Drop it for
the restore and re-add it afterwards:

```sql
alter table public.visits drop constraint visits_photo_required;
-- ... restore ...
-- then re-run 0006_photo_required.sql
```

or, from a `npm run backup` directory — point `.env.local` at the **new**
project first:

```bash
npm run restore -- --from backups/2026-09-04T10-29-54-117Z
```

The script refuses to run if the target already holds visits, or if it is the
same project the backup came from. `--force` overrides both; `--dry-run` shows
what it would do.

### 5. Restore the photos

`npm run restore` uploads them as part of step 4. Doing it by hand instead:
upload each file from `storage/visit-photos/<user-id>/` to the same path in the
new project's `visit-photos` bucket, preserving the folder names — the folder
**is** the owner, and the storage policies read it.

A visit whose photo is missing shows "Photo expired" rather than an error, so a
partial photo restore degrades gracefully. Do not let that tempt you into
skipping it.

### 6. Re-establish Vault and cron — migration 0004

Nothing exports these. Run `0004_photo_retention_schedule.sql` in the new
project's SQL editor, filling in the two placeholders on lines 51 and 52 **in
the editor only** — the project URL and the service_role key of the *new*
project. Do not save the filled-in file back into the repo, and do not use
find-and-replace on it.

Then confirm:

```sql
select jobid, schedule, jobname, active from cron.job;   -- one active job
select * from public.purge_old_visit_photos();           -- considered = 0 is correct
```

Skip this and photos accumulate until the storage tier fills. There is no error
message; it just never happens.

### 7. Point the app at the new project

Update all three variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://<new-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<new anon key>
SUPABASE_SERVICE_ROLE_KEY=<new service_role key>
```

**Rebuild and redeploy.** `NEXT_PUBLIC_*` values are inlined into the browser
bundle at build time, so restarting with new variables is not enough — the old
URL would still be in the JavaScript.

On Cloudflare, set `SUPABASE_SERVICE_ROLE_KEY` as an encrypted **Secret** and
the two `NEXT_PUBLIC_*` ones as plain **Variables**. A plaintext Variable is
printed into the build log; the `NEXT_PUBLIC_*` pair are public by design and
have to be plain, because a Secret is not available to the build.

Then set **Authentication → URL Configuration → Site URL** to the app's origin,
and check `/api/health` returns `{"status":"ok"}`.

### 8. Tell people their passwords changed

Unless you moved the hashes in step 2.

---

## Moving to plain Postgres

The primary target is self-hosted Supabase, where everything above applies
unchanged. If a client wants only a Postgres server, most of this still works:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/compat/plain-postgres-prelude.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0002_log_visit_rpc.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0003_photo_retention.sql
# 0004 is skipped here — see below
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0005_closing_report_and_assignment.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0006_photo_required.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0007_place_cache.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0008_ist_calendar_day.sql
```

`0004` is the only one that cannot run here: it needs pg_cron, pg_net and
Vault. Everything else applies to a stock Postgres 17 unchanged — checked, not
assumed.

The prelude supplies what Supabase would have: the four roles, `auth.users`,
`auth.uid()`, and the storage metadata tables the photo policies reference. It
is deliberately short — that list is the whole of this schema's dependency on
its host. **Never run it against Supabase**, hosted or self-hosted.

What does not come across:

- **`0004`** — it needs `pg_cron`, `pg_net` and Vault. Retention becomes an
  ordinary cron job on the host that deletes files older than the window.
- **Auth** — the application still needs an authentication service. Plain
  Postgres gives you the schema and the data, not sign-in.
- **Storage** — photos become files on disk or an S3 bucket, and the upload and
  signing code would need an adapter.

In short: the data and the rules move to plain Postgres cleanly. The *platform*
services — auth, storage, scheduling — are what Supabase is actually providing,
and they would need replacing.

---

## Proving a backup actually restores

Do this once before handover, then yearly. It costs a free Supabase project and
about half an hour, and it is the only thing that turns "we take backups" into
"we have restored from a backup".

**The whole risk in this procedure is restoring into production by mistake.**
The steps below are arranged so that cannot happen quietly.

### 1. A scratch project

Create a second free Supabase project — call it `kubeats-restore-test`, so
nobody mistakes it for anything else. Wait for it to finish provisioning.

### 2. Build the schema

SQL Editor → New query → paste and run each migration **in order**, one at a
time: `0001_init.sql`, `0002`, `0003`, `0004`, `0005`, `0006`, `0007`,
`0008_ist_calendar_day.sql`. Each should report success before you start the
next.

`0004` needs `pg_cron` and the Vault secrets; on a scratch project you can let
it fail, since nothing being tested here depends on the purge running. Note it
and move on.

### 3. Point at the scratch project — and only the scratch project

Copy `.env.local` to `.env.restore-test`, then change **all three** values to the
scratch project's, from Project Settings → API:

```
NEXT_PUBLIC_SUPABASE_URL=https://<scratch-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<scratch anon key>
SUPABASE_SERVICE_ROLE_KEY=<scratch service-role key>
```

> **Check this before going further.** A half-edited file — new URL, production
> service-role key — is the shape of the accident this is guarding against.

Confirm what the file actually points at, rather than what you meant to type:

```bash
node -e "process.loadEnvFile('.env.restore-test'); console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)"
```

**It must print the scratch project's URL.** If it prints the production one,
stop and fix the file.

### 4. Dry run first — read the "into" line

```bash
node --env-file=.env.restore-test scripts/restore.mjs --from backups/<timestamp> --dry-run
```

It prints where it is reading from and where it would write:

```
  from   https://<production-ref>.supabase.co
  into   https://<scratch-ref>.supabase.co   (dry run)
```

**Read the `into` line. Every time.** If it names production, stop: your env
file is wrong. The script also refuses outright to restore into the project a
backup came from without `--force`, which is a second net under the same fall —
but the `into` line is the one you should be relying on.

### 5. Restore for real

Only once the dry run named the scratch project:

```bash
node --env-file=.env.restore-test scripts/restore.mjs --from backups/<timestamp> --force
```

`--force` is needed because the migrations seeded reference rows, so the target
is not empty. That is the flag's purpose here — not to override a warning about
production.

### 6. Check it came back

In the scratch project's SQL Editor:

```sql
select 'institutes' as t, count(*) from public.institutes
union all select 'visits',         count(*) from public.visits
union all select 'daily_plans',    count(*) from public.daily_plans
union all select 'targets', count(*) from public.targets
union all select 'profiles',       count(*) from public.profiles;
```

Compare against `manifest.json` in the backup. States, cities, purposes and
areas will be **higher** than the manifest — the migrations seeded them and the
restore upserted on top — which is expected. The rows that matter (institutes,
visits, plans, weekly targets, profiles) should match exactly.

Then prove a photo survived, which is the part a row count cannot tell you:
Storage → `visit-photos` → open a folder → download a file. It should be a real
photograph with the stamp burnt in, not a zero-byte placeholder.

Finally, check identity was preserved: a restored visit's `member` should still
match the same person's `profiles.id`. That is what makes the backup useful
rather than merely present.

### 7. Take the scratch project down

Delete it in the dashboard, and delete `.env.restore-test` locally:

```bash
rm .env.restore-test
```

It holds a service-role key for a project that is about to stop existing, but
the habit is what matters. Then confirm you are back to normal:

```bash
node -e "process.loadEnvFile('.env.local'); console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)"
```

Write down the date you did this. That date is the answer to "when did you last
prove the backups work?", and it is a much better answer than "they run weekly".

---

## What was tested, and what was not

Being precise about this, because a runbook nobody has executed is a wish.

**Proven on the real project (hosted Supabase):**

- `npm run backup` then `npm run restore`, as a full round trip: tagged data was
  seeded across all three exportable domains, backed up, **deleted** — rows,
  profile, auth user and photo file — and restored. Everything came back: the
  auth user with its **original id**, so the visit still pointed at the same
  member; coordinates, notes and the plan's held flag intact; and the photo file
  **byte-identical** (SHA-256 match). Test data was removed afterwards.
- The restore script's guards: it refuses a target that already holds visits,
  and refuses to restore into the project the backup came from, without
  `--force`.

**Proven on a clean PostgreSQL 17 container:**

- Migrations `0001`–`0003` rebuild the entire schema **unchanged** with only the
  compatibility prelude in front of them: 11 tables, RLS on all 11, 37 policies,
  8 triggers, 8 functions, 28 indexes, 79 CHECK constraints, 11 foreign keys,
  the storage bucket, and all seed data (36 states, 85 cities, 5 purposes).
- `0004` fails on plain Postgres with `extension "pg_cron" is not available` —
  which is why it has its own section above.
- The `pg_dump --data-only` → `pg_restore` path, into a schema built from the
  migrations. **Both failure modes in step 3 were reproduced deliberately**: 7
  errors when auth users are missing and the seeded rows are still there, then
  **zero** errors and matching row counts once users are restored first and the
  seeded tables are truncated. That is where the order in this document comes
  from.

**Not tested here — you will be the first to run these:**

- `pg_dump` against the live project. It needs the database password from
  Project Settings → Database, which this machine does not have; only the API
  keys are configured here. The commands are standard `pg_dump`, and the
  restore side of them was proven above.
- Restoring into a **second Supabase project**, since there is only one. Every
  step of it was proven against either the real project or the container, but
  never in a single continuous run.
- Migrating password hashes between projects (step 2, first option). The
  mechanism is a `pg_dump` of `auth.users`, which was proven in the container;
  whether Supabase's Auth accepts hashes moved between projects on your plan is
  worth confirming with one test account before you rely on it.

If you do a real move, do it once as a rehearsal into a free project first, with
the old one still running. Nothing here is expensive to repeat.
