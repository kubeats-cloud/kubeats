import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import { COOKIE_OPTIONS } from "@/lib/supabase/cookies";

/**
 * Supabase client for server components, server actions and route handlers.
 *
 * Uses the anon key and the caller's session cookies, so Row Level Security
 * still applies — this is the client to reach for by default. Create a new one
 * per request; never hoist it into a module-level singleton, or one user's
 * session would leak into another's request.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = publicEnv();

  return createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: COOKIE_OPTIONS,
    /*
     * IQ6 (password reset) needs this, and nothing else in the app does.
     * auth-js's PKCE storage is keyed per flow
     * (`sb-<ref>-auth-token-flow-<flowId>-code-verifier`) with no reachable
     * fallback for a SERVER-SIDE exchange — the "most recent verifier" fallback
     * auth-js documents only resolves `window.location` itself, which does not
     * exist here. `exchangeCodeForSession()` must be given the matching flowId
     * explicitly, and this flag is what makes `resetPasswordForEmail()` put one
     * on the redirect URL in the first place, as GoTrue's reserved `sb_flow_id`
     * parameter — `requestPasswordReset()` / `exchangeRecoveryCode()` in
     * auth-actions.ts are the two ends of this. Harmless for every other auth
     * call this app makes: there is no OAuth sign-in and no email-confirmation
     * signup here, which are the only other paths that read this flag.
     */
    auth: { experimental: { appendPkceFlowIdToRedirects: true } },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components are not allowed to write cookies. Refreshed
          // tokens are persisted by proxy.ts instead (Next.js 16 renamed
          // middleware to proxy), so ignoring this is safe.
        }
      },
    },
  });
}
