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
        <div className="mb-6 text-center">
          <p className="text-primary text-xs font-semibold tracking-widest uppercase">
            Field Ops
          </p>
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
