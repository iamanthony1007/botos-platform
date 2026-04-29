# Mu AI — Architecture Overview

This document describes how the Mu AI sales bot platform is built and how messages flow through it. Read this first if you're new to the codebase. For deployment instructions see DEPLOYMENT.md. For database schema see DATABASE.md.

---

## What Mu AI is

Mu AI is a multi-tenant AI sales bot platform. Each business owner ("client") gets their own bot configured with their voice, sales psychology, and product knowledge. The platform handles inbound DMs from social platforms (currently Instagram via ManyChat), generates AI replies that match the client's style, lets human setters review/approve those replies, and books calls.

The platform is multi-tenant: every record in every table is scoped by `bot_id`. Coach Shaun's bot and the next client's bot live in the same database and run on the same Worker, just with different configurations.

The product differentiator is intentional: this is not a chatbot. It is a virtual sales rep that converts. The setter corrections, learning log, stage classification, and intent scoring are not "features" — they are how the system mimics a top human sales rep.

---

## System diagram (text version)

```
┌──────────────────┐
│   Instagram DM   │
│   (lead types)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    ManyChat      │  Owns the platform integration with Meta.
│  (per client)    │  Runs welcome flows, captures keywords, handles
└────────┬─────────┘  delivery in both directions.
         │
         ▼
┌──────────────────┐
│  Make.com        │  Glue layer. Two scenarios per client:
│  Scenario 1      │   1. Inbound: ManyChat → Worker
│  Scenario 2      │   2. Outbound: Worker → ManyChat (delivery)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Cloudflare       │  The brain. Handles:
│ Worker           │  - Lookup conversation state
│ (sales-bot)      │  - Build memory + context
└────────┬─────────┘  - Call Claude API
         │            - Store reviews
         ▼            - Trigger AUTO_SEND or wait for human
┌──────────────────┐
│  Anthropic API   │  Claude generates the reply with stage,
│  (Claude)        │  intent, and confidence classification.
└──────────────────┘

Parallel:
┌──────────────────┐
│   Supabase       │  Single source of truth.
│   (Postgres)     │  Conversations, reviews, learnings, audit log.
└──────────────────┘
         │
         ▼
┌──────────────────┐
│ Cloudflare Pages │  React dashboard for setters & owner.
│ (dashboard)      │  Shows leads, review queue, analytics, settings.
└──────────────────┘
```

---

## Components

### 1. ManyChat
- Owns the relationship with Meta (Instagram/Facebook)
- Each client has their own ManyChat workspace
- Runs the "new follower" welcome flow before Mu AI is ever involved
- Captures lead keywords ("bomber", "hipflow") and short-answer triggers
- Receives outbound messages from the Worker (via Make Scenario 2) and delivers to the lead

**Why ManyChat as middleware:** Meta App Review for direct integration takes weeks and requires a formal business entity. Until Mu AI passes Meta App Review, ManyChat is the bridge.

### 2. Make.com (two scenarios per client)
- **Scenario 1: ManyChat → Worker** — When a lead messages the client on Instagram, ManyChat fires a webhook to Make. Make formats the payload and POSTs to the Worker's `/webhook` endpoint. Single module: pass through.
- **Scenario 2: Worker → ManyChat** — When the Worker has a reply to deliver (either AUTO_SEND from the AI or manual approval from a setter), it POSTs directly to Make Scenario 2's webhook. Make then calls ManyChat's API to deliver the message to the lead.

**Important:** Scenario 1 does NOT receive the bot's reply back. The Worker calls Scenario 2 directly. This was designed to prevent a race condition where Scenario 1 timing out would lose replies.

### 3. Cloudflare Worker (`sales-bot/src/index.js`)
The brain of the system. Single-file JavaScript, ~1700 lines. Deployed via Wrangler to `https://sales-bot.nellakuate.workers.dev`.

Responsibilities:
- Receive inbound webhook from Make Scenario 1
- Sanitize the payload (strip ManyChat placeholders, sentinel values)
- Look up the conversation in Supabase + KV cache (KV is fast, Supabase is canonical)
- Build memory: prior messages, profile facts, running summary, learnings
- Inject context: re-engagement context (Bug 7), welcome flow context, campaign config
- Call Claude API with the system prompt + memory
- Apply post-Claude overrides (stage restoration, BOOKED auto-promotion)
- Decide next action: AUTO_SEND, REVIEW_QUEUE, or ESCALATE
- Either send to Make Scenario 2 (auto) or insert review row for setter approval
- Update conversations + KV memory

Key dependencies:
- Anthropic API (Claude)
- Supabase REST API (using `SUPABASE_SERVICE_KEY`, bypasses RLS)
- Cloudflare KV (`MEMORY_STORE`) for fast memory cache

### 4. Supabase (Postgres + RLS + Realtime)
The single source of truth. Hosted at `rydkwsjwlgnivlwlvqku.supabase.co`.

Core tables (full details in DATABASE.md):
- `bots` — per-client config (system prompt, model, intent definitions, welcome context)
- `conversations` — one row per lead, includes messages JSONB, stage, intent, status
- `reviews` — one row per AI reply (pending / approved / edited / auto_sent / discarded)
- `learnings` — setter corrections that train the bot
- `audit_log` — append-only log of identity edits
- `reconciliation_queue` — data integrity issues that need human review

RLS pattern: all tables have RLS enabled. Authenticated users (logged into the dashboard) can read/write everything. The Worker uses `SUPABASE_SERVICE_KEY` which bypasses RLS for backend access.

### 5. Cloudflare Pages — Dashboard (`dashboard/`)
React app deployed to `https://botos-platform-3ar.pages.dev`. Built with Vite + Tailwind.

Pages:
- **Dashboard** — overview, stats, Closest to Booking, recent activity
- **Inbox** — review queue, full thread view, approve/edit/discard actions
- **Analytics** — conversion funnel, intent distribution, stage breakdowns
- **Settings** — bot config, AI behavior settings, learnings management
- **Tester** — Conversation Simulator for prompt testing
- **Reconciliation** (planned) — data integrity queue

The dashboard reads/writes Supabase directly using the anon key + authenticated user session.

### 6. Anthropic Claude API
External service. The Worker calls it with the bot's system prompt + the lead's message thread + injected context. Claude returns a JSON response with the reply, stage classification, intent, and metadata.

---

## How a message flows through the system

End-to-end trace of a single lead message:

1. **Lead** types "workouts" in Instagram DM to Coach Shaun
2. **ManyChat** receives the DM via Meta. Their welcome flow (if active) might intercept and ask follow-up questions; if the user has already passed welcome, ManyChat fires the inbound webhook.
3. **Make Scenario 1** receives the webhook, formats the payload, POSTs to `https://sales-bot.nellakuate.workers.dev/webhook`
4. **Worker** receives the POST:
   - Sanitizes fields (strip placeholders)
   - Looks up bot config from `bots` table (system_prompt, model, welcome_context, etc.)
   - Reads memory from KV cache; if KV miss, rehydrates from Supabase `conversations.messages` (Bug 6 fix)
   - Builds memory object: messages + profile + summary + learnings
   - Detects re-engagement context (Bug 7): if lead was at SCHEDULE before going silent, prepares to restore
   - Detects welcome context: if conversation has ≤ 3 messages, injects bot's `welcome_context`
5. **Worker → Claude API** call with full system prompt + memory
6. **Claude** returns: `{ reply, conversation_stage, lead_intent, confidence, internal_notes, ... }`
7. **Worker** applies overrides:
   - Bug 7 stage restoration (if re-engaging, force pre_followup_stage)
   - BOOKED auto-promotion (if reply contains form.jotform.com, force BOOKED + HIGH)
8. **Worker** decides next_action:
   - If `auto_send_enabled = true` AND confidence is high AND stage is early → **AUTO_SEND**
   - Otherwise → **REVIEW_QUEUE** (insert row in `reviews` for setter)
9. **AUTO_SEND path**: Worker calls Make Scenario 2 directly with the messages array. Make → ManyChat → lead receives reply.
10. **REVIEW_QUEUE path**: Worker inserts a `reviews` row with status='pending'. Setter sees it in the dashboard Inbox. Setter approves/edits/discards. On approve, dashboard calls Make Scenario 2 directly to deliver.
11. **Worker** updates `conversations.messages` with the new exchange, updates KV memory, returns response to Make Scenario 1 (which doesn't act on it for actual delivery — Scenario 1 is just the inbound trigger).

End to end: ~2-5 seconds typical, depending on Claude API latency.

---

## Multi-tenancy model

Every record is scoped by `bot_id`. The Worker reads `BOT_ID` from environment variables (currently hardcoded to Coach Shaun's UUID). When client #2 is onboarded, options are:
- Run a separate Worker instance per client (one Cloudflare Worker per `bot_id`)
- Or: derive `bot_id` from the inbound webhook (e.g., from a header or path) so one Worker serves all clients

**Current setup is single-tenant Worker** — Coach Shaun's `BOT_ID` is hardcoded. Adding client #2 will require either a separate Worker OR refactoring to pull `bot_id` from the request. To be decided when client #2 onboards.

The dashboard already supports multiple bots per user — bot selector in the header. Database is fully multi-tenant. The only single-tenancy is at the Worker level, and that's a 30-minute refactor when the time comes.

---

## Trust boundaries and security

- **`SUPABASE_SERVICE_KEY`**: only in the Worker environment variables. NEVER in the dashboard. The service key bypasses RLS.
- **`SUPABASE_ANON_KEY`**: in the dashboard, exposed in the bundled JS. RLS policies are the security layer here.
- **`ANTHROPIC_API_KEY`**: only in the Worker environment variables. The dashboard never calls Claude directly.
- **`MAKE_WEBHOOK_URL`**: hardcoded in both Worker and Inbox.jsx. Public-ish (not a secret), but should not be shared casually.
- **Cloudflare KV (`MEMORY_STORE`)**: not exposed externally. Only the Worker reads/writes it.

---

## Where the code lives

```
botos-platform/
├── sales-bot/                  Cloudflare Worker (the bot brain)
│   ├── src/
│   │   └── index.js            ~1700 lines, all Worker logic
│   ├── wrangler.toml           Cloudflare config
│   └── package.json
│
├── dashboard/                  React dashboard
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Inbox.jsx       Setter review interface
│   │   │   ├── Analytics.jsx
│   │   │   ├── Settings.jsx
│   │   │   ├── Tester.jsx      Conversation Simulator
│   │   │   └── (Reconciliation.jsx — planned)
│   │   ├── components/
│   │   │   └── Layout.jsx      Sidebar, header, bot selector
│   │   └── lib/
│   │       ├── supabase.js     Supabase client config
│   │       ├── AuthContext.jsx
│   │       └── DataCache.jsx
│   ├── public/
│   ├── vite.config.js
│   └── package.json
│
├── migrations/                 (informal — Supabase SQL files)
│
├── ARCHITECTURE.md             this document
├── DEPLOYMENT.md               (todo)
├── DATABASE.md                 (todo)
└── README.md
```
