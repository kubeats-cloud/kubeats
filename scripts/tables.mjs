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
  { name: "weekly_targets", conflict: "id" },
  { name: "pincodes_cache", conflict: "pincode" },
  { name: "photo_purge_runs", conflict: "id", regenerateId: true },
];

export const PHOTO_BUCKET = "visit-photos";
