import Image from "next/image";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Forgot your password?" };

/**
 * IQ6: the request step of the password-reset flow.
 *
 * Outside the (app) group, like /login and /verify — no bottom bar, no nav,
 * and no app layout running its own role checks around someone who may not be
 * signed in at all. Reachable without a session (`PUBLIC_PATHS` in nav.ts) and
 * NOT an auth path, so a signed-in user who lands here simply sees the form
 * rather than being bounced — there is no reason to refuse that.
 */
export default function ForgotPasswordPage() {
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
            <CardTitle className="text-xl">Forgot your password?</CardTitle>
            <CardDescription>
              Enter your registered email and we&apos;ll send you a link to reset it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ForgotPasswordForm />
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs">
          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
