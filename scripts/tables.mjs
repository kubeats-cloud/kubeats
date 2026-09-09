/**
 * The tables a backup carries, in an order a restore can replay without
 * tripping a foreign key, and the fact each one needs to come back.
 *
 * `conflict` is the key a restore upserts on. It is not always "id":
 * pincodes_cache is keyed by the PIN itself.
 *
 * `regenerateId` marks a table whose primary key is `generated always as
 * identity`. Postgres refuses an explicit value for one of those, so the id is
 * dropped and a new one assigned. Only the purge audit log is like that, where
 * the row is the record and its number means nothing.
 *
 * KEEP THIS LIST COMPLETE. A four-pass audit found three tables that had been
 * added by later migrations and never added here, so a restore would have come
 * back missing every closing-report contact and the whole status audit trail.
 * `npm run backup:verify` now fails when a public table has no entry in either
 * list below, which is the check that stops this happening again — but it can
 * only compare against what it is told, so a new table goes in one of the two
 * lists here as part of the migration that creates it.
 */
export const BACKUP_TABLES = [
  { name: "profiles", conflict: "id" },
  { name: "location_states", conflict: "id" },
  { name: "location_cities", conflict: "id" },
  { name: "location_areas", conflict: "id" },
  { name: "purposes", conflict: "id" },
  { name: "institutes", conflict: "id" },
  { name: "daily_plans", conflict: "id" },
  { name: "visits", conflict: "id" },
  // After visits: every row points at one, and a restore replays in this order.
  { name: "visit_people", conflict: "id" },
  // After visits and institutes, for the same reason. Append-only in the
  // database and irreplaceable: nothing can reconstruct who changed a status
  // and when, so losing it loses the audit trail outright.
  { name: "institute_status_history", conflict: "id" },
  { name: "targets", conflict: "id" },
  // The rows that describe the files in the materials bucket. Backed up with
  // the bucket below; a row without its file renders as unavailable, and a file
  // without its row is invisible and permanent.
  { name: "materials", conflict: "id" },
  { name: "pincodes_cache", conflict: "pincode" },
  { name: "photo_purge_runs", conflict: "id", regenerateId: true },
];

/**
 * Tables that are deliberately NOT backed up, and the reason. Every public
 * table has to appear either here or above, or `npm run backup:verify` fails.
 * A reason is required: "we forgot" and "it does not need backing up" look
 * identical in a list of names.
 */
export const NOT_BACKED_UP = [
  {
    name: "institute_statuses",
    reason:
      "a fixed lookup of nine statuses, recreated in full by migration 0010. " +
      "Restoring it would fight the migration for the same rows.",
  },
  {
    name: "place_cache",
    reason:
      "a cache of OpenStreetMap area names, keyed by rounded coordinates. " +
      "Regenerates itself on demand and is decoration by design.",
  },
  {
    name: "checkin_sweep_runs",
    reason:
      "the nightly check-in sweep's log (migration 0018): one row per run, " +
      "saying how many orphaned visits it closed. Operational telemetry about " +
      "the JOB, not a record of the work - what it changed is on daily_plans, " +
      "which is backed up. It refills itself the next night, and a restored " +
      "copy would describe runs against a database that no longer exists. " +
      "NOTE it is treated differently from photo_purge_runs, which IS backed " +
      "up: that one is the only evidence that photographs were deleted and " +
      "when, and a deletion nobody can account for is worth keeping. This one " +
      "records a state change that daily_plans already carries.",
  },
];

/**
 * The storage buckets a backup carries. Both are private; both hold files that
 * exist nowhere else.
 *
 *   visit-photos  a rep's evidence. Retained for a limited window (migration
 *                 0003), so a backup is the only copy of anything older.
 *   materials     the library an admin uploads. Never expires, never
 *                 regenerated, and a poster nobody kept a copy of is gone.
 */
export const BACKUP_BUCKETS = [
  { name: "visit-photos", label: "photos" },
  { name: "materials", label: "materials" },
];

/** Kept as a named export: the retention job and the runbook both mean this one. */
export const PHOTO_BUCKET = "visit-photos";

/**
 * THE RESTORE CONTRACT: a restore targets a database that has the SCHEMA but
 * not the seed.
 *
 * Migrations 0001 and 0010 seed reference data - 36 states, 85 cities, 5
 * purposes, 9 statuses - so a freshly migrated database is not empty. A backup
 * carries its own copy of the same tables, and the two disagree about ids,
 * because production has been adding cities and areas through the app ever
 * since. A rehearsal proved what that costs: restoring 88 cities onto 85
 * seeded ones produced 173, because the upsert matches on id and the ids differ.
 *
 * So for the tables listed here the BACKUP is the authority, not the seed, and
 * a restore clears them first. They are listed in delete order: areas reference
 * cities, cities reference states, and Postgres will refuse it the other way
 * round.
 *
 * Deliberately NOT in this list: everything the backup and the seed cannot
 * disagree about. institute_statuses is owned by migration 0010 and is not in
 * the backup at all; institutes, visits and the rest have no seed to collide
 * with, so an upsert by id is exactly right for them.
 */
export const SEED_OWNED_BY_BACKUP = [
  "location_areas",
  "location_cities",
  "location_states",
  "purposes",
];
