#!/usr/bin/env node
/**
 * Field Ops — routine data backup.
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
import { BACKUP_TABLES, PHOTO_BUCKET } from "./tables.mjs";

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

async function main() {
  const { url, key } = loadEnv();
  const db = createClient(url, key, { auth: { persistSession: false } });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = resolve(String(arg("out", join("backups", stamp))));
  const withPhotos = process.argv.indexOf("--no-photos") === -1;

  mkdirSync(join(root, "tables"), { recursive: true });
  console.log(`Backing up ${url}\n  into ${root}\n`);

  // 1. Table rows -----------------------------------------------------------
  const counts = {};
  for (const { name: table } of BACKUP_TABLES) {
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
  let photoCount = 0;
  let photoBytes = 0;
  if (withPhotos) {
    mkdirSync(join(root, "storage", PHOTO_BUCKET), { recursive: true });
    const { data: folders, error } = await db.storage.from(PHOTO_BUCKET).list("");
    if (error) throw new Error(`storage: ${error.message}`);

    for (const folder of folders ?? []) {
      if (folder.name === ".emptyFolderPlaceholder") continue;
      const { data: files } = await db.storage.from(PHOTO_BUCKET).list(folder.name);
      for (const file of files ?? []) {
        const path = `${folder.name}/${file.name}`;
        const { data: blob, error: downloadError } = await db.storage
          .from(PHOTO_BUCKET)
          .download(path);
        if (downloadError || !blob) {
          console.warn(`    ! could not download ${path}: ${downloadError?.message}`);
          continue;
        }
        mkdirSync(join(root, "storage", PHOTO_BUCKET, folder.name), { recursive: true });
        const bytes = Buffer.from(await blob.arrayBuffer());
        writeFileSync(join(root, "storage", PHOTO_BUCKET, path), bytes);
        photoCount += 1;
        photoBytes += bytes.length;
      }
    }
    console.log(`  ${"photos".padEnd(20)} ${photoCount} (${Math.round(photoBytes / 1024)} KB)`);
  } else {
    console.log(`  ${"photos".padEnd(20)} skipped (--no-photos)`);
  }

  // 4. Manifest -------------------------------------------------------------
  const manifest = {
    takenAt: new Date().toISOString(),
    source: url,
    tables: counts,
    authUsers: users.length,
    photos: withPhotos ? photoCount : null,
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
  process.exit(1);
});
