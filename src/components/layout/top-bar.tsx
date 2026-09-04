import Image from "next/image";
import { LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DesktopNav } from "@/components/layout/desktop-nav";
import { signOut } from "@/lib/auth-actions";
import type { NavItem } from "@/lib/nav";

/**
 * The app bar.
 *
 * It used to be the flame gradient end to end, which looked like the brand and
 * hid it: the logo is itself a red-to-gold flame, so sitting it on a red-to-gold
 * bar left a mark you could only find if you knew it was there. The bar is now
 * a white surface with a hairline border — the logo carries its own colour
 * against it, and the wordmark is near-black and legible at a glance.
 *
 * The flame did not leave the app, it left the chrome: it is on primary
 * actions, the active tab, and section accents, where it means "this is the
 * thing to press" rather than "this is a header". Restraint in the frame is
 * what makes the accents read as deliberate.
 *
 * Sign-out lives here because reps have no Settings tab, so it has to be
 * reachable from every screen for everyone.
 */
export function TopBar({
  name,
  role,
  showRole,
  items,
}: {
  name: string;
  role: "rep" | "admin";
  /** Only true when a profile row actually loaded, so we never label a guess. */
  showRole: boolean;
  items: NavItem[];
}) {
  return (
    <header className="border-border bg-card sticky top-0 z-30 border-b">
      <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4 md:h-16 md:max-w-6xl md:gap-6 md:px-6">
        {/* Brand ---------------------------------------------------------- */}
        <div className="flex min-w-0 items-center gap-2.5">
          <Image
            src="/brand/kubeats-mark.png"
            alt=""
            width={36}
            height={36}
            priority
            className="size-8 shrink-0 md:size-9"
          />
          <div className="min-w-0 leading-none">
            <p className="text-[15px] font-semibold tracking-tight md:text-base">
              KUbeats
            </p>
            <p className="text-muted-foreground mt-0.5 truncate text-[11px] md:hidden">
              {name}
            </p>
          </div>
        </div>

        <div className="flex-1" />

        <DesktopNav items={items} />

        {/* Identity and exit ---------------------------------------------- */}
        <div className="flex shrink-0 items-center gap-2 md:gap-3">
          <span className="border-border hidden h-6 border-l md:block" />

          <div className="hidden text-right md:block">
            <p className="text-[13px] leading-tight font-medium">{name}</p>
            {showRole && (
              <p className="text-muted-foreground text-[11px] leading-tight capitalize">
                {role}
              </p>
            )}
          </div>

          {showRole && role === "admin" && (
            <span className="bg-secondary text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase md:hidden">
              Admin
            </span>
          )}

          <form action={signOut}>
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground size-9"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOutIcon className="size-[18px]" aria-hidden />
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
