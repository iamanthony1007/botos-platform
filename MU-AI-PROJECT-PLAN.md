# Mu AI: Phase 2 Project Plan

Prepared for Nella by Anthony. Last updated 2026-05-19.

This document explains what we're doing next, why, who does what, what it costs, and what to expect along the way.

---

## What this phase delivers

By the end of this phase, Mu AI is white-label ready and you can begin onboarding the coaches you have waiting. Concretely:

- A Meta-approved Mu AI app, registered under your company's Business Portfolio
- The official Instagram Messaging API integrated, so we're no longer routing everything through ManyChat as middleware
- Inbound visibility: every Instagram DM, comment on relevant posts, and engagement-driven lead is captured in the dashboard
- The infrastructure to add a second coach with about 20 minutes of work instead of a multi-week rebuild
- A working `getmu.co` domain with a placeholder landing page and a privacy policy

Timeline: 4 to 8 weeks wall clock. Most of that is Meta's review queue, not active work.

---

## Why this phase exists

The first phase (Coach Shaun's bot) showed the system works. But it's tied to Coach Shaun's accounts, routed through a middleware tool (ManyChat), and not yet structured for a white-label SaaS you can resell.

Phase 2 turns Mu AI from a custom build for one coach into a product you can sell to multiple coaches.

---

## Cost

**Standard rate for this scope: $2500.**

**Your rate: $1200**, payable 50/50.

I'm doing it at this rate because revenue hasn't started yet and I want this relationship to keep working long term. I also should have laid out scope and pricing more cleanly from the start; this is me fixing that for everything going forward.

### Payment

- **$600 upfront** to start the work. No pressure on timing, but the work doesn't start until this is paid because I need to actually allocate the hours.
- **$600 on Meta approval** of the App Review submission.

If you'd prefer, the $400 outstanding from the original setup can be rolled into the first instalment, making it $1000 upfront / $600 on approval. Your call.

### What the $1200 covers

| Deliverable | Status |
|---|---|
| Meta App registration under your Business Portfolio | Included |
| Tech Provider designation (required for serving multiple businesses) | Included |
| Privacy policy v1 (I draft, you review, we publish at `getmu.co/privacy`) | Included |
| Deauthorize callback endpoint (Meta-required) | Included |
| Data deletion request endpoint (Meta-required) | Included |
| Test Instagram account setup for Meta's reviewer | Included |
| One screencast per requested permission (3 total) | Included |
| Written permission justifications for the App Review form | Included |
| App Review submission | Included |
| One revision cycle if Meta requests changes | Included |
| Domain DNS swap from GoDaddy to Cloudflare | Included |
| Placeholder landing page at `getmu.co` | Included |
| Inbound Visibility Phase 1 integration after Meta approval | Included |

### What it doesn't cover

| Item | Why separate | Who pays |
|---|---|---|
| Lawyer review of the privacy policy | Optional; legal advice is your call | You, direct to the lawyer if you want one |
| Domain renewal | Already your annual cost | You, through GoDaddy |
| Stripe / billing setup when the SaaS goes live | Separate phase, future work | Quoted separately later |
| Additional revision cycles past one | Rare, but Meta can ask for multiple rounds | Quoted hourly if it happens |
| Company formation if you don't have a registered entity yet | Outside engineering scope | You, direct to a formation agent |

---

## The two stages of approval

Meta requires us to pass two separate approvals before we can run Mu AI at full capacity. They happen in sequence.

### Stage 1: Business Verification (1 to 3 business days)

Meta confirms your company is a real legal entity. This is a one-time process per Business Portfolio. Once verified, every app under it benefits.

What Meta needs:
- Legal business name
- Business address (must match the registration document)
- Business registration document or certificate of incorporation
- Business phone number Meta can call or text to verify
- Business email
- Business website (a one-page landing site is fine; it must be live, not 404)

### Stage 2: App Review (2 to 4 weeks, possibly longer with revisions)

Meta reviews the Mu AI app and confirms it uses each requested permission appropriately. This is what unlocks the messaging permissions we need.

What goes into the submission:
- Privacy policy URL (I draft, you approve)
- App icon (your Mu AI logo, cropped to 1024x1024)
- Detailed step-by-step instructions for Meta's reviewer
- Test credentials so the reviewer can log in
- A short screen recording for each permission
- Written justification for each permission

If Meta requests changes, the clock resets while we revise. We mitigate this by being thorough on the first submission. One revision cycle is included in the price; rare additional revisions would be quoted separately.

---

## What we're asking Meta for

Three permissions and one feature. Each is justified by something the system actually does.

### `instagram_business_basic`
Read the connected Instagram account's username, ID, and profile picture so we can display sender info correctly and route messages to the right coach.

### `instagram_business_manage_messages`
Receive incoming DMs and send replies on behalf of the connected account. This is the core function: lead messages the coach's IG, AI generates a reply, we send it. All conversations are visible in the dashboard so the coach can review or take over at any time.

### `instagram_business_manage_comments`
Read new comments on the coach's posts so we can trigger comment-to-DM automation. When a lead comments a keyword (e.g. "GOLF" on a post about a free guide), the bot DMs them with the guide. This is the closest legitimate equivalent to a "new follower" trigger.

### Human Agent feature
Auto-included with the messaging permission. Lets the bot follow up at the 20-hour mark without hitting Meta's 24-hour wall.

We are deliberately not requesting permissions we don't use (content publishing, follower analytics), to keep the review fast.

---

## A note on new followers

If you've used ManyChat or similar tools, you may have seen a "new follower" trigger. Meta doesn't actually offer that on the official Instagram API. Tools that claim to have it are either polling (slow and lossy, often delayed by minutes) or scraping (against Meta's terms, gets accounts banned). Neither is a sound foundation for a production SaaS.

What we use instead is the comments webhook, which fires in real time when someone comments on the coach's content. A commenter is a stronger lead than a follower anyway: they've explicitly raised their hand, and the comment text tells us what they're interested in. The coach posts a CTA ("comment GOLF for my free swing guide"), the bot DMs every commenter who used the keyword, and the standard Mu AI funnel takes over.

---

## Order of operations

Each step depends on the one before it. The right sequence:

1. **You answer the pre-flight checklist** (below) so I know what business documents and assets you already have
2. **Domain DNS swap** from GoDaddy to Cloudflare, placeholder landing page goes up at `getmu.co`
3. **You create the new Business Portfolio** at business.facebook.com under your personal Facebook (20 minutes; you have to do this yourself because it's tied to your Facebook identity)
4. **You submit Business Verification** with your business documents
5. **I create the Meta App** under your Business Portfolio and configure webhooks
6. **I draft the privacy policy** and we publish it at `getmu.co/privacy`
7. **I build the deauthorize and data deletion endpoints** on the existing Cloudflare Worker
8. **I set up the test Instagram account** for Meta's reviewer
9. **I make the first successful API call** (Meta requires this before they let us submit)
10. **I record the screencasts** and write the permission justifications
11. **I submit the App Review**
12. **We respond to any reviewer feedback** if Meta requests changes

Steps 1 and 2 can happen this week. Step 3 onwards depends on you having the business documents ready.

---

## Pre-flight checklist

Before any technical work starts, I need to know what you already have vs what we still need to set up. For each item below, just yes / no / not sure, and if you have it, send it.

1. **Registered business entity?** If yes, what's the legal name and where is it incorporated?
2. **Business registration document or certificate of incorporation?** PDF or photo is fine.
3. **Business address** (matches the registration document)?
4. **Business phone** Meta can call or text? Doesn't have to be a landline.
5. **Business email** you'll keep long-term?
6. **Public business website?** Even one page counts. If no, the placeholder we set up at `getmu.co` will work.
7. **GoDaddy account access for the domain DNS swap?** I'll need either temp access or 15 minutes on a call with you to swap nameservers together.
8. **Existing Meta Business Portfolios?** Meta caps at 2 created per personal Facebook account; want to make sure you're not already at the limit.
9. **Logo:** I have the two variants you sent. I'll use the stacked version, cropped to 1024x1024 for Meta's app icon requirement. No action needed from you here.
10. **Comfortable being the Data Protection Officer named in the privacy policy?** If not, who should be listed?

Honest answers help me size the work. If you don't have something on the list, that's fine; we just plan for it.

---

## Who does what

### Your responsibilities

These touch your Facebook account or your company's legal identity, so I can't do them for you:

- Answer the pre-flight checklist
- Either grant me temporary GoDaddy account access or do the nameserver swap on a 15-minute call with me
- Create the new Business Portfolio at business.facebook.com (20 minutes)
- Submit Business Verification with your business documents
- Review the privacy policy I draft before we publish it
- Forward Meta's emails to me so I see verification status and App Review responses
- Make the first $600 payment to start the work
- Make the second $600 payment on Meta approval

### My responsibilities

Everything technical:

- Set up Cloudflare for the domain once nameservers are delegated
- Build the placeholder landing page at `getmu.co`
- Draft the privacy policy
- Create the Meta App in App Dashboard
- Mark it as a Tech Provider
- Build the deauthorize and data deletion endpoints
- Configure webhooks
- Set up the test Instagram account
- Make the first API call
- Record the screencasts
- Write the permission justifications
- Submit App Review
- Respond to any revision requests

---

## Realistic timeline

Best case, nothing stalls:

- **This week**: pre-flight checklist answered, domain DNS swapped, placeholder landing page live, business documents confirmed
- **Week 1**: you create Business Portfolio and submit Business Verification. I create the Meta app, build deauthorize/deletion endpoints, draft privacy policy
- **Week 2**: Business Verification approved. I finish privacy policy, set up test account, record screencasts, write justifications. Submit for App Review
- **Weeks 3 to 5**: Meta reviews. Possibly one revision cycle
- **Week 6**: Approved. Switch app to Live mode. Begin Phase 1 Inbound Visibility integration

Worst case: 8 to 12 weeks if Meta wants multiple revisions or denies an initial submission. We mitigate by being thorough on the first submission.

If you don't have a registered business entity yet, add 2 to 6 weeks at the front of all of this for company formation.

---

## Common reasons App Review gets rejected (so we avoid them)

From Meta's own guidance and 2026 community reports:

1. **Privacy policy missing required disclosures.** Must list every third party that processes user data. Ours: Anthropic, Supabase, Cloudflare, Make, ManyChat.
2. **Screencast doesn't clearly show the permission being used.** Reviewer must see the data being read or written, not just the app's UI in general.
3. **Test account login doesn't work.** Reviewer fails the login step and denies immediately.
4. **App not live enough for the reviewer to test.** The hosted app at the URL must actually work.
5. **Permission justification is vague.** Specific use case required.
6. **Requesting permissions not actually used.** We're only asking for what we use.
7. **Webhook callback URL not responding correctly.** Meta tests it during setup.

I've designed the submission around avoiding all seven.

---

## What happens after approval

Once App Review is approved and we switch the app to Live mode:

- We integrate Inbound Visibility Phase 1 (the funnel work this whole phase has been building toward)
- You can start onboarding the coaches you have waiting
- Each new coach is roughly 20 minutes of setup (OAuth flow, dashboard config) instead of a custom build
- Meta requires us to keep the privacy policy URL working, honour data deletion requests within 30 days, and re-submit if we add new permissions later. All of that is ongoing maintenance covered by the $400/month management fee.

---

## Questions?

Anything in here that's unclear, send me a message. The pre-flight checklist is the fastest way to unblock everything, so the more of those you can answer in one go, the faster we move.
