import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hasVerifiedFactor } from "@/lib/validation/mfa";

/** One admin, and whether they have a second factor set up. */
export interface AdminFactorState {
  id: string;
  name: string;
  enrolled: boolean;
}

/**
 * Whether the signed-in admin has finished enrolling.
 *
 * Their own session answers this, so no service-role key is involved. Unverified
 * factors do not count, for the reason `hasVerifiedFactor()` gives.
 */
export async function viewerHasFactor(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return false;
  return hasVerifiedFactor(data?.all ?? []);
}

/**
 * Every admin, and whether each has a factor — the recovery panel's list.
 *
 * SERVICE ROLE, because one admin's session cannot see another's factors. The
 * caller must already have checked that the viewer is an admin; the Settings
 * page redirects a rep before this runs, and `clearMemberFactors()` checks
 * again for itself rather than trusting that.
 *
 * Only admins are listed. A rep has no factor to reset because enrolment lives
 * behind admin-only routing, and offering a row that can only ever say "nothing
 * set up" would be offering a control with no purpose.
 */
export async function listAdminFactorStates(
  admins: { id: string; name: string }[],
): Promise<AdminFactorState[]> {
  const db = createAdminClient();

  return Promise.all(
    admins.map(async (admin) => {
      const { data, error } = await db.auth.admin.mfa.listFactors({
        userId: admin.id,
      });
      // A failed read is reported as "not enrolled" rather than throwing: the
      // panel is a convenience, and one unreadable row must not take out the
      // whole Settings screen. The reset action re-reads before it acts.
      if (error) {
        console.error("[mfa] admin factor read failed", { code: error.code });
        return { id: admin.id, name: admin.name, enrolled: false };
      }
      return {
        id: admin.id,
        name: admin.name,
        enrolled: hasVerifiedFactor(data?.factors ?? []),
      };
    }),
  );
}
