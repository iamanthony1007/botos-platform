// verify-deploy.mjs
//
// Post-deploy bundle check. Runs AFTER wrangler pages deploy via the
// "postdeploy:staging" and "postdeploy:production" npm hooks. Fetches the
// live Pages URL, locates the JS bundle, and confirms its baked-in
// createClient URL points at the expected Supabase project.
//
// Why: even with the pre-build guard, it is still possible to deploy a
// stale dist that was built earlier under a different env. This script
// reads the actually-deployed bundle and proves it is correct, or screams
// if it is not.
//
// Usage:
//   node scripts/verify-deploy.mjs staging
//   node scripts/verify-deploy.mjs production
//
// The createClient URL in the bundled JS appears as
//   <minified>(`https://<ref>.supabase.co`, `eyJ...`)
// or with double quotes depending on Vite's minifier. Logo asset URLs use
// the same hostname but are followed by `/storage/v1/...`, so the regex
// below intentionally requires a string-terminator (` or ") immediately
// after the hostname. That distinguishes the auth client URL from the
// logo image references that are hardcoded into the source.
//
// Dependencies: Node builtins only (uses global fetch from Node 18+).

import process from 'node:process'

const mode = process.argv[2]
const TARGETS = {
  staging: {
    ref: 'hlpucysbaqerhwahfolg',
    wrongRef: 'rydkwsjwlgnivlwlvqku',
    url: 'https://botos-platform-staging.pages.dev',
  },
  production: {
    ref: 'rydkwsjwlgnivlwlvqku',
    wrongRef: 'hlpucysbaqerhwahfolg',
    url: 'https://botos-platform-3ar.pages.dev',
  },
}
const t = TARGETS[mode]
if (!t) {
  console.error('verify-deploy: expected one argument, "staging" or "production"')
  process.exit(1)
}

const fail = (msg) => {
  console.error('==============================================================')
  console.error(`verify-deploy [${mode}]: FAILED`)
  console.error(msg)
  console.error('--------------------------------------------------------------')
  console.error('DEPLOYED BUNDLE POINTS AT WRONG SUPABASE.')
  console.error('ROLL BACK NOW VIA CLOUDFLARE PAGES DASHBOARD.')
  console.error('  1. Open the Pages project for this environment')
  console.error('  2. Deployments tab')
  console.error('  3. Find the previous successful deployment')
  console.error('  4. Click the three-dot menu and choose "Rollback to this deployment"')
  console.error('==============================================================')
  process.exit(1)
}

console.log(`verify-deploy [${mode}]: fetching ${t.url}/`)
let indexHtml
try {
  const resp = await fetch(t.url + '/', { cache: 'no-store' })
  if (!resp.ok) fail(`could not fetch ${t.url}/: HTTP ${resp.status}`)
  indexHtml = await resp.text()
} catch (e) {
  fail(`network error fetching ${t.url}/: ${e.message}`)
}

const bundleMatch = indexHtml.match(/assets\/index-[A-Za-z0-9_-]+\.js/)
if (!bundleMatch) fail('could not find an "assets/index-*.js" bundle reference in index.html')
const bundlePath = bundleMatch[0]
console.log(`verify-deploy [${mode}]: live bundle is ${bundlePath}`)

let bundle
try {
  const resp = await fetch(t.url + '/' + bundlePath, { cache: 'no-store' })
  if (!resp.ok) fail(`could not fetch bundle: HTTP ${resp.status}`)
  bundle = await resp.text()
} catch (e) {
  fail(`network error fetching bundle: ${e.message}`)
}

console.log(`verify-deploy [${mode}]: bundle size ${bundle.length} bytes`)

// Since the lazy-loading split (feat/homepage-restructure, 2026-08-22) the
// entry bundle no longer contains createClient: the Supabase client lives in a
// shared chunk (AuthContext-<hash>.js) that both the entry and the lazy
// dashboard chunks import. Checking only index-*.js therefore fails on a
// CORRECT deploy. So: discover every assets/*-<hash>.js chunk named in
// index.html or referenced from the entry bundle, fetch them all, and run the
// auth-pattern check across the union. The union is what the browser can
// execute, so it is the honest surface for "which Supabase does this deploy
// talk to".
const chunkNames = new Set()
const CHUNK_RE = /[A-Za-z0-9_.-]+-[A-Za-z0-9_-]+\.js/g
for (const m of indexHtml.matchAll(/assets\/([A-Za-z0-9_.-]+-[A-Za-z0-9_-]+\.js)/g)) chunkNames.add(m[1])
for (const m of bundle.matchAll(CHUNK_RE)) chunkNames.add(m[0])
chunkNames.delete(bundlePath.replace('assets/', ''))

const pieces = [{ name: bundlePath, text: bundle }]
for (const name of chunkNames) {
  try {
    const resp = await fetch(t.url + '/assets/' + name, { cache: 'no-store' })
    // A name-shaped string in the entry that is not actually a served chunk
    // (e.g. a filename inside a source string) 404s here; skip it silently.
    if (resp.ok) pieces.push({ name: 'assets/' + name, text: await resp.text() })
  } catch { /* network blip on one chunk: the entry check below still gates */ }
}
console.log(`verify-deploy [${mode}]: scanned ${pieces.length} JS files (entry + ${pieces.length - 1} chunks)`)

// Auth (createClient) URL pattern: hostname followed by " or backtick.
// Logo URL pattern: hostname followed by /storage/. Not matched here.
const BACKTICK = String.fromCharCode(0x60)
const authRe = (ref) => new RegExp(ref + '\\.supabase\\.co["' + BACKTICK + ']', 'g')

let expectedAuthMatches = 0
let wrongAuthMatches = 0
for (const p of pieces) {
  const good = (p.text.match(authRe(t.ref)) || []).length
  const bad = (p.text.match(authRe(t.wrongRef)) || []).length
  if (good) console.log(`verify-deploy [${mode}]: expected ref found in ${p.name} (${good})`)
  if (bad) console.log(`verify-deploy [${mode}]: WRONG ref found in ${p.name} (${bad})`)
  expectedAuthMatches += good
  wrongAuthMatches += bad
}

console.log(`verify-deploy [${mode}]: expected ref "${t.ref}" auth-pattern matches: ${expectedAuthMatches}`)
console.log(`verify-deploy [${mode}]: wrong ref    "${t.wrongRef}" auth-pattern matches: ${wrongAuthMatches}`)

if (wrongAuthMatches > 0) {
  fail(`bundle contains the createClient URL for the WRONG project "${t.wrongRef}". Real users will be authenticated against the wrong Supabase.`)
}
if (expectedAuthMatches < 1) {
  fail(`bundle does NOT contain the expected createClient URL for "${t.ref}". The deploy did not bake the right Supabase URL.`)
}

console.log(`verify-deploy [${mode}]: OK. Live bundle calls createClient against "${t.ref}".`)
