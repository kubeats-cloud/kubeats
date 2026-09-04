"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import { COOKIE_OPTIONS } from "@/lib/supabase/cookies";

/**
 * Supabase client for browser code. Carries the anon key only, so every query
 * it makes is subject to Row Level Security.
 */
export function createClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = publicEnv();
  return createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: COOKIE_OPTIONS,
  });
}
