# Funnel site build report, feat/funnel-site

Date: 2026-08-31. Branch: feat/funnel-site off main (f19d4a1).
Staging preview for Nella: https://botos-platform-staging.pages.dev
Production: UNTOUCHED. Gate is Nella's sign-off on the staging preview.

Source of truth: her three mockups (homepage, waitlist + audit pages, her
photo). Client copy rendered verbatim, including its em dashes; the repo's
no-em-dash rule covers our prose and code only, recorded in commit 1151a42.

## Section-by-section status against the homepage mockup

| # | Section | Status | Notes |
|---|---------|--------|-------|
| 1 | Announcement strip | Built | CTA routes to /waitlist. Log in kept reachable at the strip edge, understated |
| 2 | Hero | Built | Badge, headline, italic subhead, audit CTA, four trust chips, stars and trust line, coded device collage (phone chat, conversations panel, four stat cards) |
| 3 | "You have leads in your DMs" | Built | Coded audit-overview collage left, copy and CTA right |
| 4 | Profile card | Built | Her real photo (repo asset, 640px JPEG). Local time computed from Europe/Madrid, refreshes every 30s, never faked |
| 5 | "Sound familiar?" grid | Built | Six line-icon pains plus the warning callout, wording verbatim |
| 6 | Revenue calculator | Built | leads x (pct/100) x avg sale. Defaults 100 / 60% / $2,000 = $120,000. Edge-tested: blank, non-numeric, percent clamped to 100, value caps; NaN cannot render |
| 7 | "I'll audit your DMs" | Built | Five-line checklist, CTA, "50+ businesses" trust line |
| 8 | "What you get" grid | Built | Six cards. **$297 Credit rendered as shown, PENDING Nella's confirmation**; swap is one string in Landing.jsx GET_CARDS |
| 9 | Audit-credit note line | Built | Verbatim |
| 10 | Testimonials | Built | Four cards, 5.0 stars, dates, highlight spans placed as drawn. **One word needs Nella's eye**: card 1's mockup text is AI-garbled at "I would happily hire ___ again"; rendered as "Nella" |
| 11 | Footer CTA strip | Built | Calendar icon, two-line close, CTA, stacked chips |

Every "Join the Waitlist" routes to /waitlist, every audit CTA to /audit,
both click-verified. /how-it-works redirects to /. Logged-in visitors to /
still land on /dashboard (unchanged PublicRoute behavior).

## Waitlist page (/waitlist)

Restyled to the left mockup: LIMITED SPOTS badge, serif headline, copy,
coded Messages-phone scene with the handwritten note card, "Save Your Spot"
form. Fields per the briefing: Business Name, Instagram Handle, Email
Address, Phone Number, all required. Turnstile and the honeypot stay.
Success state renders exactly: "Thank you for joining the waitlist."

Backend: functions/api/waitlist.js rewritten for the four fields (validation,
Turnstile server verify, ip_hash, user_agent, Resend notification carrying
the new fields). Migration 015 (db/migrations/015_waitlist_funnel_fields.sql
plus rollback) adds phone and drops NOT NULL on the columns the old
application form required; old rows keep their data.

## Audit page (/audit) and payment

Built to the right mockup: DM AUDIT badge, headline, subhead, price card,
three chips, paper-collage visual, seven-item What's Included, "You'll walk
away with..." sidebar with the credit note, outro card with her photo and
signature. The Stripe button is wired to STRIPE_PAYMENT_LINK in
Audit.jsx (empty constant, loud TODO) and renders disabled as "Checkout
coming soon" until her link arrives; pasting the link is the entire change.
No payment code, no Stripe keys anywhere in repo or bundle (grep-verified:
only the visible "powered by stripe" wordmark).

**String to pass to Nella for the Payment Link success URL:**
`https://getmu.co/audit/thank-you`

/audit/thank-you is a shell (confirmation headline, receipt line, back
button); the intake or booking element waits on her fulfilment answer.

## Device imagery

All device screens are coded HTML/CSS components in the rose palette, no
screenshots, no sliced PNGs: phone chat, conversations panel, stat cards,
audit overview laptop, revenue-leakage phone, messages phone, tablet chat,
paper collage. Contents match the mockup's fictional figures; handles are
invented and resolve to nobody. Avatars are abstract gradient circles, no
faces. No "illustrative" caption rendered, per default, until Nella answers.

## Design system

Tokens live in dashboard/src/marketing.css only, scoped under .mk-page, so a
palette change is one edit and the dashboard/auth surfaces cannot be
affected. Fonts: Playfair Display + Poppins (two families), runtime-injected
by marketing pages only; index.html untouched. Metric-matched local fallback
faces eliminate the font-swap layout shift. Logo: the repo's golden rabbit
icon, wordmark removed; the mockup's rabbit and "Moo" mark are not used.

## Verification record

- Login surface: git diff main for Login/ForgotPassword/ResetPassword/
  AcceptInvite and index.html is 0 lines. Live check: /login on staging still
  renders main's gold page. verify-deploy [staging] OK on every deploy (15
  chunks scanned, staging ref 1, wrong ref 0).
- Local: all routes render at desktop and 375px, no horizontal overflow;
  every CTA resolves; calculator edge cases pass; eslint clean.
- Staging deploys: final bundle deployed and verified against project
  botos-platform-staging (entry index-*.js per verify-deploy output above).
- Lighthouse (staging, this machine): accessibility 100 on all three pages
  after a contrast pass (small-text pink darkened to #c81b57, muted grays
  darkened; vivid brand pink kept on large headlines and buttons),
  best-practices 100, SEO 92. CLS fixed from 0.372 to 0 via the font
  fallbacks. Performance scored 34-54 across runs, but the machine was
  loaded and the variance (TBT 480ms to 2,830ms run to run) makes the number
  unreliable; re-measure on PageSpeed Insights before reading anything into
  it. The structural LCP cost is the SPA shell (no SSR), pre-existing.

## Blocked and pending

Waiting on Anthony (staging E2E of the waitlist is blocked on all three):
1. Migration 015 pasted into the STAGING Supabase SQL editor
   (db/migrations/015_waitlist_funnel_fields.sql; verification SELECT and
   expected output are in the file). Production paste happens only with the
   production deploy after sign-off.
2. Staging Pages env vars: the waitlist function's GET diagnostics on
   staging report ALL env missing (SUPABASE_URL, SUPABASE_SERVICE_KEY,
   TURNSTILE_SECRET_KEY, RESEND_API_KEY, NELLA_NOTIFY_EMAIL). Set via
   Cloudflare Pages UI on botos-platform-staging.
3. Turnstile hostname: the widget stays blank on staging; the sitekey does
   not appear to allow botos-platform-staging.pages.dev. Add the hostname to
   the Turnstile widget config (or accept E2E on production post-sign-off).
Then: full waitlist submit with a real Turnstile solve, row verified in
staging Supabase, Resend notification received.

Waiting on Nella:
1. Stripe Payment Link (success URL string above).
2. $297 Credit figure confirmation.
3. Thank-you page fulfilment flow (intake, booking, or email-only).
4. Testimonial card 1 wording ("hire Nella again", mockup illegible).
5. Dashboard palette question (out of scope here either way).
6. Whether the devices get a discreet "illustrative" caption (default none).

Deferred by design: a meta description would improve SEO but lives in
index.html, which is frozen with the login shell; add it in the first branch
after the Meta review thread closes.
