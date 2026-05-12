# BotOS / Mu - Claude Code Operating Manual

This file is auto-loaded by Claude Code at the start of every session in this repo. It encodes the rules that must apply across all sessions. Read PROGRESS.md immediately after this file for current state.

## About this project

BotOS / Mu is an AI sales bot platform serving Coach Shaun (Fairway Performance Golf) on Instagram DMs, with a setter-review inbox dashboard. Being prepped for white-label SaaS handover to Nella, who owns the production Cloudflare and Supabase accounts.

Source of truth for current state: PROGRESS.md at repo root. Always read it before substantive work.

Architecture overview: SYSTEM-AUDIT.md at repo root.

## About me, the user

I have zero coding experience. I run commands and click buttons. Claude designs, writes, decides the technical approach. I drive Make.com, Supabase Dashboard, Cloudflare via this terminal and PowerShell on Windows 11.

Repo location: C:\Users\Order Account\botos-platform

## Standing technical rules (do not violate, do not negotiate)

1. No em dashes anywhere in any output. Chat replies, files, commits, code, comments. Use commas, periods, colons, parentheses instead.
2. ctx.waitUntil stays fire-and-forget for Supabase writes in the Worker. Never switch to await. We tried; multi-hour silent outage.
3. Staging deploys before production. Always, including small changes.
4. PROGRESS.md is the single source of truth. Update at end of every session.
5. No secrets in chat. Use environment variables. wrangler secret put for Worker, Cloudflare Pages UI for dashboard env vars.
6. Do not auto-modify Make.com scenarios without showing the blueprint first. Use _get and _validate before any _update or _create.
7. Always check the current state of files in the repo before editing. Drift is the enemy of safe patches.
8. Worker never returns messages back to Make Scenario 1. Auto-send goes Worker to Scenario 2 direct. Manual approval goes Inbox button to Scenario 2.

## Workflow for any technical change

Step 0: read project knowledge (PROGRESS.md, relevant files) to understand current state.
Step 1: clarify scope if anything is ambiguous.
Step 2: design, explain the plan in plain language.
Step 3: build, write the code or blueprint changes.
Step 4: dry-run or validate without applying.
Step 5: I confirm to apply.
Step 6: verify with synthetic test against staging, then production.
Step 7: commit and push with a substantive commit message.
Step 8: update PROGRESS.md at session end.

## How to communicate with me

- Be direct. Skip filler politeness.
- Push back once clearly when you disagree, then execute what I confirm.
- When uncertain, say so. Do not invent. Search docs, web, or the codebase.
- When I am tired or moving fast and you spot a risk, flag it once and drop it after acknowledgement.
- Do not repeat yourself. Make a point, move on.

## Commit messages

Substantive. What changed, why, verification done, version IDs where applicable. For multi-line commit messages on Windows PowerShell, write the message to a temp file and use `git commit --file=`. The PowerShell `-m` tokenizer mangles multi-line strings with special characters.

## Repository structure

- /sales-bot           Cloudflare Worker source. The bot.
- /dashboard           React + Vite frontend. The setter inbox.
- /db                  Supabase schema and migrations.
- /docs                Documentation, runbooks.
- PROGRESS.md          Single source of truth for state.
- SYSTEM-AUDIT.md      Comprehensive system audit.

## Known deferred items (low priority but real)

- sales-bot/node_modules/.cache/wrangler/wrangler-account.json is tracked by git. Should be untracked, history audited for any committed OAuth secrets.
- Pre-existing em-dash count in sales-bot/src/index.js is 23, all in strings and comments. sanitizeBotMessage strips them from outbound replies, so leads see clean text. Code-hygiene only.

## Tools available in this session

- Direct file read and edit via the local filesystem.
- git, npm, python, node already on PATH.
- Cloudflare wrangler CLI available via npx.
- Browser-based logins for Supabase, Cloudflare, Make.com when needed.

## What NOT to do without explicit instruction

- Do not modify production env vars.
- Do not deploy to production Cloudflare Workers or Pages.
- Do not apply Supabase migrations to production.
- Do not modify Make.com scenarios.
- Do not delete files from the repo.
- Do not commit and push without showing me the diff and the commit message first.

For any of the above, present the proposed change, wait for my confirmation, then proceed.