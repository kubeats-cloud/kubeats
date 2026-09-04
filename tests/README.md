# Tests

    npm test          # everything that can run here
    npm run test:watch

**`unit/`** is pure logic — week arithmetic, the weekly metric rules, the
validation schemas. No database, no network, runs anywhere including CI.

**`integration/`** covers the rules that live in Postgres rather than in the
app: the meeting gate, the weekly lock and its admin-only reopen, and RLS
isolation between two reps. They are the tests worth having, because these are
the rules the whole product leans on and none of them can be verified by
reading TypeScript.

They need a real Supabase project: copy `.env.example` to `.env.local`, fill in
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`, and apply migrations `0001`–`0002`. Without
`SUPABASE_SERVICE_ROLE_KEY` they skip themselves, which is why CI stays green
without secrets.

They create their own throwaway accounts, institutes and rows — every name is
prefixed `test:` — and delete them again afterwards, including on failure. Run
them against a development project, never production.
