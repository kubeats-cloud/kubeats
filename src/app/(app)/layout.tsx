import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

/**
 * The authorisation boundary for every signed-in screen.
 *
 * proxy.ts already turns anonymous traffic away, but that check is optimistic
 * and runs before rendering. This one re-verifies the token with Supabase on
 * the server, so a page underneath can rely on there being a real user.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <>{children}</>;
}
