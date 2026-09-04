import Image from "next/image";
import { LogOutIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-actions";

/**
 * The app bar, and the brand's home on every screen.
 *
 * The flame gradient runs across it with the lotus mark and the wordmark in
 * white — the one place the identity is stated in full on every page. The mark
 * is the transparent crop of the logo, so it sits on the gradient rather than
 * bringing its own white box with it.
 *
 * Sign-out lives here rather than on a Settings screen because reps have no
 * Settings tab — it has to be reachable from every screen for everyone.
 */
export function TopBar({
  name,
  role,
  showRole,
}: {
  name: string;
  role: "rep" | "admin";
  /** Only true when a profile row actually loaded, so we never label a guess. */
  showRole: boolean;
}) {
  return (
    <header className="brand-gradient sticky top-0 z-30 shadow-sm">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Image
            src="/brand/kubeats-mark.png"
            alt=""
            width={36}
            height={36}
            priority
            className="size-9 shrink-0 drop-shadow-sm"
          />
          <div className="min-w-0">
            <p className="text-[15px] leading-tight font-semibold tracking-tight text-white">
              KUbeats
            </p>
            <div className="flex items-center gap-1.5">
              <p className="truncate text-xs leading-tight text-white/85">{name}</p>
              {showRole && role === "admin" && (
                <Badge
                  variant="neutral"
                  className="border-white/30 bg-white/20 px-1.5 py-0 text-[10px] text-white"
                >
                  admin
                </Badge>
              )}
            </div>
          </div>
        </div>

        <form action={signOut}>
          <Button
            type="submit"
            variant="ghost"
            className="size-11 bg-black/15 text-white hover:bg-black/25 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOutIcon className="size-5" aria-hidden />
          </Button>
        </form>
      </div>
    </header>
  );
}
