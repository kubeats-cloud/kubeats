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
