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
export default defineCloudflareConfig();
