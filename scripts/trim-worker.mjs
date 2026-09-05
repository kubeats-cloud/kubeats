/**
 * Drops @vercel/og's WebAssembly from the Worker bundle.
 *
 * Why this exists
 * ---------------
 * The OpenNext Cloudflare adapter rewrites Turbopack's runtime `externalImport`
 * into a static `switch`, and it *unconditionally* adds a case for
 * `@vercel/og` — see `addCase("next/dist/compiled/@vercel/og/index.node.js", …)`
 * in `@opennextjs/cloudflare/dist/cli/build/patches/plugins/turbopack.js`. For
 * the server bundle that costs nothing, because `bundle-server.js` aliases the
 * library to a throwing shim when the app does not use it, with the comment
 * "does not drag the library (~800 KiB) and its resvg.wasm (~1.4 MiB) into the
 * Worker bundle".
 *
 * The Node.js middleware bundler (`bundle-node-middleware.js`) has no such
 * alias, so the same case pulls the real library — and its two .wasm files — in
 * through `.open-next/middleware/handler.mjs`. That is 1.38 MiB raw, 0.53 MiB
 * compressed, of an image renderer this app never invokes: the only reference
 * to `ImageResponse` anywhere is the stub `next/server` keeps to tell you it
 * moved to `next/og`. The icons are static PNGs in `src/app/`.
 *
 * A Worker must be under 3 MiB compressed on the free plan, so this is the
 * difference between deploying and not.
 *
 * What it does
 * ------------
 * The .wasm files are left as import specifiers for Wrangler to resolve
 * (`setWranglerExternal()`), which makes them the one part of this that is
 * cheap and safe to cut: replace the two import statements with `null` and
 * Wrangler stops emitting the modules. The surrounding JavaScript is dead code
 * either way — nothing reaches it — and esbuild has already inlined it, so
 * removing that too would mean parsing the bundle rather than two lines of it.
 *
 * If the app ever does use @vercel/og this stops and changes nothing.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIDDLEWARE = ".open-next/middleware/handler.mjs";
const SERVER = ".open-next/server-functions/default/handler.mjs";

// Matches e.g. `import resvg_wasm from "/abs/path/@vercel/og/resvg.wasm?module";`
const WASM_IMPORT = /^import (\w+) from "[^"]*@vercel.og.(yoga|resvg)\.wasm\?module";$/gm;

function fail(message) {
  console.error(`trim-worker: ${message}`);
  process.exit(1);
}

if (!existsSync(MIDDLEWARE)) {
  fail(`${MIDDLEWARE} not found — run the adapter build first.`);
}

// The adapter's own test for "this app uses @vercel/og": if it does, the server
// function bundles the library for real and cutting the wasm would break it.
if (existsSync(SERVER) && readFileSync(SERVER, "utf8").includes("resvg.wasm")) {
  console.log("trim-worker: the app uses @vercel/og — leaving the bundle alone.");
  process.exit(0);
}

const before = statSync(MIDDLEWARE).size;
const found = [];
const trimmed = readFileSync(MIDDLEWARE, "utf8").replace(WASM_IMPORT, (_match, binding, which) => {
  found.push(which);
  return `var ${binding} = null; // @vercel/og ${which}.wasm removed by scripts/trim-worker.mjs`;
});

// Loud rather than silent: if the adapter changes how it emits these, the
// bundle would quietly go back over the size limit and fail at deploy time
// with a message that points nowhere near here.
if (found.length !== 2 || !found.includes("yoga") || !found.includes("resvg")) {
  fail(
    `expected one yoga.wasm and one resvg.wasm import in ${MIDDLEWARE}, found ` +
      `${found.length} (${found.join(", ") || "none"}).\n` +
      "  The adapter has probably changed how it bundles @vercel/og. Check\n" +
      "  whether the wasm is still being pulled in before removing this step:\n" +
      "    npx wrangler deploy --dry-run --outdir out && ls out",
  );
}

writeFileSync(MIDDLEWARE, trimmed);
const after = statSync(MIDDLEWARE).size;
console.log(
  `trim-worker: removed @vercel/og wasm imports from the middleware bundle ` +
    `(${(before - after) / 1024} KiB of source, ~1.4 MiB of wasm Wrangler will no longer upload).`,
);

guardServiceRoleKey();

/**
 * Refuses to finish a build that would ship the service-role key.
 *
 * The adapter writes the whole environment into
 * `.open-next/cloudflare/next-env.mjs` as plaintext string literals, and esbuild
 * copies that into `worker.js.map`. Neither is uploaded today — Wrangler only
 * sends `worker.js` and `.open-next/assets`, and `upload_source_maps` defaults
 * to false — so the key stays on the build machine. That is a property of the
 * configuration, though, not of the code, and it is one line away from being
 * untrue. This makes it a property the build enforces.
 *
 * Two checks, because there are two ways it goes wrong:
 *
 *   1. `upload_source_maps: true` in wrangler.jsonc. Tempting, because
 *      `observability` is already on and readable stack traces are worth
 *      having — but the map holds the key, so enabling it hands the key to
 *      Cloudflare. There is no safe way to turn this on while the adapter
 *      inlines the environment. Leave it off.
 *
 *   2. The key's value appearing in something uploaded verbatim: the Worker
 *      entry, the bundles it pulls in, or anything under assets/, which is
 *      served publicly. A leak into assets/ is the catastrophic one — that is
 *      the browser-readable half.
 *
 * What this does NOT cover, stated plainly rather than implied: Wrangler does
 * the final bundling at deploy time, so a key that arrived only by an import
 * this scan cannot follow would not be caught here. The two checks above are
 * the realistic paths, and the second covers the one that would be public.
 *
 * Skips the value scan when the key is not in the environment — CI builds
 * deliberately run without it — but still checks the config, which needs no
 * secret to read.
 */
function guardServiceRoleKey() {
  const WRANGLER = "wrangler.jsonc";

  if (existsSync(WRANGLER)) {
    // Strip // comments first: the warning below this very check mentions the
    // setting by name, and matching that would be a false alarm on every build.
    const config = readFileSync(WRANGLER, "utf8").replace(/^\s*\/\/.*$/gm, "");
    if (/"upload_source_maps"\s*:\s*true/.test(config)) {
      fail(
        `${WRANGLER} sets "upload_source_maps": true.\n` +
          "  worker.js.map contains SUPABASE_SERVICE_ROLE_KEY in plaintext, because the\n" +
          "  OpenNext adapter inlines the environment into .open-next/cloudflare/next-env.mjs.\n" +
          "  Turning this on uploads the key to Cloudflare. Remove the setting.",
      );
    }
  }

  // This runs as its own process, so the .env.local that `next build` read is
  // not in our environment. Same idiom as scripts/backup.mjs. Without it the
  // scan below would skip on every local build and only ever look like it ran.
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Already exported, or genuinely absent — handled just below.
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    console.log(
      "trim-worker: SUPABASE_SERVICE_ROLE_KEY is not set, so the leak scan was skipped " +
        "(expected in CI). The upload_source_maps check still ran.",
    );
    return;
  }

  const SCANNABLE = /\.(js|mjs|cjs|json|html|css|txt|map)$/;
  // The two places the adapter is known to put the key, neither of which is
  // uploaded. Excluded so the guard reports real regressions rather than the
  // situation it was written to describe.
  const KNOWN_CONTAINED = new Set([
    join(".open-next", "cloudflare", "next-env.mjs"),
    join(".open-next", "worker.js.map"),
  ]);

  const offenders = [];
  for (const entry of readdirSync(".open-next", { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !SCANNABLE.test(entry.name)) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    if (KNOWN_CONTAINED.has(path)) continue;
    if (readFileSync(path, "utf8").includes(key)) offenders.push(path);
  }

  if (offenders.length > 0) {
    fail(
      "the service-role key is present in files this build would upload:\n" +
        offenders.map((p) => `    ${p}`).join("\n") +
        "\n  That key bypasses Row Level Security entirely. Do not deploy this build.\n" +
        "  Find what put it there, and rotate the key — it has to be assumed burned.",
    );
  }

  console.log(
    "trim-worker: checked the Worker bundle and assets for the service-role key — none present.",
  );
}
