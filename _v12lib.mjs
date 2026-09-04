import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import process from "node:process";
process.loadEnvFile(".env.local");
export const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SITE = "https://kubeats.pavanstudy2012.workers.dev";
export const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
export async function cookieFor(email) {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const jar = [];
  const c = createServerClient(URL_, ANON, {
    cookies: { getAll: () => [], setAll: (cs) => jar.push(...cs) },
  });
  const { error } = await c.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (error) throw error;
  return jar.map((x) => `${x.name}=${x.value}`).join("; ");
}
