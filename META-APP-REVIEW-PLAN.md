# Meta App Review Plan: Mu AI

My working notes for getting the Mu AI app approved by Meta so we can move on Inbound Visibility Phase 1.

This file is the single source of truth for everything App Review related. If something's not in here, it's not part of the plan yet. Last updated 2026-05-19.

---

## Where we are right now

- Nella confirmed (2026-05-19) that Coach Shaun's IG is linked to a Facebook Page. Good.
- Nella approved going ahead with App Review.
- Domain confirmed: `getmu.co`, registered at GoDaddy. DNS export shows it's currently parked on GoDaddy WebsiteBuilder. Nameservers: `ns35.domaincontrol.com`, `ns36.domaincontrol.com`. DMARC record exists (auto-set by GoDaddy). DNS swap to Cloudflare pending.
- Logo confirmed: two variants received, will use the stacked variant (Image 2) cropped square to 1024x1024 for the Meta app icon.
- Pricing locked at $1200 ($600 upfront, $600 on Meta approval) vs $2500 standard rate.
- Pre-flight checklist still pending Nella's answers.

---

## Cost and scope (internal, do not send to Nella verbatim)

### State of the agreement so far

- Original scope: $2000 setup + $400/month management for building Mu AI on Coach Shaun's account
- Paid to date: $1600 (80% of setup)
- Outstanding on original setup: $400
- The bot is live, serving leads, that piece is delivered
- Most of the engineering work over the last few months has happened without written scope

### Why App Review is out of scope

The original $2000 covered "get Mu AI working for Coach Shaun." Meta App Review is the work that turns Mu AI from a single-coach implementation into something Nella can resell as a white-label SaaS. Specifically it unlocks:

- Direct Instagram API access instead of ManyChat as middleware
- Per-coach onboarding via Meta OAuth, not manual setup
- Inbound Visibility Phase 1 (the funnel Nella has been blocked on)
- Production posture good enough to onboard the clients she has waiting

This is a new phase of work, not a continuation of the original build.

### What I'm proposing

**Package: Phase 2 Setup at $2500**

Covers:
- Meta App Review (this plan, full execution)
- Business Verification support
- Privacy policy draft (lawyer review at Nella's discretion and cost)
- Domain DNS swap to Cloudflare
- Placeholder landing page at `getmu.co`
- Deauthorize callback and data deletion endpoints on the Worker
- Test Instagram account setup
- Screencasts and submission text
- App Review submission + one revision cycle if Meta requests changes
- Inbound Visibility Phase 1 integration after approval

Excludes:
- Lawyer fees for privacy policy review (Nella pays the lawyer directly)
- Domain renewal (already her cost)
- Stripe setup if/when billing goes live (separate phase)
- Additional revision cycles past one (rare, but possible)

Realistic effort: 25-40 hours over 4-8 weeks wall clock.

### Payment options to offer

- Full $2500 upfront, $400 outstanding rolled in (total invoice: $2900)
- 50/50 split: $1250 to start, $1250 on Meta approval
- $1500 to start with App Review only, add the Phase 1 integration as a separate $1000 piece after approval

### Things I will NOT do during this conversation

- Apologise for charging
- Drop the price because she's frustrated about delays caused by the original build
- Bundle in vague "support" or "anything you need" language; deliverables stay specific
- Promise an approval date (it's Meta's queue)

### Walk-away position

If Nella refuses to pay anything additional and insists this is part of the original scope: I should pause this work until written scope is in place. Continuing to build without scope is how I ended up here in the first place. Friction now is cheaper than resentment later.

---

## Order of operations (what comes first matters)

A lot of this work has dependencies. Doing it out of order means doing some pieces twice. The right sequence:

1. **Run the pre-flight checklist with Nella.** Find out what she already has vs what's still missing (business entity, website, registration docs, etc). This determines whether we're starting from zero or already halfway.
2. **Point the domain at Cloudflare.** Everything else needs URLs that resolve: privacy policy URL, webhook callback URL, OAuth redirect URL, deauthorize callback URL, data deletion request URL. None of those exist until the domain is live.
3. **Nella creates the new Business Portfolio.** She does this herself (it's tied to her Facebook identity). About 20 minutes.
4. **Nella submits Business Verification.** Needs the business documents. 1 to 3 business days for Meta to confirm.
5. **I create the Meta App** under her Business Portfolio, mark it as a Tech Provider, configure webhooks against our domain.
6. **I write the privacy policy** and we publish it at `getmu.co/privacy`.
7. **I build the deauthorize callback and data deletion endpoints** on the existing Worker.
8. **I set up a test Instagram account** for Meta's reviewer.
9. **I make at least one successful API call** (Meta requires this before they let you submit).
10. **I record the screencasts** for each permission, write the justifications.
11. **I submit App Review.**
12. **We respond to any reviewer requests** for changes.

Steps 1 and 2 can happen this week. Step 3 onwards depends on Nella being unblocked.

---

## Pre-flight checklist for Nella

Send this to Nella as a single message. Each question is yes/no/which. The point is to find out what she already has so I'm not asking her to redo things, and to find out what she doesn't have so we can start working on those in parallel.

> Quick checklist before we dive in. For each, just answer yes / no / not sure, and if yes can you send what you have.
>
> 1. Do you have a registered business entity for the white-label SaaS (Mu AI or whatever you're calling the company)? If yes, what's the legal name and where is it incorporated?
> 2. Do you have a business registration document or certificate of incorporation? PDF or photo is fine.
> 3. Do you have a business address (matches the registration document)?
> 4. Do you have a business phone number Meta can call or text to verify? Doesn't have to be a landline.
> 5. Do you have a business email (not a personal Gmail)?
> 6. Do you have a public website live for the business? Even a one-page landing site counts.
> 7. The domain you bought: what is it, and what registrar (GoDaddy, Namecheap, etc)?
> 8. Have you already created any Meta Business Portfolios in the past? Meta caps at 2 per personal Facebook account.
> 9. Do you have a logo or brand image we can use as the app icon? Needs to be 1024x1024 PNG, square.
> 10. Are you happy to be the Data Protection Officer named in the privacy policy, or is there someone else (lawyer, business partner)?

Until I have answers to these, I can't size the work or pick a start date.

### How to read the answers

| If she says... | What it means |
|---|---|
| No business entity yet | She has to register one first. This is a separate weeks-long task and blocks Business Verification entirely. Most likely a Cayman company since she's there, but could be UK or elsewhere. |
| Has entity, no documents | She needs to get the registration certificate from her formation agent or the Cayman registry. Usually a 5-minute email request. |
| Has documents, no business address | The registered office address from her formation agent works. |
| Has everything except website | This is the smallest gap. We can throw up a one-page placeholder at `getmu.co` using Cloudflare Pages in about an hour. Meta accepts placeholder sites for App Review as long as they're public and not 404. |
| Already used 2 Business Portfolios | Workaround: she creates the new one, then someone else (me, or her business partner) creates a third on their personal Facebook and transfers admin to her. Per Meta's own docs, you can administer up to 25 portfolios even if you can only create 2. |
| No logo | We can use a plain text-based icon for the first submission. Not pretty, but works. Replace with proper branding later. |

---

## The domain step (do this first or nothing else works)

She bought `getmu.co`. Assuming GoDaddy. We need this domain to:

- Serve the privacy policy at `getmu.co/privacy`
- Serve a placeholder landing page at `getmu.co` (Meta requires the app's website to be reachable)
- Eventually host the customer-facing dashboard
- Provide the OAuth redirect URL `getmu.co/auth/callback`
- Provide the deauthorize callback URL `getmu.co/auth/deauthorize`
- Provide the data deletion request URL `getmu.co/auth/data-deletion`

Right now none of those URLs resolve because the domain isn't connected to anything.

### Plan: delegate DNS from GoDaddy to Cloudflare

We do this so the domain is managed in the same Cloudflare account that already owns the Worker and Pages projects. Single dashboard, no second login.

Steps (high level, I'll write the detailed PowerShell or click-through guide once Nella sends me the GoDaddy account access):

1. **In Cloudflare**, add `getmu.co` as a new site (Free plan is fine for now). Cloudflare scans existing DNS records (probably empty or just default GoDaddy parking) and gives us two nameservers.
2. **In GoDaddy**, replace GoDaddy's nameservers with Cloudflare's. This is the "delegation" step. Propagation takes anywhere from 5 minutes to 24 hours, usually under an hour.
3. **In Cloudflare DNS**, add an A or CNAME record pointing the root domain (`getmu.co`) at the existing Pages project (`botos-platform-3ar.pages.dev`), or set up a new Pages project if we want the marketing/public-facing side separate from the dashboard.
4. **Set up the privacy policy as a static page** under the Pages project, at `/privacy`. I'll do this when I draft the policy.
5. **Enable SSL/TLS in Cloudflare** (Full mode, since Pages already serves HTTPS).
6. **Test all the URLs we'll need** before submitting App Review.

### What I need from Nella for this step

- Domain name (placeholder `getmu.co` in this doc, fill it in)
- Either: she gives me temp access to her GoDaddy account (less ideal, more access than needed)
- Or: she does the nameserver swap herself while I'm on a call with her (15 minutes, much cleaner)
- Confirmation she wants the public Mu AI marketing site and the dashboard on the same domain, or separate (e.g. `app.getmu.co` for the dashboard, root domain for marketing)

---

## Decision: which login path

Meta offers two paths for Instagram API access. We pick one.

### Option A: Instagram API with Instagram Login (going with this)

- End user logs into our app using their Instagram credentials directly
- Permissions are prefixed `instagram_business_*`
- Web-only at the moment (no native mobile app support). Fine, we are a web app
- Newer path, simpler onboarding flow

### Option B: Instagram API with Facebook Login for Business

- End user logs in via Facebook, then their connected Instagram account is accessible
- Permissions are prefixed `instagram_*` without `business_`
- Required if the customer's Instagram needs Page-level admin actions (we don't)

### Why A and not B

- A's `instagram_business_manage_messages` is the cleaner permission for our DM-only use case
- Future coaches Nella onboards may not have a Facebook Page connected; A works either way
- Smaller permission scope means faster review and less reviewer scrutiny

If Meta tells us during review we need to switch to B, we can. Starting on A is the right call.

---

## The permissions and features we are requesting

| Permission / Feature | What it lets the app do | Why we need it |
|---|---|---|
| `instagram_business_basic` | Read the connected Instagram account's username, ID, profile picture | Display sender info in the dashboard inbox, route messages to the right coach |
| `instagram_business_manage_messages` | Receive incoming DMs, send replies, mark as read | Core function: bot reads inbound DM, AI generates reply, app sends reply |
| `instagram_business_manage_comments` | Read new comments on the coach's posts, optionally reply, and trigger a DM to the commenter | Enables comment-to-DM automation. When a lead comments a keyword on Coach Shaun's post (e.g. "GOLF"), the bot DMs them. Closest sanctioned equivalent to a "new follower" trigger, which doesn't exist (see below) |
| `Human Agent` (feature) | Reply to a user up to 7 days after their last message | Lets the bot follow up at T+20h (our existing cron) without hitting the 24-hour wall. Auto-included with `instagram_business_manage_messages` |

Not requesting:
- `instagram_business_content_publish` (we don't post)
- `instagram_business_manage_insights` (we don't need follower analytics)

Bundling all three into one App Review pass saves a 2 to 4 week second submission later.

---

## What Meta does not offer

This section is here so I don't get asked again, and so Nella and Coach Shaun see it once instead of expecting features that don't exist.

### No "new follower" webhook exists

Meta does not provide a webhook event for new followers on Instagram Business accounts. Not something we forgot to request; it's a capability Meta doesn't expose to anyone through the official API.

Confirmation:

- Meta's official Instagram webhooks docs list the available fields: `comments`, `live_comments`, `messages`, `messaging_postbacks`, `messaging_seen`, `messaging_referral`, `messaging_optins`, `message_reactions`, `mentions`, `story_insights`. No follower event.
- Independent integration guides (Rollout, Phyllo, Zernio, Make community) confirm the same.

### Why other bot platforms appear to have it

ManyChat, MobileMonkey and similar do one of two things:

1. **Polling.** Periodically call follower-count endpoints and detect when the count goes up. Slow (1 to 5 min delay best case), lossy (miss anyone who follows and unfollows between polls), expensive on rate limits, doesn't reliably tell you WHO the new follower is. Instagram does not let you enumerate the followers list via API in a useful way.
2. **Unofficial scraping.** Use Instagram session cookies to scrape the followers UI. Violates Meta's Terms of Service. Accounts using this regularly get banned. Some white-label SaaS quietly relies on it and breaks when Instagram pushes UI changes.

Neither is a sound foundation for a production white-label going through proper App Review. We're not doing either.

### The sanctioned alternative: comment-to-DM

`instagram_business_manage_comments` gives us a real-time webhook on new comments. This is the legitimate equivalent of a "new follower" trigger, and arguably better:

- A new follower is a weak intent signal (people follow and forget)
- A commenter has explicitly raised their hand. Higher intent, higher conversion
- The comment text tells you the lead's stated interest, so we can route on it
- Once we reply (publicly or via private reply), the commenter enters a 24-hour DM window and is a functional lead in our existing pipeline

Pattern Coach Shaun will use: posts a CTA ("comment GOLF for my free swing guide"), bot DMs every commenter who uses the keyword, standard Mu AI funnel takes over.

### Other things Meta doesn't offer

- **No "unfollowed" webhook.** Same gap, same reasons.
- **No way to send unsolicited DMs.** The 24-hour rule is hard. A user must message us first (or comment on a post, which we can reply-to-DM as above) before we can DM them.
- **No way to read the full followers list via API.** Counts only, no enumeration.
- **No reliable Stories-watched webhook.** Story view events are not in the Instagram API.
- **No Reels engagement webhooks.** Comments on Reels fire `comments` like any other media, but saves and shares don't push.

---

## The two halves of App Review

People conflate these. They happen in sequence.

### Step 1: Business Verification (one-time, Business Portfolio level)

Meta confirms Nella's company is a real legal entity. Once done, every app under her Business Portfolio benefits.

Needs:
- Legal business name
- Business address (matching the registration document)
- Business registration document (certificate of incorporation, business license, or tax document)
- Business phone number
- Business website (must be live, not 404)
- Verification call/email/text from Meta to that phone or email

Timeline: 1 to 3 business days once submitted.

### Step 2: App Review (per-app, per-permission)

Meta confirms the specific Mu AI app uses each requested permission appropriately. Done per submission. Must be re-done if we add new permissions later.

Needs:
- Working privacy policy URL
- App icon (1024x1024 PNG)
- Detailed step-by-step instructions for Meta's reviewer
- Test credentials for the reviewer
- A screen recording for each permission requested
- Written justification for each permission
- At least one successful API call already logged

Timeline: 2 to 4 weeks for messaging permissions. Longer if reviewer requests revisions. Each revision resets the queue.

Both must pass before we can use the app in production with real users at scale.

---

## Who does what

### Nella does these herself (touches her Facebook/legal identity)

1. **Pre-flight checklist** (above). Answer the 10 questions so I know what we're working with.
2. **Domain DNS swap.** Either gives me access to her GoDaddy account, or does the nameserver swap on a call with me. 15 min.
3. **Create the new Business Portfolio** at business.facebook.com under her personal Facebook. 20 min.
4. **Submit Business Verification.** Upload her registration doc, address, phone, website, verify via the callback Meta picks. 30 min initial + waiting for Meta callback.
5. **Approve the app icon** I send her (if she has no logo, I make a placeholder; if she has one, we use it).
6. **Forward Meta's emails to me** so I know what verification status is and what App Review responses say.

### I do these (technical work)

1. **Set up Cloudflare for the domain** once nameservers are delegated. SSL, DNS records, Pages binding.
2. **Throw up a placeholder landing page** at `getmu.co` so it's not a 404 when Meta's reviewer visits.
3. **Privacy policy v1 draft.** I write it; Nella reviews; we publish at `getmu.co/privacy`.
4. **Create the Meta App** in App Dashboard. Type: Business. Use case: Other. Connect to Nella's Business Portfolio.
5. **Mark "Become a Tech Provider"** in the app settings. Required because we serve multiple businesses (white-label SaaS).
6. **Build the deauthorization callback endpoint** on the existing Cloudflare Worker. Meta calls this when a user removes our app. We have to handle removal cleanly (delete their tokens, mark them as deauthorized in our DB).
7. **Build the data deletion request endpoint** on the existing Worker. Meta calls this when a user requests their data be deleted. We have to actually delete it and return a confirmation URL.
8. **Configure webhooks** in the Meta App Dashboard. Callback URL: Worker's existing webhook endpoint. Verify token: a random secret stored as a Worker secret. Subscribe to: `messages`, `messaging_postbacks`, `messaging_seen`, `messaging_referral`, `comments`, `live_comments`.
9. **Set up the test Instagram account** for Meta's reviewer. Non-production IG Business account connected to a non-production FB Page. Document the login credentials.
10. **Make at least one successful API call** before submitting. Meta requires this. Easiest is calling `me` to fetch the test IG account's profile.
11. **Record the screencasts.** One per permission:
    - `instagram_business_basic`: show a user logging in, the app reading their profile, the username appearing in the dashboard
    - `instagram_business_manage_messages`: show a real DM coming in, bot replying, conversation appearing in the dashboard, optionally show the bot following up 20h later
    - `instagram_business_manage_comments`: show a post with a CTA, a test user commenting the keyword, webhook firing, bot DMing the commenter, conversation appearing in the dashboard
    - Each clip 1 to 3 minutes. UI in English (or with English captions).
12. **Write the permission justifications.** Drafts in Appendix B below; I'll polish before submission.
13. **Submit App Review.**
14. **Respond to any revision requests** from Meta's reviewers.

### Collaborative

- App icon design: if Nella has no logo, we either make one or use a text-only placeholder
- Privacy policy review: I draft, she reviews, optional lawyer pass before publishing
- App name decision: probably "Mu AI" but Nella has final say (it's her brand)

---

## Realistic timeline

Best case, nothing stalls:

- **This week**: Run pre-flight checklist with Nella. Get domain nameservers swapped to Cloudflare. Get placeholder landing page live. Confirm we have all the business documents we need.
- **Week 1 after Nella unblocks**: She creates Business Portfolio and submits Business Verification. I create the Meta app, build deauthorize/deletion endpoints, draft privacy policy.
- **Week 2**: Business Verification gets approved. I finish privacy policy, set up test account, record screencasts, write justifications. Submit for App Review.
- **Weeks 3 to 5**: Meta reviews. Possibly one revision cycle.
- **Week 6**: Approved. Switch app to Live mode. Begin Phase 1 Inbound Visibility integration.

Worst case: 8 to 12 weeks if Meta wants multiple revisions or denies an initial submission. We mitigate by being thorough on the first submission and having Coach Shaun's existing leads as the proof-of-value test scenarios in the screencasts.

If Nella doesn't have a registered business entity yet, add 2 to 6 weeks at the front of all of this for company formation.

---

## Common rejection reasons (avoid these)

From Meta's official "Common Mistakes" doc and 2026 community reports:

1. **Privacy policy missing required disclosures.** Must list every third party that processes user data. Ours: Anthropic, Supabase, Cloudflare, Make, ManyChat.
2. **Screencast doesn't clearly show the permission being used.** Reviewer must SEE the data being read or written, not just the app's UI in general.
3. **Test account login doesn't work.** Reviewer fails the login step and denies immediately.
4. **App not live enough for reviewer to test.** The hosted app at the URL must actually work. Our dashboard must be reachable and functional.
5. **Permission justification is vague.** "We need this to manage messages" is too generic. Specific use case required.
6. **Requesting permissions not actually used.** Don't ask for things we never call.
7. **Webhook callback URL not responding correctly to verification.** Meta tests the URL during setup; if it 500s, the submission can't proceed.

---

## Appendix A: Privacy policy outline

To be drafted as a separate document and published at `getmu.co/privacy`.

Sections it needs:

- Who we are (Nella's company + contact)
- What we collect:
  - From Instagram users who message a connected business: IG user ID, username, profile name (if public), message text, timestamps
  - From our customers (golf coaches, business owners): email, name, company name, billing info via Stripe (we don't store card numbers)
- How we use it:
  - Generate AI responses via Anthropic's Claude API
  - Store conversation history in Supabase
  - Route messages through Make.com and ManyChat
  - Analytics on response performance
- Who we share it with: Anthropic, Supabase, Cloudflare, Make, ManyChat, Stripe (if billing is live)
- Data retention period (TBD, depends on Nella's policy)
- User rights (access, correct, delete, export their data)
- International transfers (Cayman to US/EU processors)
- Contact for privacy questions: `privacy@getmu.co`
- Changes to this policy

Hosted URL must not 404, must not change after submission. If we change the URL later, App Review can fail.

---

## Appendix B: Permission justification drafts

These go into the App Review form. Polish before submission.

### Justification for `instagram_business_basic`

> Mu AI is an AI-powered customer engagement platform used by independent coaches and small business owners to manage Instagram DM conversations with their leads and clients at scale. This permission is required to retrieve basic metadata (username, user ID, profile picture) of the connected Instagram Business account so that we can:
>
> 1. Display the connected account in the customer's dashboard so they know which account is connected
> 2. Route incoming messages to the correct customer when one Mu AI instance serves multiple businesses
> 3. Show the connected business's branding in the conversation header of our agent inbox
>
> Without this permission, customers connecting their Instagram account would see no confirmation of which account is active, and we could not correctly route inbound messages.

### Justification for `instagram_business_manage_messages`

> Mu AI uses this permission to receive incoming Instagram Direct Messages on behalf of our customers (independent coaches and small businesses), and to reply to those messages on their behalf via AI-generated responses that the customer has pre-configured.
>
> Specifically:
>
> 1. We subscribe to the `messages` webhook to receive new inbound messages in real time.
> 2. Our AI engine, powered by Anthropic Claude, generates a contextually appropriate reply based on the customer's coaching style and the conversation history.
> 3. We send the reply via the Instagram Messaging API within the 24-hour user-initiated messaging window.
> 4. Where the customer has enabled automatic follow-up, we use the Human Agent feature to send a single reminder message up to 24 hours after the user's last reply.
>
> All conversations are visible to the customer in our dashboard so they can review, edit, or take over the conversation at any time. We do not initiate cold outreach. We only respond to users who have first messaged the customer's account.

### Justification for `instagram_business_manage_comments`

> Mu AI uses this permission to enable comment-to-DM automation, which is one of the primary ways our customers (coaches and small business owners) convert Instagram engagement into customer conversations.
>
> Specifically:
>
> 1. The customer publishes a post with a clear call-to-action that invites their audience to comment a keyword (for example, "Comment 'GOLF' below to get my free swing analysis guide").
> 2. We subscribe to the `comments` webhook to receive notifications when someone comments on the customer's media.
> 3. When a comment matches the configured keyword, our bot sends a direct message to the commenter containing the resource the customer offered, using the `instagram_business_manage_messages` permission. The commenter has explicitly opted in to this conversation by commenting the keyword.
> 4. The conversation then continues in the standard Mu AI inbox flow, with the AI handling subsequent replies on behalf of the customer.
>
> We do not reply publicly to the comment itself unless the customer explicitly configures that, and we do not store the contents of comments beyond what is needed to detect the keyword match and the public commenter identifier required to send the DM. We will not use this permission for moderation or for any purpose other than the opt-in comment-to-DM flow described above.

### Justification for Human Agent feature

> Mu AI is a customer engagement tool for coaches and small businesses where the business owner is acting as a human agent in the loop. The Human Agent feature is needed because:
>
> 1. Our customer can take over a conversation at any time and continue replying from the dashboard, which may be more than 24 hours after the user's last message.
> 2. Our automated follow-up (sent approximately 20-24 hours after the user's last message) is designed to re-engage leads who haven't replied, which falls within or near the 24-hour window edge and benefits from the extended messaging capability.

---

## Appendix C: Ongoing maintenance after approval

Once we're live, Meta requires us to:

- Keep the privacy policy URL working forever (can't change to a 404)
- Keep the deauthorize and data deletion endpoints working
- Honor data deletion requests within 30 days
- Re-do App Review if we add new permissions later
- Re-do Business Verification if we change business address or legal entity

---

## Appendix D: Items I'll need from Nella (once pre-flight is done)

Concrete final list. Some will be answered by the pre-flight; this is the consolidated version for once she's ready to actually submit Business Verification.

| Item | Why | Format |
|---|---|---|
| Business legal name | Business Verification, App Review | Exact name from registration |
| Business address | Business Verification | Street, city, postal, country |
| Business phone | Business Verification | Number Meta can call/text |
| Business email | App Review communications | Email she checks daily |
| Business website URL | App Review (must be live) | The `getmu.co` we're setting up |
| Business registration document | Business Verification | PDF or photo of certificate |
| Confirmation she's under the 2-portfolio Meta cap | Determines if she can create a new one | Yes/no |
| App icon, 1024x1024 PNG | App Settings | PNG file, square |
| App name | OAuth consent screen | Short text, probably "Mu AI" |
| Privacy policy hosting confirmation | App Review URL | Confirm `getmu.co/privacy` is where it'll live |

---

## Where I checked

Meta for Developers official docs: App Review for Instagram API, Create an App, Webhooks, Overview. Cross-referenced against 2026 integration guides (Rollout, Phyllo, Zernio, Make community) for current real-world timelines. Earlier "2 to 5 business days" estimate was for simpler permissions and got corrected to 2 to 4 weeks per submission for messaging.
