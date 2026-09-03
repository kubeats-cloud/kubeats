import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";

/**
 * Admin-only subtree.
 *
 * Hiding the Settings tab from reps is presentation, not protection — anyone
 * can type a URL. This is the check that actually holds, and it lives in a
 * layout so every future settings sub-route inherits it instead of each page
 * having to remember.
 *
 * notFound() rather than a "forbidden" message, so the route does not confirm
 * to a rep that an admin area exists at this address. isAdmin() also requires
 * the profile row to have loaded, so a failed lookup denies rather than admits.
 */
export default async function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) notFound();

  return <>{children}</>;
}
