#!/usr/bin/env node
/**
 * KUbeats — check that a backup directory is sound.
 *
 *     npm run backup:verify -- backups/2026-09-05T13-06-19-324Z
 *
 * A backup nobody has read is a hypothesis. This reads one: it parses every
 * file, checks each table against the count the manifest claims, confirms every
 * row carries the key a restore upserts on, and counts the photos on disk.
 *
 * Deliberately OFFLINE. It needs no network, no Supabase project and no
 * service-role key, so it works on a backup pulled off an external drive a year
 * later, on a machine that has never seen the app. That is the moment you
 * actually need to know whether the thing is readable, and it is exactly the
 * moment credentials are hardest to come by.
 *
 * What it does NOT tell you: whether the backup matches production *now*
 * (nothing offline can), or whether a restore succeeds against a real project.
 * For that, rehearse into a scratch project — docs/BACKUP-RESTORE.md, "Proving
 * a backup actually restores".
 *
 * Exit code is 0 when every check passes and 1 when any fails, so it can be
 * used as a scheduled check as well as by hand.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BACKUP_BUCKETS, BACKUP_TABLES, PHOTO_BUCKET } from "./tables.mjs";

/**
 * Anything shaped like a Supabase credential. A backup should never carry one.
 *
 * Two shapes, because the project may run on either key system:
 *   - a JWT (legacy anon / service_role, and any user session token): eyJ….….…
 *   - a new-format API key: sb_secret_… or sb_publishable_…
 * The client runs this verifier after the migration to the new keys, so it has
 * to recognise a leaked new-format key too, not just the old JWT shape.
 */
const SECRET = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/;

/**
 * Reads a backup directory and reports on it.
 *
 * Returns every check rather than throwing on the first failure: when a backup
 * is wrong you want the whole picture, not the first symptom.
 */
export function verifyBackup(root) {
  const checks = [];
  const add = (ok, label, detail = "") => checks.push({ ok, label, detail });
  const done = () => ({ checks, ok: checks.every((c) => c.ok) });

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    add(false, "backup directory exists", root);
    return done();
  }
  add(true, "backup directory exists", root);

  // ---- manifest ------------------------------------------------------------
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) {
    add(false, "manifest.json present", "not found — is this a backup directory?");
    return done();
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    add(false, "manifest.json parses", error.message);
    return done();
  }

  const hasShape =
    typeof manifest.takenAt === "string" &&
    typeof manifest.source === "string" &&
    manifest.tables !== null &&
    typeof manifest.tables === "object";
  add(hasShape, "manifest.json parses and has the expected shape",
      hasShape ? `taken ${manifest.takenAt} from ${manifest.source}` : "missing takenAt, source or tables");
  if (!hasShape) return done();

  // ---- tables --------------------------------------------------------------
  //
  // A table BACKUP_TABLES names that the source database does not have YET has
  // no file, and that is correct rather than a gap. It happens for exactly one
  // window: a table is listed in the same commit as the migration that creates
  // it, so between merging and applying, the list is ahead of the database.
  //
  // The manifest records it as null rather than 0 - "we did not read this"
  // rather than "we read it and it was empty" - and the backup deliberately
  // writes no file, because an empty tables/x.json would look like an empty
  // table and a restore would treat it as authority.
  const absentUpstream = new Set(
    Object.entries(manifest.tables ?? {})
      .filter(([, count]) => count === null)
      .map(([name]) => name),
  );

  for (const { name, conflict } of BACKUP_TABLES) {
    if (absentUpstream.has(name)) {
      add(true, `tables/${name}.json`,
          "not in the source database yet — correctly absent, not missing");
      continue;
    }
    const file = join(root, "tables", `${name}.json`);
    if (!existsSync(file)) {
      add(false, `tables/${name}.json`, "file missing");
      continue;
    }

    let rows;
    try {
      rows = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      add(false, `tables/${name}.json`, `invalid JSON — ${error.message}`);
      continue;
    }

    if (!Array.isArray(rows)) {
      add(false, `tables/${name}.json`, "expected an array of rows");
      continue;
    }

    const claimed = manifest.tables[name];
    if (claimed === undefined) {
      add(false, `tables/${name}.json`, "the manifest does not mention this table");
      continue;
    }
    if (rows.length !== claimed) {
      add(false, `tables/${name}.json`, `manifest says ${claimed}, file holds ${rows.length}`);
      continue;
    }

    // Structural soundness for a restore: it upserts on `conflict`, so a row
    // without that column cannot come back. An empty table passes trivially.
    const missingKey = rows.findIndex((row) => row?.[conflict] === undefined || row[conflict] === null);
    if (missingKey !== -1) {
      add(false, `tables/${name}.json`, `row ${missingKey} has no "${conflict}" — a restore could not upsert it`);
      continue;
    }

    add(true, `tables/${name}.json`, `${rows.length} row(s), every one keyed by ${conflict}`);
  }

  // A table in the manifest with no file is the same failure seen from the
  // other side, and catches a backup written by a newer script than this one.
  const known = new Set(BACKUP_TABLES.map((t) => t.name));
  for (const name of Object.keys(manifest.tables)) {
    if (!known.has(name)) {
      add(false, `manifest mentions ${name}`, "this script does not know that table — versions differ");
    }
  }

  // ---- auth users ----------------------------------------------------------
  const usersPath = join(root, "auth-users.json");
  if (!existsSync(usersPath)) {
    add(false, "auth-users.json present", "file missing");
  } else {
    let users;
    try {
      users = JSON.parse(readFileSync(usersPath, "utf8"));
    } catch (error) {
      users = null;
      add(false, "auth-users.json parses", error.message);
    }

    if (Array.isArray(users)) {
      const claimed = manifest.authUsers;
      add(users.length === claimed, "auth-users.json count matches the manifest",
          `manifest ${claimed}, file ${users.length}`);

      const idsAndEmails = users.every((u) => typeof u?.id === "string" && typeof u?.email === "string");
      add(idsAndEmails, "every auth user has an id and an email",
          idsAndEmails ? `${users.length} user(s)` : "at least one is missing id or email");

      // Not a defect — the Auth admin API cannot return hashes — but if one
      // ever appeared it would change how this file must be stored.
      const hashed = /"(encrypted_password|password_hash)"/.test(JSON.stringify(users));
      add(!hashed, "no password hashes in the backup",
          hashed ? "found one — treat this file as a credential store"
                 : "expected: everyone needs a new password on restore");
    } else if (users !== null) {
      add(false, "auth-users.json parses", "expected an array");
    }
  }

  // ---- storage ---------------------------------------------------------------
  //
  // Every bucket, not only the photos. The materials bucket went unbacked-up for
  // months precisely because nothing here looked for it.
  for (const bucket of BACKUP_BUCKETS) {
    const claimed = manifest.buckets?.[bucket.name] ?? (
      bucket.name === PHOTO_BUCKET ? manifest.photos : undefined
    );
    const bucketRoot = join(root, "storage", bucket.name);

    if (claimed === null || claimed === undefined) {
      add(bucket.name === PHOTO_BUCKET ? manifest.photos === null : true,
          `storage/${bucket.name}`,
          manifest.photos === null
            ? "skipped — this backup was taken with --no-photos"
            : "the manifest does not mention this bucket — taken by an older script");
      continue;
    }

    if (!existsSync(bucketRoot)) {
      add(claimed === 0, `storage/${bucket.name}`,
          claimed === 0 ? "no files to store" : `manifest claims ${claimed}, directory missing`);
      continue;
    }

    const files = readdirSync(bucketRoot, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile());
    add(files.length === claimed, `${bucket.label} count matches the manifest`,
        `manifest ${claimed}, on disk ${files.length}`);

    const empty = files.filter((e) => statSync(join(e.parentPath ?? e.path, e.name)).size === 0);
    add(empty.length === 0, `no truncated ${bucket.label} files`,
        empty.length === 0 ? `${files.length} file(s), all non-empty` : `${empty.length} zero-byte file(s)`);
  }

  // ---- coverage --------------------------------------------------------------
  //
  // This script is deliberately offline, so it cannot ask the database what
  // tables exist. What it CAN insist on is that the backup script asked, and
  // recorded the answer. A backup with no coverage block was taken before the
  // check existed and may be missing whole tables without saying so.
  const coverage = manifest.coverage;
  add(coverage?.checked === true, "the backup verified its own table coverage",
      coverage?.checked === true
        ? `${coverage.backedUp.length} backed up, ${coverage.notBackedUp.length} deliberately not`
        : "no coverage block — taken by a script that could not check for missing tables");

  if (coverage?.checked === true) {
    const listed = new Set([...(coverage.backedUp ?? []), ...(coverage.notBackedUp ?? [])]);
    const uncovered = (coverage.liveTables ?? []).filter((t) => !listed.has(t));
    add(uncovered.length === 0, "every table in the database was accounted for",
        uncovered.length === 0
          ? `${(coverage.liveTables ?? []).length} table(s) in the source database`
          : `not covered: ${uncovered.join(", ")}`);

    const missingFiles = (coverage.backedUp ?? []).filter(
      (t) => !absentUpstream.has(t) && !existsSync(join(root, "tables", `${t}.json`)));
    add(missingFiles.length === 0, "every table it claims to back up has a file",
        missingFiles.length === 0 ? "" : `no file for: ${missingFiles.join(", ")}`);
  }

  // ---- secrets -------------------------------------------------------------
  // Cheap and worth doing: a backup is copied to drives and shared far more
  // casually than a repository, so a key in one travels further.
  const textFiles = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(json|txt|md)$/.test(e.name))
    .map((e) => join(e.parentPath ?? e.path, e.name));
  const withSecrets = textFiles.filter((f) => SECRET.test(readFileSync(f, "utf8")));
  add(withSecrets.length === 0, "no API keys or tokens in the backup",
      withSecrets.length === 0 ? `${textFiles.length} file(s) scanned` : withSecrets.join(", "));

  return done();
}

// ---- CLI -------------------------------------------------------------------

function main(argv) {
  const dir = argv.find((a) => !a.startsWith("--"));
  if (!dir) {
    console.error(
      "Which backup?\n" +
        "  npm run backup:verify -- backups/<timestamp>\n\n" +
        "Checks a backup directory on its own terms — no network, no keys needed.",
    );
    process.exit(2);
  }

  const root = resolve(dir);
  const { checks, ok } = verifyBackup(root);

  const width = Math.max(...checks.map((c) => c.label.length));
  for (const c of checks) {
    console.log(`[${c.ok ? " OK " : "FAIL"}] ${c.label.padEnd(width)}  ${c.detail}`);
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(
    ok
      ? `\nBackup verified — ${checks.length} checks passed.\n` +
        "This says the backup is readable and internally consistent. To prove it\n" +
        "restores, rehearse into a scratch project — see docs/BACKUP-RESTORE.md."
      : `\n${failed} of ${checks.length} checks FAILED. Do not rely on this backup.`,
  );
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
