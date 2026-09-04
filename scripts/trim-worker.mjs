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
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

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
