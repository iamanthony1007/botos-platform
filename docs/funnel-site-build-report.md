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
| 6 | Revenue calculator | Built | leads x (pct/100) x avg sale. Defaults 100 / 60% / $2,000 = $120,000. Edge-tested: blank, non-numeric, percent clamped to 100, value caps; NaN cannot render. Per Nella 2026-08-31: one secondary line beneath the headline shows recoverable revenue at RECOVERY_RATE = 0.25 (constant in Landing.jsx; the copy derives its 25% from it). No extra inputs or controls |
| 7 | "I'll audit your DMs" | Built | Five-line checklist, CTA, "50+ businesses" trust line |
| 8 | "What you get" grid | Built | Six cards. Per Nella 2026-08-31: credit card reads **$97 Credit** (was the mockup's $297), and card six is **"A Strategy Call"** ("I'll break down what the issue is so you know exactly what to do next."), replacing "100% Actionable" |
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

/audit/thank-you: per Nella's 2026-08-31 answer, the page itself delivers
the audit instructions, so fulfilment works from day one before any email
automation exists. DONE 2026-09-01: the content of her document "Getting
Your DM Messages to Me (Before Our Call).docx" is transcribed verbatim into
the AuditInstructions component in AuditThankYou.jsx (title, intro, the
ten-step messages-only export walkthrough with its video link, and the
what-happens-next section) and renders under the order confirmation.
Verified on staging: the live bundle carries the full text. Phase 2's buyer
email must be generated from this same component's copy so page and email
cannot drift.

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
3. Turnstile hostname, CONFIRMED 2026-09-01 with the error code: the widget
   fails on staging with Turnstile error 110200, "Unknown domain: Domain not
   allowed" (captured via a diagnostic render with an error callback; some
   browsers display it as "Unable to connect to website"). Fix in the
   Cloudflare dashboard: Turnstile, open the widget with sitekey
   0x4AAAAAAEIrdNtHqz3JxYx8, Hostname management, add
   botos-platform-staging.pages.dev (this also covers the per-deploy
   preview subdomains). getmu.co stays listed for production.
Then: full waitlist submit with a real Turnstile solve, row verified in
staging Supabase, Resend notification received.

Waiting on Nella (updated 2026-08-31 after her answers; $97 credit, card
six, calculator recovery line and page-as-delivery are now ANSWERED and
built):
1. Stripe Payment Link (success URL string above). Stays disabled-until-real;
   one-line swap in Audit.jsx when it arrives.
2. Testimonial card 1 wording ("hire Nella again", mockup illegible).
3. Dashboard palette question (out of scope here either way).
4. Whether the devices get a discreet "illustrative" caption (default none).

The audit-instructions docx arrived 2026-09-01 and is rendered on
/audit/thank-you; that item is closed. Fulfilment is live the moment the
Payment Link is: buyer pays, lands on the thank-you page, follows the
export instructions.

Deferred by design: a meta description would improve SEO but lives in
index.html, which is frozen with the login shell; add it in the first branch
after the Meta review thread closes.

## Phase 2, scoped 2026-08-31: Stripe webhook fulfilment. DO NOT BUILD YET

Gate: Nella's Stripe access exists and her Payment Link is live. Nothing
below is started until then; this section exists so the build is mechanical.

Route: a Cloudflare Pages Function, dashboard/functions/api/stripe-webhook.js,
POST only, alongside the waitlist function.

1. Signature verification first, before any parsing: the Stripe-Signature
   header (t and v1 fields) against the RAW request body with
   HMAC-SHA256(STRIPE_WEBHOOK_SECRET), constant-time compare, 5-minute
   timestamp tolerance. crypto.subtle covers this; no Stripe SDK, no new
   dependencies. Unverified requests get 400 and do nothing.
2. Handle checkout.session.completed only; every other event type returns
   200 unhandled. Extract from session.customer_details: email, name, phone;
   Instagram handle from the Payment Link's custom field. TWO PAYMENT LINK
   PREREQUISITES FOR NELLA'S STRIPE, or these fields simply do not exist in
   the event: enable phone number collection, and add a custom field with
   key instagram_handle.
3. Record the purchase, awaited, before any email: insert into
   audit_purchases via migration 016 (016_audit_purchases.sql plus
   rollback). Sketch: id uuid pk, created_at, stripe_session_id text UNIQUE,
   email not null, name, phone, instagram_handle, amount_total integer,
   currency text, payment_status text, raw_session jsonb. RLS enabled, zero
   anon access, authenticated read-only at most; writes only through this
   function on the service key (the migration 010 model). The UNIQUE on
   stripe_session_id makes Stripe's retry deliveries idempotent: on
   conflict, skip the emails, return 200.
4. Then, not awaited (the waitlist function's waitUntil pattern): Resend to
   the buyer carrying the SAME instructions the thank-you page renders
   (extract AUDIT_INSTRUCTIONS into one shared module both import, so page
   and email cannot drift), and a Resend notification to Nella with the
   buyer's handle, email and phone.
5. Env, via Pages UI per the standing rule: STRIPE_WEBHOOK_SECRET new;
   SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, NELLA_NOTIFY_EMAIL
   already required by the waitlist function. No Stripe API key is needed
   at all: the webhook only receives and verifies.
6. Stripe-side setup: webhook endpoint registered for
   https://getmu.co/api/stripe-webhook on checkout.session.completed, secret
   copied into the env. Staging first with Stripe test mode and the CLI
   relay, then production.
