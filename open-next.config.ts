import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * The Cloudflare adapter's configuration — the only file in this repo that
 * knows what platform it is deployed to.
 *
 * Deliberately minimal. The template ships an R2 incremental cache, and this
 * app has nothing to put in it: every route reads the session, so `next build`
 * marks all of them dynamic (ƒ) and nothing is prerendered or revalidated.
 * Adding the cache would mean creating an R2 bucket, a self-referencing service
 * binding and a deploy-time dependency, all to cache zero pages.
 *
 * If a page ever becomes static or uses ISR, add the R2 cache back — see
 * https://opennext.js.org/cloudflare/caching — and give it a bucket in
 * wrangler.jsonc.
 */
const config = {
  ...defineCloudflareConfig(),

  /**
   * `npm run build` IS the adapter build, so that Cloudflare's default build
   * command produces a Worker without anyone configuring anything. The adapter
   * in turn builds Next by running a script from this package.json — and if
   * that were `build`, it would invoke itself forever. So point it at the plain
   * Next build.
   *
   * It has to stay the adapter's child process rather than a step we chain
   * ourselves: the adapter sets NEXT_PRIVATE_STANDALONE before running this,
   * which is what produces the `.next/standalone` output it then bundles.
   * Running `next build` first and passing `--skipNextBuild` skips that, and
   * the bundle step fails looking for files standalone mode would have written.
   */
  buildCommand: "npm run build:next",
};

export default config;
