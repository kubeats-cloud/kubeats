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

## Routine backup

```bash
npm run backup                  # → ./backups/<timestamp>/
npm run backup -- --no-photos   # rows and users only, much faster
npm run backup -- --out D:/field-ops-backups
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

Run `0001` → `0002` → `0003` → `0004` in the SQL editor, exactly as
`README.md` describes. The schema, RLS, triggers, indexes, the storage bucket
and the seed data all come from these files — nothing else is needed to rebuild
the structure.

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
```

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
