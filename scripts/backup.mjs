#!/usr/bin/env node
/**
 * KUbeats — routine data backup.
 *
 *     npm run backup                    # into ./backups/<timestamp>/
 *     npm run backup -- --out /path     # somewhere else
 *     npm run backup -- --no-photos     # rows and users only, much faster
 *
 * Writes the three domains that a Postgres dump alone does not give you in one
 * piece: table rows, auth users, and the photo files in the private bucket.
 * Everything lands as plain JSON and plain files, so it can be read by anything
 * — psql, a script, a person — and restored into hosted Supabase, self-hosted
 * Supabase, or a plain Postgres database.
 *
 * What it deliberately does NOT capture, because it cannot: password hashes
 * (the Auth admin API never returns them), the Vault secret from migration
 * 0004, and the pg_cron schedule. Those are re-established by hand on restore —
 * docs/BACKUP-RESTORE.md says exactly how, and this script prints the reminder.
 *
 * Needs the same .env.local the app uses. The service-role key is read from the
 * environment and never written into the backup.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { BACKUP_BUCKETS, BACKUP_TABLES, NOT_BACKED_UP, PHOTO_BUCKET } from "./tables.mjs";

const PAGE = 1000;

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}

function loadEnv() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Already exported into the environment, or genuinely absent.
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Copy .env.example to .env.local and fill it in, or export them first.",
    );
    process.exit(1);
  }
  return { url, key };
}

/** Reads a whole table in pages, so a big visits table cannot be truncated. */
async function readAll(db, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * Every table the database actually exposes, from PostgREST's own OpenAPI
 * document. Asked for at backup time rather than hard-coded, because the whole
 * point is to notice a table this script has never heard of.
 */
async function livePublicTables(url, key) {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`could not read the API schema: HTTP ${res.status}`);
  const spec = await res.json();
  return Object.keys(spec.definitions ?? {}).sort();
}

/**
 * THE ANTI-DRIFT CHECK, and the reason it exists.
 *
 * visit_people, institute_status_history and materials were each added by a
 * migration and never added to BACKUP_TABLES. Nothing complained: the backup
 * succeeded, the verifier passed, and a restore would simply have come back
 * without every closing-report contact and the entire status audit trail. The
 * failure mode of a forgotten table is a backup that looks perfect.
 *
 * So a table the database has and this script does not know about is a hard
 * failure, not a warning. Adding it to BACKUP_TABLES or, with a reason, to
 * NOT_BACKED_UP is a one-line change; losing a table is not recoverable.
 */
function assertCoverage(liveTables) {
  const covered = new Set([
    ...BACKUP_TABLES.map((t) => t.name),
    ...NOT_BACKED_UP.map((t) => t.name),
  ]);
  const unknown = liveTables.filter((t) => !covered.has(t));
  const stale = [...covered].filter((t) => !liveTables.includes(t));

  if (unknown.length > 0) {
    throw new Error(
      `these tables exist in the database and are in neither list in ` +
        `scripts/tables.mjs:
    ${unknown.join(", ")}
` +
        `  Add each one to BACKUP_TABLES, or to NOT_BACKED_UP with a reason.`,
    );
  }
  if (stale.length > 0) {
    console.warn(
      `  ! scripts/tables.mjs names ${stale.join(", ")}, which the database ` +
        `does not have.
    Harmless, but the list has drifted the other way.`,
    );
  }
  return { checked: true, liveTables, backedUp: BACKUP_TABLES.map((t) => t.name),
    notBackedUp: NOT_BACKED_UP.map((t) => t.name) };
}

async function main() {
  const { url, key } = loadEnv();
  const db = createClient(url, key, { auth: { persistSession: false } });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = resolve(String(arg("out", join("backups", stamp))));
  const withPhotos = process.argv.indexOf("--no-photos") === -1;

  mkdirSync(join(root, "tables"), { recursive: true });
  console.log(`Backing up ${url}\n  into ${root}\n`);

  // Before a single row is written: does this script still know the whole
  // schema? A table it has never heard of stops the backup here, rather than
  // producing one that looks complete and is not.
  const coverage = assertCoverage(await livePublicTables(url, key));

  // 1. Table rows -----------------------------------------------------------
  const counts = {};
  for (const { name: table } of BACKUP_TABLES) {
    // A table this list names but the database does not have yet.
    //
    // assertCoverage already calls that case "harmless" and warns rather than
    // throwing - and then this loop killed the run anyway, which made the two
    // disagree. It matters because of WHEN it happens: a table is listed here
    // in the same commit as the migration that creates it, so the gap is the
    // window between merging and applying. That is exactly when somebody would
    // want a backup, and refusing to take one then is the worst possible
    // moment to refuse.
    //
    // Skipped, counted as absent, and reported. The file is deliberately not
    // written: an empty tables/campuses.json would look like a table that
    // exists and is empty, and a restore would read it as authority.
    if (coverage.checked && !coverage.liveTables.includes(table)) {
      counts[table] = null;
      console.log(`  ${table.padEnd(20)} - (not in the database yet)`);
      continue;
    }

    const rows = await readAll(db, table);
    counts[table] = rows.length;
    writeFileSync(
      join(root, "tables", `${table}.json`),
      JSON.stringify(rows, null, 1),
    );
    console.log(`  ${table.padEnd(20)} ${rows.length}`);
  }

  // 2. Auth users -----------------------------------------------------------
  //
  // Not table rows: they live in the auth schema and are only reachable through
  // the admin API. Password hashes are never returned, which is why a restore
  // means re-inviting people or setting new temporary passwords.
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth users: ${error.message}`);
    users.push(
      ...data.users.map((user) => ({
        id: user.id,
        email: user.email,
        email_confirmed_at: user.email_confirmed_at,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        user_metadata: user.user_metadata,
      })),
    );
    if (data.users.length < 200) break;
  }
  writeFileSync(join(root, "auth-users.json"), JSON.stringify(users, null, 1));
  console.log(`  ${"auth users".padEnd(20)} ${users.length} (no password hashes — see the runbook)`);

  // 3. Storage --------------------------------------------------------------
  //
  // Both private buckets, not just the photos. The materials bucket was added
  // in migration 0012 and went four months without being backed up; a poster or
  // a fee sheet exists nowhere else once it is uploaded.
  const bucketCounts = {};
  let photoCount = 0;
  if (withPhotos) {
    for (const bucket of BACKUP_BUCKETS) {
      mkdirSync(join(root, "storage", bucket.name), { recursive: true });
      const { data: folders, error } = await db.storage.from(bucket.name).list("");
      if (error) throw new Error(`storage ${bucket.name}: ${error.message}`);

      let count = 0;
      let bytesTotal = 0;
      for (const folder of folders ?? []) {
        if (folder.name === ".emptyFolderPlaceholder") continue;
        const { data: files } = await db.storage.from(bucket.name).list(folder.name);
        for (const file of files ?? []) {
          if (file.name === ".emptyFolderPlaceholder") continue;
          const path = `${folder.name}/${file.name}`;
          const { data: blob, error: downloadError } = await db.storage
            .from(bucket.name)
            .download(path);
          if (downloadError || !blob) {
            console.warn(`    ! could not download ${bucket.name}/${path}: ${downloadError?.message}`);
            continue;
          }
          mkdirSync(join(root, "storage", bucket.name, folder.name), { recursive: true });
          const bytes = Buffer.from(await blob.arrayBuffer());
          writeFileSync(join(root, "storage", bucket.name, path), bytes);
          count += 1;
          bytesTotal += bytes.length;
        }
      }
      bucketCounts[bucket.name] = count;
      if (bucket.name === PHOTO_BUCKET) photoCount = count;
      console.log(`  ${bucket.label.padEnd(20)} ${count} (${Math.round(bytesTotal / 1024)} KB)`);
    }
  } else {
    for (const bucket of BACKUP_BUCKETS) bucketCounts[bucket.name] = null;
    console.log(`  ${"files".padEnd(20)} skipped (--no-photos)`);
  }

  // 4. Manifest -------------------------------------------------------------
  const manifest = {
    takenAt: new Date().toISOString(),
    source: url,
    tables: counts,
    authUsers: users.length,
    photos: withPhotos ? photoCount : null,
    // Per bucket, so a restore and the verifier can both check every one of
    // them rather than only the photos.
    buckets: bucketCounts,
    // Proof the coverage check ran, so the offline verifier can insist on it.
    coverage,
    // Read this on restore. These four cannot be in the backup at all.
    notRestorableFromThisBackup: [
      "password hashes — everyone signs in with a new temporary password",
      "the Vault secrets from migration 0004 (project_url, service_role_key)",
      "the pg_cron schedule from migration 0004",
      "anything in the auth schema beyond the fields listed in auth-users.json",
    ],
  };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\nDone. ${root}`);
  console.log(
    "Not in this backup, and needed on restore: password hashes, the Vault\n" +
      "secret and the cron job. See docs/BACKUP-RESTORE.md.",
  );
}

main().catch((error) => {
  console.error(`\nBackup failed: ${error.message}`);
  // exitCode rather than exit(): the coverage check above opens an HTTP
  // connection, and tearing the process down while that socket is still live
  // makes libuv abort on Windows with a confusing code instead of a clean 1.
  // Setting the code and letting Node drain gives the same failure, legibly.
  process.exitCode = 1;
});
