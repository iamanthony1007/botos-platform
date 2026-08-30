# Multi-Tenancy Phase 1: Phase 0 State Refresh

Read-only. No application code changed, no SQL executed against either
environment. Produced on branch `feat/mt-phase-1-rls-v2`.

Date: 2026-08-28. Supersedes nothing: it sits alongside
`docs/MULTI-TENANCY-PHASE-0.md` (2026-08-07, branch `docs/mt-phase-0`, still
unmerged) and records only what changed, what the briefing got wrong, and what
must be read live before the migration is designed.

Method: direct reads of `db/migrations/*`, `db/schema.sql`, `dashboard/src`
(every page), `sales-bot/src/index.js`, `sales-bot/wrangler.toml`, and the
`feat/mt-phase-1-rls` draft, plus git history across all branches.

---

## 0. Bottom line

Five things changed the design since the draft was written. Each is expanded
below.

1. **The draft is 20 days old, not months.** It was committed 2026-08-08 02:40.
   Migrations 012, 013 and 014 landed after it. It is stale in specific,
   enumerable ways, not rotten.
2. **The draft's Part 1a is probably already done, by hand, differently.** It
   creates a "Bombers Blueprint" organization because at the time Bombers sat
   under the platform org. The briefing now lists Bombers Blueprint, SuperYOU
   and Mu AI Demo as existing orgs. If that is right, running 1a as written
   creates a SECOND, duplicate Bombers org and repoints the bot into it. This is
   the single most dangerous stale line in the file.
3. **`waitlist_applications` must come OUT of the draft's target list.**
   Migration 014 revoked the `authenticated` table grant, which is a harder deny
   than any policy. The draft drops the 010 policies and creates admin-scoped
   ones that are inert behind the revoke, and dropping them silently breaks the
   documented `014_rollback.sql` contract.
4. **`invites` is the hole nobody is looking at.** The draft deliberately
   excludes it. `AcceptInvite.jsx` reads it as **anon**, before sign-in, and an
   invite row carries a bearer token plus the `role` and `assigned_bot_id` it
   stamps onto a new profile. Combined with the recorded "auth signup is open"
   finding, this is a plausible tenant-and-role escalation path. It needs a
   decision, not silence.
5. **The draft is one `begin; ... commit;` transaction.** The briefing (4.4)
   requires numbered idempotent chunks with verification SELECTs between,
   because the browser SQL editor is not trusted to be atomic. These are
   mutually exclusive shapes. The chunked form wins, but note what is lost: the
   draft's abort-on-null-org gate only works inside a transaction. Section 5
   replaces it.

Nothing here is blocking. The design can proceed as soon as Anthony pastes back
Section 3.

---

## 1. Corrections to the briefing's stated premises

The briefing says to verify rather than trust it. Here is that verification.
"Repo" means confirmed from source in this session. "Live" means it can only be
settled by Section 3.

| Briefing claim | Status | What I found |
|---|---|---|
| Branch `feat/mt-phase-1-rls` exists with the 011 draft | CONFIRMED (repo) | Single commit `88ce73b`, 2026-08-08. Two files, 500 lines: `011_tenant_rls_policies.sql` and `011_rollback.sql`. Nothing else. |
| "Months passed since the draft" | WRONG (repo) | 20 days. Draft 2026-08-08, today 2026-08-28. The intervening migrations are 012, 013, 014. |
| Production RLS permissive `USING (true)` on core tables | CONFIRMED as of 2026-08-07 (live), needs re-read | The 2026-08-07 query returned `USING (true)` for `authenticated` on 12 tables. Three weeks and three migrations later this is a stale snapshot. Re-read it. |
| `conversation_examples` is the one correctly-scoped table | CONFIRMED (repo) | The rollback file reconstructs its two original scoped policies, which is the best record we have of the pre-011 shape. |
| `connected_accounts` restrictive since 009 | CONFIRMED (repo) | `009:44` enables RLS, no policy, grant deliberately left intact. PROGRESS records the empirical proof: HTTP 200 with zero rows. |
| `data_deletion_requests` and `waitlist_applications` deny via revokes | CONFIRMED (repo + recorded live probe) | 012 revokes anon and authenticated. 014 revokes authenticated on waitlist. PROGRESS records both returning 403 permission denied on production. |
| Migration 014 is applied to production | PARTLY (recorded) | Its EFFECT is live (Anthony ran the revoke out of band 2026-08-19). The FILE has never been executed. Bookkeeping step, still outstanding. Fold it into this phase's chunk list. |
| Every production profile has `organization_id = null` | STALE, must re-read | True on 2026-08-07. Since then a demo tenant was created (org `...00d0`, bot `...00d1`) with a reviewer profile, and the briefing itself now describes three orgs. Section 3 Block C settles it. |
| Orgs and bots: Bombers Blueprint, SuperYOU, Mu AI Demo | CANNOT CONFIRM (live) | The repo only evidences the demo tenant (`db/seeds/demo_tenant_2026-08-19.sql`). The draft asserts Bombers was under the platform org `...0001`. These two statements disagree. Block D settles it, and it gates draft Part 1a. |
| Eight or nine profiles including two reviewer accounts | CANNOT CONFIRM (live) | Block C. |
| Staging RLS is OFF on the dashboard tables | CONFIRMED (repo) | `003` disables it on all 13. The header records why: Supabase enabled RLS by default with zero policies, and every dashboard query returned PGRST116. |
| Staging grants rebuilt as named-table grants after a blanket revoke | CONFIRMED (recorded) | PROGRESS: grants found stripped on every table, restored by Anthony, root cause never established, predates the branch. Treat staging grants as untrusted until Block B is pasted. |
| The Worker uses the service key and bypasses RLS | CONFIRMED (repo) | Every Worker PostgREST call sends `SUPABASE_SERVICE_KEY`. The one exception is `verifyDashboardJwt` (`index.js:5205`), which uses the ANON key purely to validate a user JWT against `/auth/v1/user`. That call reads no tables, so RLS does not touch it. |
| `/meta/send` and `/meta/connection-status` verify a JWT but not tenant | CONFIRMED (repo) | See Section 7. The code says so in its own comments. |
| The browser SQL editor is not reliably atomic | ACCEPTED as a constraint | Not independently verified. Designing for it costs little and the draft's all-or-nothing shape is the riskier bet. |

### Two open questions from the 2026-08-07 audit, now closed

**O-1 CLOSED: `sales-bot/src/index.js` is NOT a build artifact.** It is the
hand-authored source. `wrangler.toml:5` sets `main = "src/index.js"`, and
`package.json` has no build script (`deploy` is a bare `wrangler deploy`). The
38 `__name(...)` / `@__PURE__` markers are inert paste-in residue. **Editing
`src/index.js` directly is safe**, which unblocks the Section 7 work.

**O-2 STILL OPEN: `SYSTEM-AUDIT.md` does not exist.** `git log --all` finds it
in no branch and no commit. `CLAUDE.md` names it as the architecture overview
and instructs reading it. That instruction cannot be followed. Either the file
is unadded on Anthony's machine, or `CLAUDE.md` should point at
`ARCHITECTURE.md` (which does exist) plus these two Phase 0 documents.

---

## 2. Table inventory, and the diff against the draft's 13

### What the repo says exists

| Table | Created by | In draft's target list? | Decision |
|---|---|---|---|
| conversations | schema.sql | yes | keep, bot-scoped |
| reviews | schema.sql | yes | keep, bot-scoped |
| learnings | schema.sql | yes | keep, bot-scoped |
| bot_documents | schema.sql | yes | keep, bot-scoped |
| bots | schema.sql | yes | keep, scoped on `id` |
| organizations | 002 | yes | keep |
| profiles | 002 | yes | keep, the recursion-sensitive one |
| coach_flag_reasons | 002 | yes | keep, bot-scoped |
| prompt_versions | 002 | yes | keep, bot-scoped |
| conversation_examples | 002 | yes | keep, rewrite onto helpers |
| reconciliation_queue | 002 | yes | keep, bot-scoped |
| audit_log | 002 | yes | keep, admin read only |
| **invites** | 002 | **NO, excluded** | **DECISION REQUIRED, see Section 8.1** |
| **connected_accounts** | 009 | no | **Covered. Leave untouched.** RLS on, no policy, grant intact. Proven denying. Touching it risks the token store for zero gain. |
| **waitlist_applications** | 010 | **yes** | **REMOVE from the list, see Section 8.2** |
| **data_deletion_requests** | 012 | no | **Covered. Leave untouched.** RLS on, no policy, plus revokes from anon and authenticated. Proven 403. |

The draft's list is 13 entries, but it is not the same 13 as migration 003's 13
core tables: the draft swaps `invites` out and `waitlist_applications` in. That
substitution is now wrong in both directions.

Net: the target list should become **12 tables** (the draft's 13 minus
`waitlist_applications`), with `invites` as a live decision that could make it
13 again.

### What only the live databases can say

The repo cannot prove no table was created out of band. Migration 014's effect
reached production by hand before its file existed, so out-of-band DDL is a
demonstrated pattern here, not a hypothetical. Block A enumerates for real.

---

## 3. The SQL Anthony must run

Run every block in **both** SQL editors and paste all output back. Production is
`rydkwsjwlgnivlwlvqku`. Staging is `hlpucysbaqerhwahfolg`. **All of this is
read-only.** Nothing below writes, alters or drops anything.

Note on why this is manual: the Supabase MCP server connected to this session
authenticates to an unrelated account (one project, "Criteris"). It cannot see
either of our projects, so there is no shortcut. PostgREST cannot read the
system catalogs, so the SQL editor is the only route.

### Block A: every table, its RLS flag, and its policy count

```sql
select
  c.relname                     as table_name,
  c.relrowsecurity              as rls_enabled,
  c.relforcerowsecurity         as rls_forced,
  count(p.polname)              as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by 1,2,3
order by 1;
```

Expected on production: the 12 core tables plus `invites`,
`connected_accounts`, `waitlist_applications`, `data_deletion_requests`, and
nothing else. **Any table in this output not in Section 2's list is an
out-of-band creation and needs its own decision before the migration ships.**

### Block B: every policy, in full, plus the table grants

```sql
select
  c.relname as table_name,
  p.polname as policy_name,
  p.polcmd  as cmd,
  case p.polpermissive when true then 'PERMISSIVE' else 'RESTRICTIVE' end as kind,
  pg_get_expr(p.polqual, p.polrelid)      as using_expr,
  pg_get_expr(p.polwithcheck, p.polrelid) as check_expr,
  array(select rolname from pg_roles where oid = any(p.polroles)) as roles
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
order by c.relname, p.polname;
```

```sql
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
group by 1,2
order by 1,2;
```

**The grants query is the one that matters most on staging**, given the
unexplained stripping. A policy is irrelevant if the grant underneath it is
missing: Postgres checks the grant first. That is exactly why the 014 revoke
works without dropping the 010 policies.

### Block C: every profile, for the backfill map

```sql
select
  p.id,
  p.email,
  p.role,
  p.disabled,
  p.organization_id,
  o.name as org_name,
  p.assigned_bot_id,
  b.name as bot_name,
  b.organization_id as bot_org_id,
  p.permissions,
  p.created_at
from public.profiles p
left join public.organizations o on o.id = p.organization_id
left join public.bots b on b.id = p.assigned_bot_id
order by p.role, p.created_at;
```

This single query produces the whole backfill map: for every profile it shows
what its org is now and what its assigned bot's org is, which is the value the
backfill would copy. **Read the `disabled` column carefully.** The briefing says
verify "zero nulls remain among active accounts"; disabled rows are not active
and must not be allowed to abort the migration.

### Block D: orgs and bots, and the SuperYOU question

```sql
select o.id as org_id, o.name as org_name, o.created_at,
       b.id as bot_id, b.name as bot_name,
       b.auto_send_enabled, b.stage_automation,
       (b.system_prompt is null or length(btrim(b.system_prompt)) = 0) as prompt_empty,
       length(b.system_prompt) as prompt_len
from public.organizations o
full outer join public.bots b on b.organization_id = o.id
order by o.name nulls last, b.name nulls last;
```

`full outer join` on purpose: it surfaces an org with no bot AND a bot with no
org. Both are real hazards here (see Section 6.2).

This answers briefing item 3.4 directly: whether a Bombers Blueprint org already
exists (which decides the fate of draft Part 1a), what the SuperYOU bot id is,
and whether its prompt is a placeholder.

### Block E: the recursion and helper preflight

```sql
select p.proname, p.prosecdef as security_definer, p.provolatile as volatility,
       p.proconfig, pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('auth_is_superadmin','auth_is_admin_or_above','auth_org_id','auth_bot_ids');
```

Expect zero rows on both. A non-empty result means a previous attempt left
functions behind and the migration must drop them explicitly rather than rely on
`create or replace` (which would silently keep a wrong owner or search_path).

### Block F: does anything else use anon or a user JWT

```sql
select rolname, rolbypassrls, rolcanlogin
from pg_roles
where rolname in ('anon','authenticated','service_role','authenticator','postgres');
```

Confirms `service_role` really has `rolbypassrls = true` on both projects. The
draft asserts this was "verified on production". It is the assumption the entire
"this does not touch the Worker" claim rests on, so re-verify it rather than
inherit it.

---

## 4. The 011 draft, line by line: what survives

### Survives unchanged (the good bones)

- **The four helper functions.** `stable`, `security definer`,
  `set search_path = public`, `revoke ... from public` then `grant ... to
  authenticated`. This is the correct shape and the reasoning in the comment is
  right: an inline `profiles` subquery inside another table's policy recurses
  once `profiles` itself is locked down. Keep all four verbatim.
- **The drop-by-iteration approach.** Enumerating `pg_policy` and dropping every
  policy on a target table, rather than dropping a hardcoded name list. The
  comment nails why: policies are OR'd, so one surviving `USING (true)` defeats
  every restrictive policy beside it, and a name typo is exactly how that
  happens. Keep it, and it is what makes the chunked rewrite idempotent.
- **The bot-scoped policy bodies** for conversations, reviews, learnings,
  bot_documents, prompt_versions, reconciliation_queue, coach_flag_reasons,
  conversation_examples. `bot_id in (select public.auth_bot_ids())` with
  `WITH CHECK` mirroring `USING` on every UPDATE so a row cannot be moved to
  another tenant. Verified against Section 6: the command sets match what the
  dashboard actually does.
- **`bots` scoped on `id` rather than `bot_id`.** Correct, and the comment
  honestly records the consequence: RLS stops being what prevents a setter
  editing a bot, leaving only client-side permission gates. That is an in-tenant
  privilege matter, not a cross-tenant one. It should stay recorded, not fixed
  here.
- **`audit_log` locked to admin read, no INSERT.** The reasoning (the old
  `WITH CHECK (true)` let any signed-in user forge audit entries) is sound.
- **A belt-and-braces `service_role` policy per table.** Redundant given
  BYPASSRLS, harmless, and it matches the existing `conversation_examples`
  pattern. Keep for consistency.
- **The rollback file's overall design.** Including its blunt header saying it
  deliberately restores an insecure state and must not be mistaken for a good
  configuration. Keep that tone.

### Stale, must change

| # | What | Why | Fix |
|---|---|---|---|
| S1 | Part 1a creates a "Bombers Blueprint" org and repoints the bot | The briefing says that org already exists. Re-running creates a duplicate and moves the live bot into it, orphaning every profile backfilled against the old one | Delete Part 1a. Replace with a Block D readout and, if a repoint is genuinely still needed, an explicit `where` guarded by the real ids |
| S2 | `waitlist_applications` in the target array | 014 revoked the grant. The draft's admin policies are inert, and dropping 010's policies breaks the documented `014_rollback.sql` contract ("the two 010 policies were never dropped") | Remove from the array entirely. Leave 010's policies and 014's revoke exactly as they are |
| S3 | Single `begin; ... commit;` | Briefing 4.4 requires numbered idempotent chunks with verification SELECTs between | Rewrite as chunks. See Section 5 for what replaces the abort gate |
| S4 | The `do $$ ... raise exception ...$$` null-org gate | Only aborts anything inside a transaction. In a chunked file it raises, the chunk stops, and prior chunks stay committed | Becomes a standalone verification SELECT with a written expected output, run and eyeballed before the next chunk is pasted |
| S5 | `profiles_tenant_select` on a bare equality | The null-org bug. See Section 5 | Explicit null handling |
| S6 | Backfill excludes `disabled` from consideration | A disabled profile with a null org and no assigned bot aborts the whole migration for nothing | Gate on `disabled = false` |
| S7 | No `invites` decision | Section 8.1 | Decide, then either add it or record the exclusion with reasoning |
| S8 | Comment says "ROLE MODEL (confirmed with Anthony): superadmin / admin / client, setter" | The briefing's 4.1 describes three tiers with reviewer accounts explicitly demoted to ordinary org-scoped setters | Reconcile the wording. The mechanism is unchanged; the doc comment should match the briefing |
| S9 | Header says "NOT in this phase: ... the invites anon-update gap" | It names the gap and defers it. Given Section 8.1 that deferral needs re-arguing, not inheriting | Re-decide |

### Missing entirely

- **No `anon` posture is stated anywhere.** Every policy in the draft is
  `to authenticated` or `to service_role`. That is correct as far as it goes,
  but it means the anon story rests entirely on table grants, which Block B
  will reveal and which staging has already been seen to lose silently. The
  migration should state the intended anon posture per table explicitly, even
  where the action is "no change".
- **No realtime consideration.** See Section 6.3.
- **No `AcceptInvite` consideration.** See Section 8.1.

---

## 5. The null-org bug: exact shape, and the fix

### The mechanism

```sql
create policy profiles_tenant_select on public.profiles
  for select to authenticated
  using (organization_id = public.auth_org_id() or public.auth_is_superadmin());
```

For a user whose profile has `organization_id = null`, `auth_org_id()` returns
`null`. The row's own `organization_id` is also `null`. `null = null` evaluates
to **NULL**, not true. RLS treats a non-true result as a denial. The user cannot
read **their own profile row**.

### Why that specific failure is so bad here

`AuthContext.jsx:60` is `supabase.from('profiles').select('*').eq('id',
userId).single()`, and its result is the root of everything: `getAssignedBot`
reads `profile.role`, `profile.organization_id` and `profile.assigned_bot_id`
off it, and every page derives its `bot.id` from that. `.single()` with zero
rows returns an error which the code discards, then `setProfile(data || null)`
sets null. The pages sit on `if (!profile) return`.

The result is a **silently blank dashboard, no error shown, for a user who is
correctly authenticated**. This is precisely the failure mode PROGRESS already
records from the staging grants incident, which is why briefing matrix row 8
insists on eyeballing pixels rather than trusting a query.

### The fix, in two parts

**Part one, the policy.** Never let a null on either side decide anything:

```sql
create policy profiles_tenant_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()                                    -- always see yourself
    or public.auth_is_superadmin()
    or (
      organization_id is not null
      and organization_id = public.auth_org_id()
    )
  );
```

`id = auth.uid()` first is the important line and it is missing from the draft.
It makes the self-row readable **unconditionally**, independent of org state.
That single clause converts "null org locks you out of the whole product" into
"null org means you see only yourself", which is a degraded session rather than
a dead one, and it is what keeps a future profile created before org assignment
from bricking on first login.

The same `is not null` guard belongs on `profiles_update` and on
`organizations_tenant_select`, both of which have the identical bare-equality
shape.

**Part two, `auth_bot_ids()`.** The same class of bug lives here:

```sql
select b.id from public.bots b
where public.auth_is_admin_or_above()
  and b.organization_id = public.auth_org_id()
```

Null org, or a bot with a null `organization_id` (Block D's `full outer join`
exists to find those), yields NULL and contributes no rows. It fails closed, so
it is not a security bug, but for an admin it is a silently empty dashboard.
Add the `is not null` guard on both sides and the intent becomes explicit rather
than accidental.

### Part three, the backfill, which is the actual cure

The policy fix is a safety net. The backfill is the fix. Order per briefing 4.3,
which is correct and must not be reordered: backfill, verify zero nulls among
active accounts, create policies (inert while RLS is off), then enable RLS table
by table. There is no lockout window because a policy on an RLS-disabled table
does nothing.

The verification SELECT that replaces the draft's abort gate:

```sql
select id, email, role, disabled, organization_id, assigned_bot_id
from public.profiles
where organization_id is null and disabled = false;
```

Expected output, written into the migration file: **zero rows**. If it returns
rows, stop and do not paste the next chunk.

---

## 6. Dashboard query path inventory

Every `.from(...)` call in `dashboard/src`, by table, with its filter. This is
briefing item 3.6. The question each row answers: after RLS, does this query
become redundant-but-harmless, or does it break?

### 6.1 Bot-scoped reads and writes: all safe

Every one of these already carries `.eq('bot_id', bot.id)` (or
`.in('bot_id', botIds)`) where `bot` came from `getAssignedBot(profile)`. Under
RLS the filter becomes redundant and harmless, exactly as the briefing predicts.

| File | Lines | Tables |
|---|---|---|
| `components/Layout.jsx` | 93, 95 | reviews, conversations |
| `pages/Inbox.jsx` | 154 to 157, and every mutation from 345 to 920 | reviews, conversations, coach_flag_reasons |
| `pages/Dashboard.jsx` | 81 to 84 | conversations, reviews (via `.in('bot_id', botIds)`) |
| `pages/Analytics.jsx` | 117 to 120 | conversations, reviews |
| `pages/Learnings.jsx` | 23 | learnings |
| `pages/Documents.jsx` | 40, 90, 96 | bot_documents |
| `pages/PromptEditor.jsx` | 30, 44, 48 | prompt_versions, bots |
| `pages/TrainBot.jsx` | 59, 89, 92, 93 | bots, prompt_versions |
| `pages/Tester.jsx` | 41, 234, 467, 481 | conversation_examples, learnings, reviews |
| `pages/Settings.jsx` | 111, 178, 216 | reviews, bots |

One nuance worth recording: `Documents.jsx:93`, `:111` and `:117` filter by
document `id`, not `bot_id`. That is fine. The ids came from a `bot_id`-scoped
select, and after RLS the `USING` clause scopes the update/delete anyway, so a
cross-tenant id would affect zero rows instead of succeeding.

Tables the dashboard never touches at all: `reconciliation_queue`, `audit_log`,
`organizations`, `data_deletion_requests`. The draft still writes policies for
the first three, which is right (defence in depth, and the Worker or a future
page may need them), but it means **those three policies get no coverage from
matrix row 8**. Verify them by query, not by clicking.

### 6.2 The unfiltered queries: the ones that change behaviour

**`UserManagement.jsx:35, 38, 41`** is the superadmin/admin view, and all three
queries are deliberately unfiltered for anyone who is not a `client`:

- `:35 profiles` becomes org-scoped. Superadmin still sees everyone. **An
  `admin` stops seeing other orgs' users.** Intended, but it is a visible change
  and someone will notice.
- `:41 bots` (`select('id, name').order('name')`, no filter) becomes
  `auth_bot_ids()`-scoped. This feeds the **bot assignment dropdown on the
  invite form**. An admin who could previously assign an invite to any bot on
  the platform will now see only their own org's. Intended. Superadmin
  unaffected.
- `:38 invites` is the one that depends on a decision not yet made. See 8.1.

**`botHelper.js:14-20` and the `.single()` hazard.** For admin and superadmin,
`getAssignedBot` runs `.from('bots').eq('organization_id',
profile.organization_id).single()`. `.single()` errors unless the org has
**exactly one** bot. This is not caused by RLS, but RLS interacts with it: the
policy narrows the visible set, so an org that returns one row today could
return zero after the change if the org linkage is wrong. More pressingly, it is
a live Part B hazard:

> If Nella is a superadmin whose `organization_id` is the platform org, and the
> SuperYOU bot lives in a SuperYOU org, then `getAssignedBot` returns null for
> her and **her Connections page never renders a bot to connect**. Connections
> is gated on `if (!profile) ... getAssignedBot(profile)` and sets `bot` from
> its result; `startInstagramConnect` returns early on `!bot`.

Block D plus Block C settle whether this bites. Flagging it now because it would
otherwise surface at the worst possible moment: mid-choreography, on Nella's
screen, during her connect. `Analytics.jsx:99-105` and `Dashboard.jsx:63-69`
handle the same lookup without `.single()` and just take `[0]`, so they degrade
instead of erroring, which is the inconsistency that would make it confusing to
diagnose live.

### 6.3 Realtime, which the draft does not mention

`Layout.jsx:118-130` and `Inbox.jsx:306-311` open `postgres_changes`
subscriptions on `reviews` and `conversations`, filtered `bot_id=eq.<bot.id>`.

Supabase Realtime evaluates RLS for the subscribing user before delivering a
change. On **production** this path already runs with RLS on (permissive), so
only the policy shape changes: moderate risk. On **staging** RLS is currently
off, so enabling it makes staging the first place realtime is ever exercised
against these policies at all.

If this breaks, it breaks quietly: the sidebar badge stops updating and the
inbox stops live-refreshing, while every page still renders correctly. Nobody
eyeballing pixels would catch it. **Add an explicit matrix row: with two
sessions open, change a review and confirm the other session's badge moves.**

---

## 7. The Worker tenant check (briefing 4.5)

Confirmed. Both routes authenticate and neither authorizes.

**`/meta/connection-status`** (`index.js:1472`): calls
`verifyDashboardJwt(env, request)`, 401s on failure, validates `bot_id` is a
UUID, then queries `connected_accounts` **with the service key** for whatever
`bot_id` the caller asked about. The code already documents its own gap at
`:1467-1471`, including the mitigation that what leaks is "a handle and a date,
not tenant content". Still a cross-tenant read.

**`/meta/send`** (`index.js:1525`): same JWT gate, then loads the review by id
with the service key and sends it. Nothing compares the review's `bot_id` to the
caller. **Any logged-in dashboard user can send any tenant's approved review to
that tenant's lead, through that tenant's Instagram token.** This is materially
worse than the read, because it is a write to a third party under someone else's
brand. Note the existing status-machine guard is a real partial mitigation: the
review must already be `approved`, `edited` or `auto_sent`, and a delivered
`instagram_api` review flips to `sent`, so a double-send dies at `:1557`. It
bounds the blast radius; it does not close the boundary.

**The hook is clean.** `verifyDashboardJwt` (`:5205`) already returns the auth
user id. The assertion is one service-key read of `profiles` by that id, then
compare `organization_id` against the target bot's org, superadmin passes, 403
otherwise. No new dependency, no new secret.

**Recommendation, and a scope flag.** Do this in the same commit family as the
briefing directs, but write the profile lookup as a **single shared helper**
used by both routes, because a third caller is coming (see below) and three
divergent copies of a tenant check is how one of them ends up wrong.

**Out of scope but must be recorded: `/meta/oauth/start` (`index.js:1209`) has
no authentication at all.** It takes `bot_id` from a query string and mints a
KV state. The `TODO(dashboard)` at `:1206-1208` says to require an authenticated
session "once the dashboard UI exists". The dashboard UI now exists;
`Connections.jsx:98` calls it. Today anyone who knows a `bot_id` can start an
OAuth flow that, if they complete it with their own Instagram account, writes a
`connected_accounts` row against someone else's tenant. The callback's state
validation stops replay, not this. This is squarely a Part B concern (it is the
exact endpoint Nella is about to click) and I recommend folding it into the same
Worker change rather than leaving it. It is not in the briefing's 4.5, so it
needs a decision rather than my assumption.

---

## 8. Findings that need a decision before design

### 8.1 `invites`: the gap the draft leaves open

The draft excludes `invites` from its target array, deliberately, and its header
defers "the invites anon-update gap". Three facts make that deferral worth
re-arguing:

1. **`AcceptInvite.jsx:27-32` reads `invites` as anon**, before signup or
   signin, selecting `token, role, assigned_bot_id, permissions` plus an
   embedded `bots (name)`.
2. **An invite row is a bearer credential.** `:90-100` upserts a profile
   carrying `invite.role` and `invite.assigned_bot_id` straight through. Whoever
   holds a pending token picks a tenant and a role.
3. **`invites` did not appear in the 2026-08-07 policy dump.** Not in the twelve
   tables listed. Since invite acceptance demonstrably works, the most likely
   explanation is that RLS is **off** on `invites`, in which case the anon table
   grant alone governs it and **any holder of the public anon key can read every
   invite row, including tokens**. PROGRESS separately records that open signup
   was found enabled on staging. Block A and Block B settle this in one line.

There is also a **regression risk running the other way**, which is why this
cannot simply be locked down without thought: the draft enables RLS on `bots`
with policies scoped `to authenticated` only. `AcceptInvite`'s embedded
`bots (name)` runs as **anon**. Best case the embed comes back null and the page
loses a bot name. Worst case PostgREST fails the embed, `.single()` errors, and
the page shows "Invite not found or has already been used", **breaking
onboarding for every new user**, which is the exact mechanism Part B depends on
if Nella's tenant ever needs staff.

**Decision needed:** (a) leave `invites` alone and accept the token exposure,
recording it; (b) scope `invites` in 011 and replace the anon read with a
`SECURITY DEFINER` token-lookup RPC (the correct end state, and the draft
already names this RPC as the proper fix for the sibling escalation); or (c)
scope `invites` for `authenticated` while leaving an explicit anon
read-by-token policy. My recommendation is **(b)**, but it is real extra scope
and it is Anthony's call whether it belongs in this phase.

**Regardless of which is chosen: `AcceptInvite` end to end, on a fresh email,
must be a row in the staging matrix.** The draft never contemplates it and it is
one `.single()` away from silent breakage.

### 8.2 `waitlist_applications` must leave the target list

Covered in Section 2 and S2. Restating the mechanism because it is subtle:
migration 014 revoked the `authenticated` table grant while deliberately leaving
010's two policies in place, and `014_rollback.sql` documents that choice as the
reason a single `grant` restores the exact prior state. The draft's blanket
policy-drop loop would delete those two policies as a side effect, breaking that
contract without anyone noticing, and would replace them with admin-scoped
policies that cannot fire behind the revoke. Zero benefit, real cost.

Briefing matrix row 6 wants waitlist "still denied". Removing it from the array
is how that stays true.

### 8.3 Branch recommendation: start fresh, do not rebase

Recommend **`feat/mt-phase-1-rls-v2`, branched from `main`** (already created;
this report is its first file). Reasons: the shape change from one transaction
to numbered chunks is a rewrite rather than an edit; Part 1a must be deleted
rather than amended; `waitlist_applications` must come out; and `feat/mt-phase-1-rls`
branched before 012, 013 and 014 existed, so rebasing carries a migration-chain
conflict for no gain. Keep `feat/mt-phase-1-rls` intact as the historical draft
and lift its helper functions and drop-loop across verbatim.

Also recommend merging `docs/mt-phase-0` into `main`. It is a 320-line audit
that has sat unmerged for three weeks, `CLAUDE.md` points at a
`SYSTEM-AUDIT.md` that does not exist, and this refresh cites it constantly.

---

## 9. What I am NOT doing, per briefing 4.6

No dashboard feature changes. No removal of client-side filters. No touch of
Worker service-key paths. No `BOT_ID` hardcode fix. The one place I am asking to
widen scope is Section 7's `/meta/oauth/start`, and 8.1's `invites`, both stated
as decisions rather than assumed.

---

## 10. Open items, carried

| id | Item | Resolves by |
|---|---|---|
| O-2 | `SYSTEM-AUDIT.md` referenced by `CLAUDE.md` does not exist in any branch | Anthony adds it, or `CLAUDE.md` is repointed at `ARCHITECTURE.md` plus these two documents |
| N-1 | Does a Bombers Blueprint org already exist? Gates draft Part 1a | Block D |
| N-2 | `invites` RLS and grant state, and the AcceptInvite decision | Blocks A and B, then 8.1 |
| N-3 | Is Nella's profile org the same org as the SuperYOU bot? Gates her Connections page rendering at all | Blocks C and D |
| N-4 | Any out-of-band table not in Section 2 | Block A |
| N-5 | `service_role.rolbypassrls` re-confirmed on both projects | Block F |
| N-6 | Migration 014's file still unexecuted on production (effect is live) | Fold into the chunk list as a no-op bookkeeping paste |
| N-7 | `/meta/oauth/start` unauthenticated | Section 7 decision |
| N-8 | Realtime under the new policies, both environments | New matrix row, Section 6.3 |

---

*End of Phase 0 refresh. No SQL was executed and no application code was
changed. Next step is Anthony's paste of Section 3 from both environments,
plus decisions on 8.1, 8.3 and Section 7's scope question. The migration is
designed after that, not before.*
