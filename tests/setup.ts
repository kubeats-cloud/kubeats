/**
 * Loads .env.local if it is there, so the integration tests can find the
 * Supabase credentials a developer already has locally. Absent — in CI, say —
 * is not an error: those tests skip themselves.
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local. Unit tests do not need one.
}
