import { LogOutIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-actions";

/**
 * Slim top bar: who you are, and the way out.
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
    <header className="border-border bg-card sticky top-0 z-30 border-b">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-5 py-3">
        <div className="min-w-0">
          <p className="text-primary text-[11px] font-semibold tracking-widest uppercase">
            Field Ops
          </p>
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{name}</p>
            {showRole && role === "admin" && (
              <Badge variant="neutral">admin</Badge>
            )}
          </div>
        </div>

        <form action={signOut}>
          <Button
            type="submit"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground size-11"
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
