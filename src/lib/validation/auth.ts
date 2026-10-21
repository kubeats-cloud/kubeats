import { z } from "zod";
import { MIN_PASSWORD } from "@/lib/validation/admin";

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

/**
 * Shared by the "Forgot password?" form and the server action that calls
 * Supabase's `resetPasswordForEmail()`. Same email shape as `loginSchema` —
 * this is still a sign-in surface, just asking for the address instead of the
 * password.
 */
export const forgotPasswordSchema = z.object({
  email: z.email().max(254),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * The new-password form at the end of the reset-link flow.
 *
 * Reuses `MIN_PASSWORD` from admin.ts rather than inventing a second policy —
 * that constant is already the app's one answer to "how long must a password
 * be", applied when an admin sets a rep's temporary one. The confirm-match
 * check is the only rule this flow adds, since there is no existing form that
 * asks for a password twice.
 */
export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD, `At least ${MIN_PASSWORD} characters.`)
      .max(72, "That password is too long."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Where the login screen is allowed to send someone afterwards.
 *
 * `?next=` is attacker-controllable — the proxy puts the intended path there,
 * but anyone can type one — so it is treated as untrusted at both ends: the
 * login page sanitises before rendering it into a hidden field, and the
 * sign-in action sanitises again before redirecting. The second pass is the one
 * that matters, because the form can be posted without the page ever running.
 *
 * Only a single-slash internal path survives:
 *
 *   /pending              kept
 *   //evil.example        rejected — scheme-relative, the classic open redirect
 *   /\evil.example        rejected — some browsers normalise the backslash
 *   https://evil.example  rejected — not a path at all
 *   "/x\r\nSet-Cookie: y" rejected — control characters, header-splitting shapes
 *
 * Anything rejected becomes "/", which is always safe and always exists.
 */
const INTERNAL_PATH = /^\/(?!\/)/;

/** Nothing legitimate in this app is anywhere near this long. */
const MAX_NEXT_LENGTH = 512;

/**
 * A scan rather than a regex character class: a literal control-character range
 * trips eslint's no-control-regex, and spelling the comparison out is easier to
 * be certain about than an escaped range.
 */
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (value.length === 0 || value.length > MAX_NEXT_LENGTH) return "/";
  // A backslash is not a control character, so it needs saying separately:
  // browsers have historically treated "/\" and "//" alike.
  if (value.includes("\\")) return "/";
  if (hasControlCharacters(value)) return "/";
  if (!INTERNAL_PATH.test(value)) return "/";
  return value;
}
