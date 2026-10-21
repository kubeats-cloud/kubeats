import Image from "next/image";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Reset your password" };

/**
 * IQ6: where the emailed reset link lands.
 *
 * Outside the (app) group, like /login and /verify — no bottom bar, no nav.
 * Reachable without a session (`PUBLIC_PATHS` in nav.ts) and deliberately NOT
 * an auth path: the link itself hands the browser a recovery session the
 * instant it lands, and an auth path would bounce that straight to "/" before
 * the new-password form ever rendered. See the comment on `PUBLIC_PATHS`.
 *
 * This page renders unconditionally — it is `ResetPasswordForm` that does the
 * actual work, because establishing the session from the link has to run in
 * the BROWSER (reading the URL) and finish in a SERVER ACTION (writing the
 * session cookie), which a plain server component can do neither half of.
 */
export default function ResetPasswordPage() {
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
            <CardTitle className="text-xl">Reset your password</CardTitle>
            <CardDescription>Choose a new password for your account.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResetPasswordForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
