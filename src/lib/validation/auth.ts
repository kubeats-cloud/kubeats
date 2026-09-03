import { z } from "zod";

/**
 * Shared by the login form and the sign-in server action, so the client and the
 * server enforce the same rules.
 *
 * Deliberately loose on the password: this is a sign-in, not a sign-up, and
 * complexity rules here would only tell an attacker what our policy is. 72 is
 * the byte ceiling bcrypt (and therefore Supabase Auth) actually honours.
 */
export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(72),
});

export type LoginInput = z.infer<typeof loginSchema>;
