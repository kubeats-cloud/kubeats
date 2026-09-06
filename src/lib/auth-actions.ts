"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, safeNextPath } from "@/lib/validation/auth";

export interface LoginState {
  error: string | null;
}

export async function signIn(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  // Same wording as a rejected credential: a validation message here would
  // still be a signal about which field the server disliked.
  if (!parsed.success) {
    return { error: "Enter a valid email address and your password." };
  }

  // Re-checked here, not trusted from the field the page rendered: this action
  // is reachable without that page ever running.
  const next = safeNextPath(formData.get("next"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // The real reason is logged for us, never returned to the browser —
    // "no such user" and "wrong password" must be indistinguishable, or the
    // form becomes an account-enumeration oracle.
    console.error("[auth] sign-in rejected", {
      code: error.code,
      status: error.status,
    });

    if (error.status === 429) {
      return { error: "Too many attempts. Please wait a moment and try again." };
    }
    return { error: "Invalid email or password." };
  }

  revalidatePath("/", "layout");
  // Throws NEXT_REDIRECT — must stay outside the try/catch above.
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("[auth] sign-out failed", { code: error.code });
  }

  revalidatePath("/", "layout");
  redirect("/login");
}
