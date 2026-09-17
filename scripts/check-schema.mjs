/**
 * Which migrations has this database actually had?
 *
 * WHY THIS EXISTS. The app and the schema are deployed by two different people
 * at two different moments — `wrangler deploy` on one side, pasting a file into
 * the Supabase SQL editor on the other — and several migrations in this repo
 * are DEPLOY-COUPLED on purpose. CLAUDE.md marks 0027 in particular. So the
 * window where the two halves disagree is one the project deliberately allows
 * itself to enter, and until now there was nothing that could see into it.
 *
 * What that cost, once: a build shipped that expects 0024-0026 against a
 * database still at 0022. Every mutation on Settings failed, each with a
 * sentence that read like a network blip, and the admin surface looked broken
 * for reasons nobody could see from outside. `/api/health` answers "has the new
 * BUILD gone out" and could not have caught it — this is the other half of the
 * same question.
 *
 * HOW IT WORKS, AND WHAT IT CANNOT DO. It asks PostgREST for one column that
 * each migration adds. A column is evidence the migration RAN; it is not
 * evidence that every trigger, policy and CHECK in that file is in place. Each
 * migration's own assertion block is what proves that, and it prints a notice
 * when you run it. This is a smoke test for "is the database roughly where the
 * code thinks it is", which is the question that actually goes wrong.
 *
 * Read-only. It selects and never writes.
 *
 *     node scripts/check-schema.mjs                     # whatever .env.local points at
 *     SUPABASE_URL=... SUPABASE_KEY=... node scripts/...   # any other project
 *
 * IT NEEDS THE SERVICE-ROLE KEY, not the anon one. The probes read tables that
 * are behind RLS and, in the case of `campuses`, behind a grant the anon role
 * does not have at all — so an anon key gets four probes in and stops with
 * `42501 permission denied`. That is checked for by name below and explained,
 * because "permission denied for table campuses" is a baffling thing to be told
 * when you asked which migrations are applied.
 *
 * BOTH VARIABLES OR NEITHER. `process.loadEnvFile` does not overwrite a value
 * that is already set, so SUPABASE_URL wins over .env.local's — but passing
 * only the URL leaves the KEY coming from .env.local, which means one project's
 * key against another project's URL. That is refused below rather than left to
 * fail as a confusing 401 twenty lines later.
 *
 * Exits 1 when anything the current code needs is missing, so it can gate a
 * deploy. Exits 2 when it could not look.
 */

import { createClient } from "@supabase/supabase-js";

// Read the explicit pair BEFORE the env file, so "was this passed in?" is
// answerable afterwards. loadEnvFile does not overwrite, but it does fill in,
// and a filled-in half is the dangerous case.
const passedUrl = process.env.SUPABASE_URL;
const passedKey = process.env.SUPABASE_KEY;

try {
  process.loadEnvFile(".env.local");
} catch {
  // Fine — the variables may come from the environment instead.
}

const url = passedUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
// The anon key is deliberately NOT in this chain: it cannot complete the run,
// so accepting one only buys a confusing failure four probes later.
const key = passedKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    [
      "Need a Supabase URL and a SERVICE-ROLE key.",
      "",
      "  from .env.local:  node scripts/check-schema.mjs",
      "  another project:  SUPABASE_URL=https://<ref>.supabase.co \\",
      "                    SUPABASE_KEY=<service-role key> \\",
      "                    node scripts/check-schema.mjs",
      "",
      "The anon key will not do: the probes read tables it has no grant on.",
    ].join("\n"),
  );
  process.exit(2);
}

// ONE PROJECT AT A TIME. Overriding the URL and letting the key fall through to
// .env.local points the dev project's key at another project's API, which fails
// as an opaque 401. Say which half is missing instead.
if (Boolean(passedUrl) !== Boolean(passedKey)) {
  console.error(
    `Pass SUPABASE_URL and SUPABASE_KEY together, or neither. Only ${
      passedUrl ? "SUPABASE_URL" : "SUPABASE_KEY"
    } was given, so the other half would come from .env.local — a different project.`,
  );
  process.exit(2);
}

/**
 * One probe per migration: a column that file adds and nothing else does.
 *
 * `needs` is whether the CODE ON THIS BRANCH depends on it. A migration that is
 * merely nice to have is reported and does not fail the run — 0023 only
 * loosens, so an app running against a database without it still works, it just
 * also asks for a follow-up time nothing renders.
 */
const PROBES = [
  { id: "0014", table: "daily_plans", column: "checkin_at", needs: true },
  { id: "0015", table: "daily_plans", column: "checkin_accuracy", needs: true },
  { id: "0018", table: "daily_plans", column: "checkin_location_manual", needs: true },
  { id: "0019", table: "visits", column: "met_name", needs: true },
  { id: "0020a", table: "campuses", column: "id", needs: true },
  { id: "0022", table: "visits", column: "students_reached", needs: true },
  { id: "0024", table: "purposes", column: "activity", needs: true },
  { id: "0025", table: "purposes", column: "lifecycle", needs: true },
  { id: "0025", table: "daily_plans", column: "purpose_id", needs: true },
  { id: "0026", table: "institute_statuses", column: "tone", needs: true },
  { id: "0026", table: "institute_statuses", column: "is_active", needs: true },
  { id: "0026", table: "institute_statuses", column: "asks_expected_date", needs: true },
];

/*
 * WHAT THIS CHECK CANNOT SEE, stated rather than quietly omitted.
 *
 * 0023 and 0027 to 0030 add no column at all - they are triggers, policies,
 * foreign keys and function bodies - so there is nothing here to probe them
 * with. `institutes.registered_by` looks like a probe for 0028 and is not: that
 * column is 0001's, and 0028 only changes what it MEANS. Listing it reported
 * 0028 as applied on a database that had never seen it, which is worse than not
 * checking at all, so it was taken out.
 *
 * A clean run therefore means the column-bearing migrations are in. It does not
 * mean the database is fully current. Each migration prints a notice from its
 * own assertion block when it is run, and that is what proves it landed.
 */
const UNPROBEABLE = "0023, 0027-0030 (no new columns - see the note in this file)";

const db = createClient(url, key, { auth: { persistSession: false } });

const present = async ({ table, column }) => {
  const { error } = await db.from(table).select(column).limit(1);
  // 42703 is "column does not exist"; 42P01 / PGRST205 mean the table is not
  // there either. Anything else is a connection or permissions problem and
  // must not be reported as a missing migration.
  if (!error) return true;
  if (error.code === "42703" || error.code === "42P01" || error.code === "PGRST205") {
    return false;
  }
  // The anon-key symptom, named rather than passed through. A missing GRANT is
  // not a missing migration, and "permission denied for table campuses" tells
  // nobody which of the two they are looking at.
  if (error.code === "42501" || error.code === "PGRST301") {
    throw new Error(
      `${table}.${column}: ${error.code} ${error.message}\n` +
        "    That is a permissions answer, not a schema one — this needs the\n" +
        "    SERVICE-ROLE key (Supabase dashboard -> Project Settings -> API).",
    );
  }
  throw new Error(`${table}.${column}: ${error.code} ${error.message}`);
};

console.log(`\nSchema check against ${url}\n`);

const missing = [];
for (const probe of PROBES) {
  let ok;
  try {
    ok = await present(probe);
  } catch (error) {
    console.error(`  ! could not check ${probe.table}.${probe.column} — ${error.message}`);
    process.exit(2);
  }
  console.log(
    `  ${ok ? "ok  " : "MISS"}  ${probe.id.padEnd(6)} ${probe.table}.${probe.column}`,
  );
  if (!ok && probe.needs) missing.push(probe);
}

console.log(`\n  --    not checkable this way: ${UNPROBEABLE}`);

if (missing.length === 0) {
  console.log(
    "\nEvery column-bearing migration this code needs is applied. Run each\n" +
      "migration file itself to see its assertion block confirm the rest.\n",
  );
  process.exit(0);
}

const files = [...new Set(missing.map((probe) => probe.id))];
console.log(
  [
    "",
    `This database is BEHIND the code on this branch. Missing: ${files.join(", ")}.`,
    "",
    "Until they are applied, the screens that depend on them fail — Settings",
    "cannot add or retire anything, and a rep's planner may have no purposes to",
    "choose from. Apply the files in supabase/migrations/ in NUMERIC ORDER,",
    "pasting each whole file into the Supabase SQL editor and reading the notice",
    "it prints. Mind the deploy-coupled ones: CLAUDE.md flags 0027 especially.",
    "",
  ].join("\n"),
);
process.exit(1);
