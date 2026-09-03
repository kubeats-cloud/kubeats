import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signOut } from "@/lib/auth-actions";
import { getCurrentUser } from "@/lib/auth";

/** Wording for the states where the profiles table or row is not there yet. */
const PROFILE_NOTICE: Record<string, string> = {
  "no-profile":
    "Your profile has not been set up yet. An admin needs to finish creating your account.",
  "schema-pending":
    "The database schema has not been applied yet, so your name and role cannot be loaded.",
  unavailable:
    "Your profile could not be loaded just now. You can still sign out and try again.",
};

export default async function Home() {
  // The (app) layout guarantees a user, so this is never null here.
  const user = await getCurrentUser();
  if (!user) return null;

  const notice = PROFILE_NOTICE[user.profileStatus];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10">
      <p className="text-primary text-xs font-semibold tracking-widest uppercase">
        Field Ops
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Signed in as {user.name}
      </h1>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Your account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate">{user.email}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Role</dt>
              <dd>
                {user.profileStatus === "ready" ? (
                  <Badge variant={user.role === "admin" ? "default" : "neutral"}>
                    {user.role}
                  </Badge>
                ) : (
                  <Badge variant="warning">not set yet</Badge>
                )}
              </dd>
            </div>
          </dl>

          {notice && (
            <p className="bg-warning-subtle text-warning-subtle-foreground rounded-md px-3 py-2 text-sm">
              {notice}
            </p>
          )}

          <form action={signOut}>
            <Button type="submit" variant="outline" className="h-11 w-full">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-6 text-sm">
        Authentication is wired up. The rep and admin screens come next.
      </p>
    </main>
  );
}
