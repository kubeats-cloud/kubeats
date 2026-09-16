import Image from "next/image";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { challengeRequiredFor } from "@/lib/mfa";
import { safeNextPath } from "@/lib/validation/auth";
import { VerifyForm } from "./verify-form";

export const metadata = { title: "Enter your code" };

/**
 * The second factor, asked for once per sign-in.
 *
 * AT /verify AND NOT /login/verify. `matches()` in nav.ts is prefix-based, so
 * anything under /login counts as an auth path and the proxy bounces signed-in
 * users off it — and the person standing here has just given their password, so
 * they are signed in. That would have looped: gate sends them here, auth rule
 * sends them away. `MFA_VERIFY_PATH` and the mfa tests pin the shape.
 *
 * Outside the (app) group deliberately, like /login: no bottom bar, no nav, and
 * no app layout doing its own role checks around somebody who is only half
 * signed in.
 */
export default async function VerifyPage(props: PageProps<"/verify">) {
  /*
   * `auth.getUser()` rather than `getCurrentUser()`, and the difference matters
   * here: the gate needs `user.factors`, which the app's own CurrentUser shape
   * does not carry. It is the same verified call underneath — the token is
   * checked with the auth server, never read out of a cookie — so this is a
   * wider view of the same fact, not a weaker one.
   */
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The proxy already decided this, and that gate is optimistic — the same
  // reasoning /login gives for re-checking. Somebody who owes no code has no
  // business on a page that can only ask for one.
  if (!(await challengeRequiredFor(supabase, user))) redirect("/");

  const searchParams = await props.searchParams;
  const next = safeNextPath(searchParams.next);

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <Image
            src="/brand/kubeats-logo-transparent.png"
            alt="KUbeats — For a smarter KU"
            width={600}
            height={446}
            priority
            className="h-auto w-56 max-w-full"
          />
          <span aria-hidden className="brand-rule mt-5 h-1 w-24 rounded-full" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Enter your code</CardTitle>
            <CardDescription>
              Open your authenticator app and type the 6-digit code for KUbeats.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VerifyForm next={next} />
          </CardContent>
        </Card>

        {/*
          THE ESCAPE HATCH, and it has to be on this page.
          Somebody whose phone is lost is otherwise stuck on a screen asking for
          a code they cannot produce, with no way even to sign out and hand the
          machine back. Sign-out is a server action posted to whatever page is
          open, so it works from here unchanged.
        */}
        <p className="text-muted-foreground mt-6 text-center text-xs">
          Lost your phone? Ask the other admin to reset your sign-in code from
          Settings, then sign in with your password alone.
        </p>
      </div>
    </main>
  );
}
