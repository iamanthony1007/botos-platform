# Dashboard deploy guide

This file is the single source of truth for how to ship the Mu AI dashboard.
Written for Anthony's level. Keep it short.

---

## How to deploy

Two commands, run from the `dashboard/` directory in PowerShell.

### Deploy to STAGING

```
cd "C:\Users\Order Account\botos-platform\dashboard"
npm run deploy:staging
```

What this does, in order:

1. `prebuild:staging` runs `node scripts/verify-env.mjs staging`. It asserts
   that `dashboard/.env.staging` contains the staging Supabase URL AND that
   the anon key JWT decodes to a matching project ref with role `anon`. If
   anything is off, the chain stops here.
2. `build:staging` runs `vite build --mode staging`. Vite reads
   `dashboard/.env.staging` and bakes the staging Supabase URL into the
   bundle.
3. `deploy:staging` runs `wrangler pages deploy dist --project-name=botos-platform-staging --branch=main --commit-dirty=false`.
   Wrangler will refuse to upload if your git working tree is dirty. Commit
   first, then deploy.
4. `postdeploy:staging` runs `node scripts/verify-deploy.mjs staging`. It
   fetches the live URL and confirms the deployed bundle actually points at
   staging Supabase. If it does not, the script tells you to roll back.

### Deploy to PRODUCTION

```
cd "C:\Users\Order Account\botos-platform\dashboard"
npm run deploy:production
```

Same chain shape, but every step uses the production project: it reads
`dashboard/.env.production`, deploys to the production Pages project
(`botos-platform`), and post-checks the production URL
(`botos-platform-3ar.pages.dev`).

---

## What the safety checks do

| Step | Script | Catches |
| --- | --- | --- |
| Pre-build | `scripts/verify-env.mjs` | A mismatch between the env file's Supabase URL and the anon key's project ref. A service_role key pasted into a frontend env file by mistake. A missing or malformed env file. |
| Wrangler flag | `--commit-dirty=false` | An uncommitted source change shipping in a deploy. Wrangler will refuse to upload until you commit. |
| Post-deploy | `scripts/verify-deploy.mjs` | The live bundle calling the wrong Supabase project. This catches stale-dist uploads and any case where the bundle on the server is not what we intended. |

The 2026-05-29 production incident (stale dist with staging Supabase URL
uploaded to the prod Pages project, real users locked out) would have been
caught by the post-deploy check within seconds. Adopt the npm scripts and
that class of incident becomes structurally impossible.

---

## What to do if a deploy goes wrong

If `postdeploy:*` exits 1 with the message `DEPLOYED BUNDLE POINTS AT WRONG SUPABASE`:

1. Do not panic. The script already told you which environment you broke.
2. Open the Cloudflare dashboard, Workers and Pages.
3. Open the affected Pages project (`botos-platform-staging` or
   `botos-platform`).
4. Click the **Deployments** tab.
5. Find the previous successful deployment (the one above the one you just
   uploaded).
6. Click the three-dot menu on its row and choose **Rollback to this
   deployment**.
7. Once Cloudflare confirms rollback, re-run the post-deploy verifier from
   the dashboard directory to confirm the rollback is healthy:
   ```
   node scripts/verify-deploy.mjs production
   ```
   or `staging` for the staging environment.
8. Tell whoever is paged that you are restored, then debug the broken
   bundle separately (do not retry the deploy until you understand why it
   failed).

If wrangler errors out before deploying (for example because of
`--commit-dirty=false`):

- Run `git status` and commit or stash the dirty files.
- Then re-run the `npm run deploy:*` command.

---

## Why we do not run `npm run build` directly anymore

It used to default to `vite build` with no mode, which reads `dashboard/.env`
only. On 2026-05-29 someone ran `npm run build:staging` to produce a dist
for staging, then later deployed that same dist to production by accident.
The deployed bundle pointed at staging Supabase and locked real users out.

The clean fix is to never deploy without first running the matching build
in the same chain, and to verify the bundle after upload. That is what
`npm run deploy:staging` and `npm run deploy:production` enforce. The bare
`npm run build` script has been removed so it cannot be invoked at all.

---

## Env file policy

`dashboard/.env`, `dashboard/.env.staging`, and `dashboard/.env.production`
are tracked in git. They contain Supabase URLs and anon keys only. Anon
keys are public read-only by design and are RLS-gated server-side, so it is
safe to commit them. Do NOT put `service_role` keys in these files. If you
ever rotate the anon keys you will need to update both the file and the
Pages project env vars.

`dashboard/.env` is a legacy fallback. The canonical production env is
`dashboard/.env.production`. The deploy scripts only ever read the
`.env.staging` or `.env.production` files explicitly.
