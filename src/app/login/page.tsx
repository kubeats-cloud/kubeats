import Image from "next/image";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

/**
 * Only same-origin, single-slash paths survive, matching the check the sign-in
 * action repeats server-side.
 */
function safeNext(value: string | string[] | undefined): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

export default async function LoginPage(props: PageProps<"/login">) {
  // proxy.ts already bounces signed-in users, but that gate is optimistic;
  // this is the real check.
  const user = await getCurrentUser();
  if (user) redirect("/");

  const searchParams = await props.searchParams;
  const next = safeNext(searchParams.next);

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        {/* The supplied lockup, used whole — this is the one screen with room
            to give it. The white ground has been keyed out, or it would show as
            a white rectangle against the app's warm off-white. The artwork
            carries the tagline itself, so it is not repeated underneath; the
            alt text says it for anyone who cannot see the mark. */}
        <div className="mb-7 flex flex-col items-center text-center">
          <Image
            src="/brand/kubeats-logo-transparent.png"
            alt="KUbeats — For a smarter KU"
            width={1004}
            height={747}
            priority
            className="h-auto w-56 max-w-full"
          />
          <span aria-hidden className="brand-rule mt-5 h-1 w-24 rounded-full" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>
              Use the email and password your admin set up for you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm next={next} />
          </CardContent>
        </Card>

        <p className="text-muted-foreground mt-6 text-center text-xs">
          Accounts are created by an administrator. If you cannot get in, ask
          them to check your access.
        </p>
      </div>
    </main>
  );
}
