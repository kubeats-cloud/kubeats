import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";

/**
 * Also what a rep sees if they type an admin-only URL. The wording covers both
 * "this does not exist" and "this is not yours" without saying which, so the
 * page cannot be used to discover admin routes.
 */
export default function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="We could not find that page"
        description="It may have moved, or it may not be available to your account."
        action={
          <Button asChild className="h-11">
            <Link href="/">Back to dashboard</Link>
          </Button>
        }
      />
    </>
  );
}
