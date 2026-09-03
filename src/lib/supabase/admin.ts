import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Service-role Supabase client. **Bypasses Row Level Security entirely.**
 *
 * Only for operations that genuinely cannot run as the signed-in user — chiefly
 * an admin creating a rep's auth account. Every caller must check the caller's
 * own role first; this client will not do it for you.
 *
 * The `server-only` import above makes importing this file from client code a
 * build error, so the service-role key can never be bundled for the browser.
 */
export function createAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = publicEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  return createSupabaseClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
