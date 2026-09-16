import { z } from "zod";

/**
 * The 6-digit code, validated identically on both sides of the wire.
 *
 * Trimmed and stripped of spaces before the length check because authenticator
 * apps display "123 456" and people copy what they see. Rejecting that would be
 * rejecting the correct code for being punctuated.
 */
export const codeSchema = z
  .string({ error: "Enter the 6-digit code from your authenticator app." })
  .transform((value) => value.replace(/\s/g, ""))
  .pipe(
    z
      .string()
      .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
  );
