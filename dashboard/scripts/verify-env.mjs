// verify-env.mjs
//
// Pre-build env guard. Runs BEFORE Vite via the "prebuild:staging" and
// "prebuild:production" npm hooks. If the env file does not match the
// intended target, this script exits non-zero and the build aborts.
//
// Why: on 2026-05-29 a stale dist built against staging was direct-uploaded
// to the production Pages project. This guard makes that class of mistake
// noisy at build time instead of silent at run time.
//
// Usage:
//   node scripts/verify-env.mjs staging
//   node scripts/verify-env.mjs production
//
// Checks:
//   1. The matching .env file (.env.staging or .env.production) exists.
//   2. VITE_SUPABASE_URL contains the expected Supabase project ref.
//   3. VITE_SUPABASE_URL does NOT contain the other project's ref.
//   4. VITE_SUPABASE_ANON_KEY is a JWT, decodes cleanly, and its "ref"
//      claim matches the expected project. This catches the URL-and-anon-key
//      mismatch state we saw on 2026-05-29.
//   5. The JWT "role" claim is "anon", not "service_role". Defends against
//      pasting a service key into a frontend env file by accident.
//
// Dependencies: Node builtins only. No npm install required.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const mode = process.argv[2]
if (!mode || (mode !== 'staging' && mode !== 'production')) {
  console.error('verify-env: expected one argument, "staging" or "production"')
  process.exit(1)
}

const EXPECTED = {
  staging: {
    ref: 'hlpucysbaqerhwahfolg',
    wrongRef: 'rydkwsjwlgnivlwlvqku',
    file: '.env.staging',
  },
  production: {
    ref: 'rydkwsjwlgnivlwlvqku',
    wrongRef: 'hlpucysbaqerhwahfolg',
    file: '.env.production',
  },
}[mode]

// We are invoked from the dashboard directory by npm. Resolve env file there.
const dashboardDir = process.cwd()
const envPath = path.join(dashboardDir, EXPECTED.file)

const fail = (msg) => {
  console.error('======================================================')
  console.error(`verify-env [${mode}]: ABORTING BUILD`)
  console.error(msg)
  console.error(`file: ${envPath}`)
  console.error(`expected Supabase project ref: ${EXPECTED.ref}`)
  console.error('Fix the env file before building. Do NOT deploy.')
  console.error('======================================================')
  process.exit(1)
}

let raw
try {
  raw = fs.readFileSync(envPath, 'utf8')
} catch (e) {
  fail(`cannot read ${envPath}: ${e.message}`)
}

const findVal = (key) => {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    if (trimmed.slice(0, eq).trim() === key) return trimmed.slice(eq + 1).trim()
  }
  return null
}

const url = findVal('VITE_SUPABASE_URL')
const anon = findVal('VITE_SUPABASE_ANON_KEY')

if (!url) fail('VITE_SUPABASE_URL is missing')
if (!anon) fail('VITE_SUPABASE_ANON_KEY is missing')

if (!url.includes(EXPECTED.ref)) {
  fail(`VITE_SUPABASE_URL does not contain expected ref "${EXPECTED.ref}". URL was: ${url}`)
}
if (url.includes(EXPECTED.wrongRef)) {
  fail(`VITE_SUPABASE_URL contains the WRONG project ref "${EXPECTED.wrongRef}". URL was: ${url}`)
}

// Decode JWT middle segment (base64url) to read the "ref" and "role" claims.
const parts = anon.split('.')
if (parts.length !== 3) {
  fail('VITE_SUPABASE_ANON_KEY does not look like a JWT (expected three dot-separated parts)')
}
let payload
try {
  const mid = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = mid + '='.repeat((4 - (mid.length % 4)) % 4)
  payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
} catch (e) {
  fail(`VITE_SUPABASE_ANON_KEY failed to decode: ${e.message}`)
}

if (payload.ref !== EXPECTED.ref) {
  fail(
    `VITE_SUPABASE_ANON_KEY belongs to project "${payload.ref}", expected "${EXPECTED.ref}". ` +
    `The anon key is for the wrong project. This is the URL-and-key-mismatch state from 2026-05-29.`
  )
}
if (payload.role !== 'anon') {
  fail(
    `VITE_SUPABASE_ANON_KEY role is "${payload.role}", expected "anon". ` +
    `Do NOT put service_role keys in the frontend env files.`
  )
}

console.log(`verify-env [${mode}]: OK. URL ref and anon JWT ref both match "${EXPECTED.ref}", role is "anon".`)
