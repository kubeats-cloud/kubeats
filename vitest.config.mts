import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Two kinds of test live here.
 *
 * `tests/unit` is pure logic — week arithmetic, the metric rules, the schemas.
 * It needs nothing but Node, so it runs everywhere, CI included.
 *
 * `tests/integration` exercises the rules that live in Postgres: the meeting
 * gate, the weekly lock, RLS isolation. Those need a real Supabase project, so
 * they skip themselves when the service-role key is absent rather than failing
 * a pipeline that was never given credentials. See tests/README.md.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // The integration tests talk to a hosted database over the network.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
