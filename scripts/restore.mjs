#!/usr/bin/env node
/**
 * KUbeats — restore a backup into a Supabase project.
 *
 *     npm run restore -- --from backups/<timestamp>
 *     npm run restore -- --from <dir> --dry-run     # say what would happen
 *     npm run restore -- --from <dir> --only visits,profiles
 *
 * Restores the three domains `backup.mjs` captured: auth users first (rows
 * reference them), then table rows in dependency order, then the photo files.
 *
 * It targets whatever NEXT_PUBLIC_SUPABASE_URL points at, so **check which
 * project you are pointed at before running it**. It refuses to run against a
 * project that already holds data unless you pass --force, because the usual
 * way to lose a database is to restore into the wrong one.
 *
 * Rows are upserted by primary key, so re-running is safe and a partial restore
 * can simply be run again.
 *
 * Users come back without passwords — the Auth API never exports a hash. Each
 * one is created with a random password and a confirmed email; everybody needs
 * a new temporary password from Settings → Team, or a reset link. That is a
 * property of Supabase Auth, not of this script.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { BACKUP_BUCKETS, BACKUP_TABLES, SEED_OWNED_BY_BACKUP } from "./tables.mjs";

const CHUNK = 200;

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
}
const has = (name) => process.argv.includes(`--${name}`);

function loadEnv() {
  try {
    process.loadEnvFile(".env.local");
  } catch {}
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  return { url, key };
}

const readJson = (path) =>
  existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;

async function main() {
  const from = arg("from");
  if (!from) {
    console.error("Which backup? --from backups/<timestamp>");
    process.exit(1);
  }
  const root = resolve(String(from));
  const manifest = readJson(join(root, "manifest.json"));
  if (!manifest) {
    console.error(`No manifest.json in ${root} — is that a backup directory?`);
    process.exit(1);
  }

  const { url, key } = loadEnv();
  const db = createClient(url, key, { auth: { persistSession: false } });
  const dryRun = has("dry-run");
  const only = arg("only");
  const wanted = only ? String(only).split(",").map((t) => t.trim()) : null;
  const tables = wanted
    ? BACKUP_TABLES.filter((t) => wanted.includes(t.name))
    : BACKUP_TABLES;

  console.log(`Backup taken ${manifest.takenAt}`);
  console.log(`  from   ${manifest.source}`);
  console.log(`  into   ${url}${dryRun ? "   (dry run)" : ""}\n`);

  if (manifest.source === url && !has("force")) {
    console.log("Restoring into the same project the backup came from.");
    console.log("That is usually a mistake. Pass --force if you mean it.\n");
    if (!dryRun) process.exit(1);
  }

  // Refuse to restore on top of a project that is already in use.
  if (!dryRun && !has("force")) {
    const { count } = await db
      .from("visits")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) > 0) {
      console.error(
        `The target already holds ${count} visits. Restore into a clean project,\n` +
          "or pass --force if you are deliberately merging.",
      );
      process.exit(1);
    }
  }

  // 1. Auth users, before any row that references them ----------------------
  const users = readJson(join(root, "auth-users.json")) ?? [];
  let created = 0;
  let existing = 0;
  for (const user of users) {
    if (dryRun) continue;
    const { error } = await db.auth.admin.createUser({
      // The id is preserved, which is what keeps every profile, visit and plan
      // pointing at the right person.
      id: user.id,
      email: user.email,
      email_confirm: Boolean(user.email_confirmed_at),
      password: `restored-${randomUUID()}`,
      user_metadata: user.user_metadata ?? {},
    });
    if (error) {
      if (/already/i.test(error.message)) existing += 1;
      else console.warn(`    ! ${user.email}: ${error.message}`);
    } else {
      created += 1;
    }
  }
  console.log(
    `  ${"auth users".padEnd(20)} ${dryRun ? `${users.length} would be created` : `${created} created, ${existing} already there`}`,
  );

  // 2. Clear the seeded reference tables ------------------------------------
  //
  // See SEED_OWNED_BY_BACKUP in tables.mjs. The migrations seed states, cities
  // and purposes; the backup carries its own, with different ids and usually
  // more of them. Upserting one onto the other does not merge, it accumulates -
  // a rehearsal turned 85 + 88 cities into 173. For these tables the backup is
  // the authority, so they are emptied first.
  //
  // Only reached for a table the backup actually contains: a --tables run that
  // does not include them must not quietly delete them.
  const clearing = SEED_OWNED_BY_BACKUP.filter(
    (t) => tables.some((x) => x.name === t) && readJson(join(root, "tables", `${t}.json`)),
  );
  if (clearing.length > 0) {
    for (const table of clearing) {
      if (dryRun) continue;
      // A predicate that matches everything, because PostgREST refuses an
      // unqualified delete - which is a good rule, and this is the exception.
      const { error } = await db.from(table).delete().not("id", "is", null);
      if (error) throw new Error(`clearing ${table}: ${error.message}`);
    }
    console.log(
      `  ${"seed cleared".padEnd(20)} ${dryRun ? "would clear" : "cleared"} ${clearing.join(", ")}`,
    );
  }

  // 2. Table rows -----------------------------------------------------------
  for (const { name: table, conflict, regenerateId } of tables) {
    const stored = readJson(join(root, "tables", `${table}.json`));
    if (!stored) {
      console.log(`  ${table.padEnd(20)} (not in this backup)`);
      continue;
    }
    // An identity primary key cannot be given an explicit value, so it is left
    // out and Postgres assigns a fresh one.
    const rows = regenerateId
      ? stored.map((row) => {
          const copy = { ...row };
          delete copy.id;
          return copy;
        })
      : stored;

    if (dryRun) {
      console.log(`  ${table.padEnd(20)} ${rows.length} would be restored`);
      continue;
    }

    let done = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = regenerateId
        ? await db.from(table).insert(chunk)
        : await db.from(table).upsert(chunk, { onConflict: conflict });
      if (error) {
        console.error(`  ${table.padEnd(20)} FAILED: ${error.message}`);
        console.error("    Restore stops here so the cause can be read, not buried.");
        process.exit(1);
      }
      done += chunk.length;
    }
    console.log(`  ${table.padEnd(20)} ${done} restored`);
  }

  // 3. Storage ---------------------------------------------------------------
  //
  // Every bucket the backup carries, not only the photos. A material is a PDF
  // or an image, so the content type comes from the extension rather than being
  // assumed: uploading a PDF as image/jpeg would store it unreadable, and the
  // materials bucket's allowed_mime_types would refuse it outright.
  const CONTENT_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".pdf": "application/pdf",
  };
  const contentTypeFor = (file) => {
    const dot = file.lastIndexOf(".");
    return CONTENT_TYPES[dot === -1 ? "" : file.slice(dot).toLowerCase()]
      ?? "application/octet-stream";
  };

  for (const bucket of BACKUP_BUCKETS) {
    const storageRoot = join(root, "storage", bucket.name);
    if (!existsSync(storageRoot)) {
      console.log(`  ${bucket.label.padEnd(20)} (none in this backup)`);
      continue;
    }
    let uploaded = 0;
    for (const folder of readdirSync(storageRoot)) {
      const folderPath = join(storageRoot, folder);
      if (!statSync(folderPath).isDirectory()) continue;
      for (const file of readdirSync(folderPath)) {
        if (dryRun) {
          uploaded += 1;
          continue;
        }
        const { error } = await db.storage
          .from(bucket.name)
          .upload(`${folder}/${file}`, readFileSync(join(folderPath, file)), {
            contentType: contentTypeFor(file),
            upsert: true,
          });
        if (error) console.warn(`    ! ${bucket.name}/${folder}/${file}: ${error.message}`);
        else uploaded += 1;
      }
    }
    console.log(
      `  ${bucket.label.padEnd(20)} ${dryRun ? `${uploaded} would be uploaded` : `${uploaded} uploaded`}`,
    );
  }

  console.log("\nStill to do by hand, because no backup can carry them:");
  console.log("  1. Give everyone a new password (Settings → Team, or a reset link).");
  console.log("  2. Re-run migration 0004 to store the Vault secrets and schedule the purge.");
  console.log("  3. Point the app at this project and rebuild (NEXT_PUBLIC_* is inlined).");
  console.log("     docs/BACKUP-RESTORE.md has the detail.");
}

main().catch((error) => {
  console.error(`\nRestore failed: ${error.message}`);
  process.exit(1);
});
