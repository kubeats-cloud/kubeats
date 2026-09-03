# docs

- **`field-ops-demo.tsx`** — the validated click-through prototype.

  It is the reference for **behaviour, field names and flows only**: activity
  keys, the weekly metric set, the "open for today" meeting gate, the Set → Done
  lifecycle, the follow-up visibility rules and the weekly lock.

  **Its visuals are not our design.** The cream/teal/gold palette and Fraunces
  serif in this file are deliberately not carried into the app — see the
  Design & UI section in `CLAUDE.md` for what we actually build.

  It is reference only: not imported, compiled or linted as part of the app
  (excluded in `tsconfig.json` and `eslint.config.mjs`). Its fake name-picker
  login and browser key-value storage are replaced by Supabase Auth and Postgres.
