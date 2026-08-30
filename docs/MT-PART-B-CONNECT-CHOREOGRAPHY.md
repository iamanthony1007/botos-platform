# Part B: Nella's Instagram Connect, the Choreography

For Anthony's call with Nella. Everything before "The call" is already done
and verified as of 2026-08-30 morning. Committed before pasting, standing
rule.

## State going in

- Tenant seeded on production: org and bot "Nella's bot"
  (`...00e0` / `...00e1`), auto_send false, stage_automation `{}`, scaffold
  prompt (placeholder, see The prompt below), zero conversations, zero
  reviews. Seed: `db/seeds/nella_tenant_2026-08-30.sql`, all three pastes
  verified.
- Her account: `ornellakuate@gmail.com` (REVISED 2026-08-30, second ruling):
  role admin, org `...00e0`, bot `...00e1`, permissions inbox + connections.
  This is her pre-existing April account with a password she already knows,
  REPOINTED off the Bombers tenant onto hers (SELECT before and after
  verified; it was client on Bombers, the cross-tenant view she keeps via her
  superadmin login). The proton.me account from the first ruling was created,
  verified 11/11 including both-sides isolation probes, then DELETED when
  email delivery friction made the pre-built-account path more trouble than
  the repoint; the isolation probes' findings hold for this account because
  they test the profile shape (admin, org e0, bot e1), which is identical.
- The connect path is tenant-gated end to end: /meta/oauth/init requires her
  JWT and refuses any bot outside her tenant, /meta/oauth/start takes only
  the single-use token init mints.

## THE ONE RULE THAT CANNOT BE BROKEN ON THE CALL

**The connect happens from `ornellakuate@gmail.com`, never from her
superadmin login (nellakuate@gmail.com).** Her superadmin account resolves to
the BOMBERS bot in the UI (assigned_bot_id fallthrough, D1), so a connect
clicked from that session would attach her Instagram to Coach Shaun's tenant.
The ornellakuate account now resolves to "Nella's bot" and can reach nothing
else. The two addresses differ by one letter; check which is signed in before
she clicks anything, and sign out the wrong one first.

## Before the call (Anthony, five minutes)

1. She logs in at getmu.co as ornellakuate@gmail.com with her existing
   password (Forgot password on getmu.co works normally for gmail if needed).
2. Expect a mostly empty dashboard for her tenant, and a Connections page
   showing "Nella's bot" with Instagram NOT CONNECTED. If Connections shows
   anything else (especially Bombers content), stop: wrong account signed in.
3. Have your own superadmin session open in a second browser for the
   verification reads after her click.

## The call

1. She logs in at getmu.co as `ornellakuate@gmail.com` on her own machine.
2. Connections page, Connect Instagram. A new tab opens on Instagram's
   consent screen via the init handshake (her session mints the single-use
   URL; nobody pastes URLs by hand).
3. She logs into HER OWN Instagram (the business account being connected) and
   approves. Advanced Access means her account needs no app role.
4. The success page says the window can be closed. She closes it, returns to
   Connections, clicks Refresh status. Expect CONNECTED with her Instagram
   username.

## Say to her plainly, on the call, before any real lead

- **The 24-hour reply window applies to her account.** Human Agent is not
  approved yet, so replies to a lead more than 24 hours after their last
  message will not deliver. Until that approval lands, her inbox is a
  same-day tool.
- **Nothing sends automatically.** Every reply is drafted for review and a
  human approves each send. (auto_send is off and stage automation is empty,
  verified in the seed.)
- **The bot's brain is a placeholder.** The prompt is the generic scaffold;
  it must not face real leads until her business content is loaded (see The
  prompt below).

## Verify after her click (Anthony)

1. SQL editor, read-only, breadcrumb Mu AI PRODUCTION:

```sql
select platform, bot_id, account_username, deauthorized, created_at,
       length(external_account_id) as ext_id_len
from public.connected_accounts
where bot_id = '00000000-0000-0000-0000-0000000000e1';
```

Expect one row: platform instagram_api, deauthorized false, her username,
ext_id_len around 17 (the 1784-form id). The token column is deliberately not
selected; never select it.

2. Send a test DM from a test Instagram account to her connected account.
   Expect, within a minute: profile fetch fires on first inbound (username
   and profile_name populate), a conversation lands with bot_id `...00e1`,
   and a pending review appears in HER inbox.
3. The live cross-tenant proof with real data: from a Bombers-tenant session
   (austinewebdev), confirm the new conversation is invisible. From her
   session, confirm the Bombers inbox remains invisible. This is the matrix's
   both-sides check running on real traffic for the first time.

## The prompt, product setup after the connect

The scaffold currently on the bot names a generic demo coaching business.
Before any real lead flows: Anthony collects her actual positioning (offer,
ICP, pain points, qualification rules, booking flow) and loads it via the
Prompt Editor from her admin account or his. Track as its own product-setup
item; it is not a platform task.

## If anything goes wrong on the call

- Connect button errors or 403s: she is in the wrong account, or her session
  expired. Sign out, sign back in as the proton address.
- Consent screen approves but Refresh status shows NOT CONNECTED: check the
  connected_accounts select above; if no row landed, the callback failed and
  the Worker logs (wrangler tail) say why. Do not retry blindly; read first.
- Anything unexpected in her inbox: nothing can send without a human approve,
  so there is no runaway risk. Read, then decide.
