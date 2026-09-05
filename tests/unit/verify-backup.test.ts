import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyBackup } from "../../scripts/verify-backup.mjs";
import { BACKUP_TABLES, PHOTO_BUCKET } from "../../scripts/tables.mjs";

/**
 * The backup verifier.
 *
 * This is the tool that answers "is that backup any good?" at the only moment
 * it matters, which is after something has gone wrong. A verifier that says
 * "fine" about a broken backup is worse than not having one, so every check it
 * claims to make is tested by breaking exactly that thing and expecting a
 * failure.
 *
 * Fixtures are written to a real temporary directory rather than mocked: the
 * script's whole job is reading a directory off a disk, and a mocked fs would
 * test the mock.
 */

type Table = { name: string; conflict: string };
const TABLES = BACKUP_TABLES as Table[];

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A structurally perfect backup, which individual tests then damage. */
function makeBackup(options: { photos?: number | null; users?: number } = {}) {
  const { photos = 1, users = 2 } = options;
  const root = mkdtempSync(join(tmpdir(), "kubeats-backup-"));
  dirs.push(root);

  mkdirSync(join(root, "tables"), { recursive: true });

  const counts: Record<string, number> = {};
  for (const { name, conflict } of TABLES) {
    // One row each, keyed the way a restore will upsert it.
    const rows = [{ [conflict]: conflict === "pincode" ? "380015" : "row-1" }];
    counts[name] = rows.length;
    writeFileSync(join(root, "tables", `${name}.json`), JSON.stringify(rows));
  }

  writeFileSync(
    join(root, "auth-users.json"),
    JSON.stringify(
      Array.from({ length: users }, (_, i) => ({ id: `user-${i}`, email: `user${i}@example.invalid` })),
    ),
  );

  if (photos !== null && photos > 0) {
    const folder = join(root, "storage", PHOTO_BUCKET, "user-0");
    mkdirSync(folder, { recursive: true });
    for (let i = 0; i < photos; i++) {
      writeFileSync(join(folder, `photo-${i}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
    }
  }

  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({
      takenAt: "2026-09-05T13:06:21.253Z",
      source: "https://example.supabase.co",
      tables: counts,
      authUsers: users,
      photos,
    }),
  );

  return root;
}

/** The one failing check, so a test can assert on the reason and not just the count. */
const failure = (root: string) => {
  const { checks } = verifyBackup(root);
  return checks.find((c: { ok: boolean }) => !c.ok);
};

describe("verifyBackup — a sound backup", () => {
  it("passes every check", () => {
    const { ok, checks } = verifyBackup(makeBackup());
    expect(ok).toBe(true);
    expect(checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
  });

  it("checks every table the backup script writes, so the two cannot drift", () => {
    const { checks } = verifyBackup(makeBackup());
    for (const { name } of TABLES) {
      expect(checks.some((c: { label: string }) => c.label.includes(`${name}.json`))).toBe(true);
    }
  });

  it("accepts a --no-photos backup, where the manifest records null", () => {
    const { ok, checks } = verifyBackup(makeBackup({ photos: null }));
    expect(ok).toBe(true);
    expect(checks.some((c: { detail: string }) => c.detail.includes("--no-photos"))).toBe(true);
  });

  it("accepts a backup of an empty project", () => {
    const root = makeBackup({ photos: 0, users: 0 });
    for (const { name } of TABLES) {
      writeFileSync(join(root, "tables", `${name}.json`), "[]");
    }
    writeFileSync(join(root, "auth-users.json"), "[]");
    const manifest = { takenAt: "t", source: "s", tables: Object.fromEntries(TABLES.map((t) => [t.name, 0])), authUsers: 0, photos: 0 };
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    expect(verifyBackup(root).ok).toBe(true);
  });
});

describe("verifyBackup — a backup that is not sound", () => {
  it("rejects a directory that does not exist", () => {
    const { ok } = verifyBackup(join(tmpdir(), "kubeats-does-not-exist-9f3a"));
    expect(ok).toBe(false);
  });

  it("rejects a directory with no manifest", () => {
    const root = makeBackup();
    rmSync(join(root, "manifest.json"));
    expect(failure(root)?.label).toContain("manifest.json present");
  });

  it("rejects a manifest that is not valid JSON", () => {
    const root = makeBackup();
    writeFileSync(join(root, "manifest.json"), "{ not json");
    expect(failure(root)?.label).toContain("manifest.json parses");
  });

  it("rejects a manifest missing takenAt or source", () => {
    const root = makeBackup();
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ tables: {} }));
    expect(verifyBackup(root).ok).toBe(false);
  });

  it("catches a missing table file", () => {
    const root = makeBackup();
    rmSync(join(root, "tables", "visits.json"));
    expect(failure(root)?.detail).toContain("file missing");
  });

  it("catches a truncated or corrupted table file", () => {
    const root = makeBackup();
    writeFileSync(join(root, "tables", "visits.json"), '[{"id":"row-1"');
    expect(failure(root)?.detail).toContain("invalid JSON");
  });

  it("catches a table file whose row count disagrees with the manifest", () => {
    const root = makeBackup();
    writeFileSync(join(root, "tables", "visits.json"), JSON.stringify([{ id: "a" }, { id: "b" }]));
    expect(failure(root)?.detail).toMatch(/manifest says 1, file holds 2/);
  });

  it("catches a row that could not be upserted, because it has no conflict key", () => {
    const root = makeBackup();
    writeFileSync(join(root, "tables", "visits.json"), JSON.stringify([{ notTheKey: 1 }]));
    expect(failure(root)?.detail).toContain('has no "id"');
  });

  it("names the table it could not verify, not just that something failed", () => {
    const root = makeBackup();
    rmSync(join(root, "tables", "weekly_targets.json"));
    expect(failure(root)?.label).toContain("weekly_targets");
  });

  it("catches a manifest written by a newer backup script", () => {
    const root = makeBackup();
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    manifest.tables.a_table_this_script_has_never_heard_of = 3;
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    expect(failure(root)?.detail).toContain("versions differ");
  });

  it("catches an auth user count that disagrees with the manifest", () => {
    const root = makeBackup({ users: 2 });
    writeFileSync(join(root, "auth-users.json"), JSON.stringify([{ id: "a", email: "a@b.c" }]));
    expect(failure(root)?.label).toContain("auth-users.json count");
  });

  it("catches an auth user with no id or email", () => {
    const root = makeBackup({ users: 1 });
    writeFileSync(join(root, "auth-users.json"), JSON.stringify([{ email: "a@b.c" }]));
    expect(failure(root)?.label).toContain("id and an email");
  });

  it("catches a photo count that disagrees with the manifest", () => {
    const root = makeBackup({ photos: 2 });
    rmSync(join(root, "storage", PHOTO_BUCKET, "user-0", "photo-1.jpg"));
    expect(failure(root)?.detail).toMatch(/manifest 2, on disk 1/);
  });

  it("catches a zero-byte photo, which is a failed download rather than a photo", () => {
    const root = makeBackup({ photos: 1 });
    writeFileSync(join(root, "storage", PHOTO_BUCKET, "user-0", "photo-0.jpg"), "");
    expect(failure(root)?.label).toContain("truncated");
  });

  it("catches a missing photo directory when the manifest claims photos", () => {
    const root = makeBackup({ photos: 1 });
    rmSync(join(root, "storage"), { recursive: true });
    expect(verifyBackup(root).ok).toBe(false);
  });

  it("catches an API key that has leaked into the backup", () => {
    const root = makeBackup();
    writeFileSync(
      join(root, "tables", "profiles.json"),
      JSON.stringify([{ id: "row-1", note: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlZmFrZQ" }]),
    );
    expect(failure(root)?.label).toContain("no API keys");
  });

  it("reports every problem at once, not just the first", () => {
    const root = makeBackup();
    rmSync(join(root, "tables", "visits.json"));
    rmSync(join(root, "tables", "profiles.json"));
    const { checks } = verifyBackup(root);
    expect(checks.filter((c: { ok: boolean }) => !c.ok).length).toBeGreaterThanOrEqual(2);
  });
});
