import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/layout/bottom-nav";
import { TopBar } from "@/components/layout/top-bar";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { navItemsFor } from "@/lib/nav";

/**
 * Wording for the states where the profile row is missing or unreadable. Shown
 * on every screen rather than one, because it explains why names and roles look
 * wrong app-wide.
 */
const PROFILE_NOTICE: Record<string, string> = {
  "no-profile":
    "Your profile has not been set up yet, so some screens may be limited. Ask an admin to finish creating your account.",
  "schema-pending":
    "The database is not fully set up yet, so your name and role cannot be loaded.",
  unavailable:
    "We could not load your profile just now. Some screens may be limited.",
};

/**
 * The authorisation boundary for every signed-in screen, and the app shell.
 *
 * proxy.ts already turns anonymous traffic away, but that check is optimistic
 * and runs before rendering. This one re-verifies the token with Supabase, so
 * everything below can rely on there being a real user.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // isAdmin() insists the profile row actually loaded, so a failed lookup
  // degrades to rep navigation rather than exposing the admin tab.
  const items = navItemsFor(isAdmin(user));
  const notice = PROFILE_NOTICE[user.profileStatus];

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        name={user.name}
        role={user.role}
        showRole={user.profileStatus === "ready"}
      />

      {notice && (
        <div className="bg-warning-subtle text-warning-subtle-foreground">
          <p className="mx-auto w-full max-w-2xl px-5 py-2 text-xs">{notice}</p>
        </div>
      )}

      {/* pb-28 keeps the last element clear of the fixed bottom bar. */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pt-6 pb-28">
        {children}
      </main>

      <BottomNav items={items} />
    </div>
  );
}
