# Admin-only TOTP MFA — plan

**Not built yet.** This is the design for review.

TOTP (authenticator app) second factor, **admins only**, with a recovery path
that cannot permanently lock everyone out. Reps are untouched.

---

## Checked against the installed SDK, not from memory

`@supabase/supabase-js ^2.115.0`. Verified in `node_modules/@supabase/auth-js`:

| Fact | Result |
| --- | --- |
| `auth.mfa.enroll / challenge / verify / challengeAndVerify / listFactors / unenroll` | present |
| `auth.mfa.getAuthenticatorAssuranceLevel()` | present, reads the local session — **no network call** |
| `auth.admin.mfa.listFactors({ userId })` / `deleteFactor({ id, userId })` | present |
| Factor types offered | `totp` and `phone` only |
| **Native recovery / backup codes** | **none** — no such type anywhere in the SDK |

That last row is the one that shapes section 3. Supabase does not give us backup
codes; recovery is ours to design.

---

## 1. Enrolment — recommend **opt-in, then enforce once enrolled**

Your instinct is right and I'd go further: this is the only model with no
lockout window at all.

**The rule is one sentence: a session needs AAL2 if and only if that user has a
verified factor.** Not "if the user is an admin". Keyed on the factor, the
feature is inert on every account until its owner personally enrols — so there
is no moment where the app demands something an admin has not yet got.

Where: **Settings → a "Sign-in security" card**, visible to admins only.
Settings is already in `ADMIN_ONLY_PATHS`, so "admin-only" falls out of existing
routing rather than becoming a new rule to maintain.

Flow: `mfa.enroll({ factorType: 'totp' })` → show the returned QR (the SDK hands
back an SVG and the secret) → admin scans → they type the first 6-digit code →
`mfa.challengeAndVerify()`. The factor is `unverified` until that succeeds, and
an unverified factor does **not** raise `nextLevel`, so a half-finished
enrolment cannot lock anybody out either. Cancelling must `unenroll()` the
unverified factor — leftovers collide with the friendly-name uniqueness on the
next attempt.

Making it *mandatory* for all admins is a reasonable Phase 2 once both are
enrolled and have each rehearsed recovery. It should not be in v1.

## 2. The login challenge

`signInWithPassword()` already returns a **real session at AAL1**. Everything
below exists because of that.

1. `signIn()` succeeds → ask `getAuthenticatorAssuranceLevel()`.
2. `currentLevel === 'aal1' && nextLevel === 'aal2'` → redirect to the code
   screen, carrying `next` through. Otherwise redirect to `next` exactly as
   today.
3. Code screen posts to `mfa.challengeAndVerify({ factorId, code })`. On success
   the session becomes AAL2; redirect to `next`.

**The proxy must gate the half-authenticated state, or MFA is decorative.** An
AAL1 session is a valid session: without a gate, an admin who closes the code
screen can simply navigate to `/` and carry on. So `proxy.ts` gains one check —
a user at AAL1 whose `nextLevel` is `aal2` may reach only the code screen and
sign-out; everything else redirects to the code screen. This costs nothing
extra: the factors are already in the session the proxy refreshes, so the AAL
question is answered locally with no round trip.

**Reps are unchanged, provably.** No factor → `nextLevel` stays `aal1` → step 2
falls through to today's redirect and the proxy check never fires. Not "we won't
show them the prompt" — the condition is false for them.

⚠️ **Route-naming trap.** Do **not** put this at `/login/verify`.
`AUTH_PATHS = ["/login"]` and `matches()` in `nav.ts` is prefix-based
(`pathname.startsWith(path + "/")`), so `/login/verify` is an auth path, and the
proxy bounces signed-in users off those — the admin would be redirected to `/`,
then back to the code screen, forever. Put it at top-level **`/verify`**. It is
not public (a signed-out visitor there should still go to `/login`) and not an
auth path. Same shape of bug as the `robots.txt` matcher note in CLAUDE.md.

## 3. Recovery — the part that matters

There are no native backup codes, so the answer is **admin-to-admin reset**,
with the Supabase project as break-glass.

| Scenario | Recovery |
| --- | --- |
| One admin loses their phone | **The other admin clears their factor** from the Team panel. Victim then signs in with password alone (no verified factor → AAL1 is enough) and re-enrols. |
| Both lose their phones | **Break-glass:** Supabase Dashboard → Authentication → Users → delete the factors; or a service-role script calling `auth.admin.mfa.deleteFactor`. Needs Supabase project access, which is a different credential from the app. |
| Admin still has the phone, wants a new one | Enrol the new device, then unenroll the old factor. |

Admin-to-admin reset is `auth.admin.mfa.listFactors({ userId })` then
`deleteFactor({ id, userId })` through the existing `createAdminClient()` — the
same service-role plumbing `createMember()` already uses, gated behind
`requireAdmin()` the same way, and logged.

**Why this is safe with exactly two admins:** the failure needs *both* to lose
their devices simultaneously, and even then the Supabase project owner resolves
it. **No scenario permanently locks out all admins.**

Two supporting recommendations, neither of them code:

- **Each admin enrols two authenticators** (phone + a desktop app such as 1Password
  or Authy). Supabase permits multiple TOTP factors. This makes the single most
  likely incident — one lost phone — a non-event.
- **Rehearse break-glass before the first enrolment**, and record it in
  `docs/BACKUP-RESTORE.md`. That document already exists to list what migrations
  cannot carry, and MFA factors are precisely such a thing.

**Recommend against building our own recovery codes in v1.** Not just cost: a
recovery code cannot raise a Supabase session to AAL2, so it could not satisfy
the proxy gate. It would have to work by *deleting the factor* instead — a
parallel credential system, hashed at rest, with its own lockout and audit
story. Worth it at ten admins; not at two, with a second admin and the dashboard
already standing behind it.

## 4. Enforcement model — what happens to Amit and Pavan

Their next login after this deploys:

1. `signInWithPassword()` — succeeds, as today.
2. `getAuthenticatorAssuranceLevel()` → `currentLevel: 'aal1'`, `nextLevel: 'aal1'`
   (they have no factors).
3. Condition in §2 step 2 is false → straight to `next`.
4. Proxy AAL check — false for the same reason, never fires.

**Identical to today, byte for byte.** They are prompted for a code on the first
login *after they choose to enrol*, and not before. The rollout cannot lock them
out because the feature does not know they exist until they enrol.

## 5. Deploy safety

**No migration. Nothing is deploy-coupled.** Because enforcement is keyed on
factor presence rather than on role, the deploy is inert on every existing
account — the opposite of 0027's apply-first hazard.

Rollout:

1. Deploy. Nothing changes for anyone. Confirm admins still sign in normally.
2. **Pavan enrols first**, alone, and verifies: sign out, sign in, code
   accepted. Amit stays un-enrolled as a live escape hatch throughout.
3. **Rehearse recovery for real** — Amit clears Pavan's factor, Pavan signs in
   with password alone and re-enrols. This is the step not to skip; an untested
   recovery path is not a recovery path.
4. Then Amit enrols.

**Rollback is clean and needs no deploy:** delete the factors and every account
is back to today's behaviour immediately, because the behaviour is data-driven.

---

## Risks

1. **The AAL1 half-session (highest).** Get the proxy gate wrong and MFA becomes
   a screen you can walk around. Should be the first thing tested and should
   have a `nav.test.ts`-style test pinning it.
2. **RLS does not know about AAL, and v1 will not change that.** `is_admin()`
   (0001) checks `profiles.role` only, so an AAL1 token still carries full admin
   rights at PostgREST. v1 MFA protects the *UI*, not the *data layer* — which
   sits awkwardly against CLAUDE.md's "load-bearing rules belong in the
   database". Tightening `is_admin()` with `auth.jwt()->>'aal' = 'aal2'` would
   strip admin rights from any admin who has not enrolled, so it can only follow
   mandatory enrolment, as its own migration, in Phase 2. Stating it plainly
   rather than implying v1 is stronger than it is.
3. **Admin-to-admin reset is a lateral path.** An attacker with one admin's
   password can clear the other's factor. Inherent to the model; the alternative
   is being locked out. Log every reset.
4. **Portability.** MFA binds us to GoTrue. Fine for hosted or self-hosted
   Supabase; it is the one feature that would not survive CLAUDE.md's "plain
   Postgres later" escape hatch.
5. **Small stuff:** TOTP clock drift (allow the ±1 window Supabase already
   allows); verify-attempt rate limits need the same treatment `signIn()` gives
   429; a rep could in principle enrol by calling the API directly and would
   then be prompted — not a lockout, and accepted.
6. **Copy.** These are new user-facing screens: no em-dashes in the interface
   text, per the copy polish already applied across the app.

## Not in v1

Mandatory enrolment · our own recovery codes · AAL in RLS · SMS/phone factors ·
MFA for reps.
