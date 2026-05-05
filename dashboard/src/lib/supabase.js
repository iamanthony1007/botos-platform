import { createClient } from '@supabase/supabase-js'

// Supabase config is loaded from environment variables at BUILD TIME.
// Vite reads these from .env (production) or .env.staging (when built with --mode staging).
//
// production build:  npm run build           reads dashboard/.env
// staging build:     npm run build:staging   reads dashboard/.env.staging
//
// TODO (Phase 3 RLS audit): Anon keys are technically safe to ship to the client
// because Supabase relies on Row Level Security (RLS) for authorization, but our
// repo is currently public on GitHub. Re-evaluate whether to gitignore .env files
// once RLS policies are fully audited and locked down.

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase config. Check that VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in dashboard/.env (production) or dashboard/.env.staging (when running npm run build:staging).'
  )
}

export const supabase = createClient(url, anonKey)
