-- ============================================================================
-- Migration 011 (v2): tenant-scoped RLS
-- ============================================================================
-- Replaces the abandoned single-transaction draft on feat/mt-phase-1-rls.
-- The number 011 is kept for continuity with the Phase 0/1 documents even
-- though it executes after 012, 013 and 014 chronologically.
--
-- PURPOSE. Close the tenant isolation hole confirmed by the 2026-08-29 live
-- baseline (docs/MULTI-TENANCY-PHASE-0-BASELINE.md): every core table carries
-- authenticated USING (true), so any signed-in user reads and writes every
-- tenant's rows. The dashboard's .eq('bot_id', ...) filters run in the browser
-- and are not a boundary.
--
-- DECISIONS ENCODED (D1-D5, signed off 2026-08-29):
--   D1  superadmin profiles keep organization_id NULL. Every superadmin branch
--       goes through auth_is_superadmin(), which reads role, never org.
--   D2  the backfill and its gate exclude disabled profiles. Disabled rows are
--       backfilled for hygiene but never allowed to abort anything.
--   D3  is Part B choreography, not this file.
--   D4  the invites anon-listing policy is dropped and replaced by the
--       SECURITY DEFINER lookup_invite RPC (chunk 4). AcceptInvite.jsx
--       switches to calling it (same commit family).
--   D5  production's anon table grants are revoked, in chunk 13, strictly
--       after the RPC chunk.
--
-- EXECUTION MODEL. The browser SQL editor is not trusted to be atomic across
-- statements, so this file is NUMBERED IDEMPOTENT CHUNKS. Paste ONE chunk at a
-- time, run it, run nothing else until its verification SELECT (the last
-- statement of the chunk) matches the EXPECTED output written beside it. Every
-- chunk is safe to re-run in full if it errors midway. A stop at any chunk
-- boundary leaves a working system.
--
-- WHY THERE IS NO LOCKOUT WINDOW. On staging, RLS is off on the core tables,
-- so chunks 5-11 create inert policies and chunk 12 turns them on. On
-- production, RLS is already on with permissive policies; each table chunk
-- CREATES the new scoped policies FIRST (policies are OR'd, so adding scoped
-- ones beside permissive ones changes nothing) and only then sweeps away
-- everything that is not in the new set. At no intermediate point does any
-- table have zero policies while RLS is on.
--
-- THE SWEEP. Old policies are dropped by iterating pg_policy and removing
-- everything NOT in the new name list, never by naming them. Lesson recorded
-- in PROGRESS 2026-08-29: the conversation_examples hole was a policy nobody
-- would have put on a drop list, and one surviving permissive policy defeats
-- every scoped policy beside it.
--
-- ORDER ACROSS ENVIRONMENTS AND DEPLOYS (also in the staging plan):
--   1. chunks 0-4 (chunk 0 is staging-only)
--   2. deploy the dashboard build that calls lookup_invite (AcceptInvite)
--      and /meta/oauth/init (Connections), plus the Worker with the tenant
--      assertions
--   3. chunks 5-13
--   Chunk 11 drops the anon invite-listing policy, which the OLD AcceptInvite
--   still needs; the NEW AcceptInvite needs chunk 4's RPC. Hence the deploy
--   sits between 4 and 5. Currently zero pending unexpired invites exist in
--   either environment, so the coupling is about correctness, not live risk.
--
-- The Worker authenticates with SUPABASE_SERVICE_KEY; service_role has
-- rolbypassrls = true on both projects (verified in the baseline), so nothing
-- here touches Worker behavior. Belt-and-braces service_role policies are
-- still written per table.
--
-- NOT in this phase: the Worker BOT_ID constant, tenant routing for the legacy
-- /webhook path, per-tenant Make webhooks, the accept-invite SECURITY DEFINER
-- RPC that would close the role-stamping caveat (recorded follow-up), and any
-- tightening of authenticated table grants (recorded follow-up).
-- ============================================================================


-- ============================================================================
-- CHUNK 0 (STAGING ONLY): grant alignment
-- ============================================================================
-- Staging's authenticated role lacks DELETE on bot_documents (production has
-- it, and the Documents page remove button uses it). Without this, matrix row
-- "documents delete" fails on staging for GRANT reasons and would be
-- misdiagnosed as a policy bug. Production: DO NOT RUN (already granted;
-- harmless if run, but keep the record clean).
--
-- The other staging divergence, organizations having SELECT only for
-- authenticated, is ACCEPTED: the dashboard never writes organizations.

grant delete on public.bot_documents to authenticated;

-- VERIFY (expected on staging, one row):
--   table_name    | grantee       | privs
--   bot_documents | authenticated | DELETE, INSERT, SELECT, UPDATE
select table_name, grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'bot_documents'
  and grantee = 'authenticated'
group by 1, 2;


-- ============================================================================
-- CHUNK 1: helper functions
-- ============================================================================
-- STABLE SECURITY DEFINER, search_path pinned, execute revoked from public and
-- granted to authenticated only. SECURITY DEFINER is what breaks the
-- RLS-on-profiles recursion: these read public.profiles, and once profiles has
-- scoped policies an inline profiles subquery inside another table's policy
-- would recurse. CREATE OR REPLACE (not DROP+CREATE) so a re-run never breaks
-- policies that already depend on the functions.
--
-- Null handling is deliberate everywhere (the known bug in the old draft):
-- a null organization_id must never decide anything by NULL-equality, and a
-- disabled profile must fail closed.

create or replace function public.auth_is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'superadmin'
      and coalesce(disabled, false) = false
  );
$$;

create or replace function public.auth_is_admin_or_above()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'superadmin')
      and coalesce(disabled, false) = false
  );
$$;

create or replace function public.auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles
  where id = auth.uid()
    and coalesce(disabled, false) = false;
$$;

-- Every bot the current user may access:
--   superadmin        -> all bots (role check, org NEVER consulted, per D1)
--   admin             -> all bots in their org, only when org is non-null on
--                        BOTH sides (explicit guard, not accidental NULL=NULL)
--   any role          -> their assigned_bot_id, if set
create or replace function public.auth_bot_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id from public.bots b
  where public.auth_is_superadmin()
  union
  select b.id from public.bots b
  where public.auth_is_admin_or_above()
    and public.auth_org_id() is not null
    and b.organization_id is not null
    and b.organization_id = public.auth_org_id()
  union
  select p.assigned_bot_id from public.profiles p
  where p.id = auth.uid()
    and coalesce(p.disabled, false) = false
    and p.assigned_bot_id is not null;
$$;

revoke execute on function public.auth_is_superadmin()     from public;
revoke execute on function public.auth_is_admin_or_above() from public;
revoke execute on function public.auth_org_id()            from public;
revoke execute on function public.auth_bot_ids()           from public;
grant  execute on function public.auth_is_superadmin()     to authenticated;
grant  execute on function public.auth_is_admin_or_above() to authenticated;
grant  execute on function public.auth_org_id()            to authenticated;
grant  execute on function public.auth_bot_ids()           to authenticated;

-- VERIFY (expected, BOTH environments, exactly 4 rows):
--   proname                | secdef | vol | config
--   auth_bot_ids           | true   | s   | {search_path=public}
--   auth_is_admin_or_above | true   | s   | {search_path=public}
--   auth_is_superadmin     | true   | s   | {search_path=public}
--   auth_org_id            | true   | s   | {search_path=public}
select p.proname, p.prosecdef as secdef, p.provolatile as vol, p.proconfig as config
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('auth_is_superadmin', 'auth_is_admin_or_above',
                    'auth_org_id', 'auth_bot_ids')
order by p.proname;


-- ============================================================================
-- CHUNK 2: the Bombers Blueprint organization
-- ============================================================================
-- Confirmed by the baseline: no Bombers Blueprint ORG exists in either
-- environment. The bot sits under the platform org (...0001, "Nella
-- Platform"). Give the client its own org and repoint the bot. Idempotent:
-- the insert is guarded on name, the update is guarded on current value.
--
-- KNOWN CONSEQUENCE, BY DESIGN (D1): after this chunk the platform org holds
-- zero bots. Superadmin dashboards are unaffected because their
-- organization_id stays NULL (normalized in chunk 3) and getAssignedBot falls
-- through to assigned_bot_id.

insert into public.organizations (name)
select 'Bombers Blueprint'
where not exists (
  select 1 from public.organizations where name = 'Bombers Blueprint'
);

update public.bots
set organization_id = (
  select id from public.organizations where name = 'Bombers Blueprint'
)
where id = '00000000-0000-0000-0000-000000000002'
  and organization_id is distinct from (
    select id from public.organizations where name = 'Bombers Blueprint'
  );

-- VERIFY. Expected on PRODUCTION (4 org rows; bot columns null only for the
-- platform org):
--   Bombers Blueprint | <new uuid> | 00000000-...-0002 | Bombers Blueprint
--   Mu AI Demo        | ...00d0    | ...00d1           | Mu AI Demo
--   Nella Platform    | ...0001    | null              | null
--   SuperYOU          | c854fd89.. | 45b776e3..        | SuperYOU - Laura Phillips
-- Expected on STAGING (3 org rows):
--   Bombers Blueprint          | <new uuid> | ...0002 | Bombers Blueprint (staging)
--   Mu AI Demo                 | ...00d0    | ...00d1 | Mu AI Demo
--   Nella Platform (staging)   | ...0001    | null    | null
select o.name as org_name, o.id as org_id, b.id as bot_id, b.name as bot_name
from public.organizations o
left join public.bots b on b.organization_id = o.id
order by o.name, b.name;


-- ============================================================================
-- CHUNK 3: profile backfill, with the gate
-- ============================================================================
-- 3a. Superadmin normalization (D1). Production superadmins already have
-- organization_id null and assigned_bot_id ...0002, so both statements are
-- no-ops there. On staging they align thony@gmail.com to the same shape
-- (org ...0001 -> null, assigned bot null -> ...0002) so the rehearsal
-- exercises the exact production posture. The assigned_bot_id value is UI
-- continuity only: it is the bot getAssignedBot lands on for the superadmin
-- dashboard, it grants nothing (superadmin passes every policy by role).

update public.profiles
set organization_id = null
where role = 'superadmin'
  and organization_id is not null;

update public.profiles
set assigned_bot_id = '00000000-0000-0000-0000-000000000002'
where role = 'superadmin'
  and assigned_bot_id is null;

-- 3b. Tenant staff: copy the org from the assigned bot. Includes disabled
-- profiles (hygiene) but they never gate. meta-review / reviewer-sim already
-- match and are no-ops via IS DISTINCT FROM.

update public.profiles p
set organization_id = b.organization_id
from public.bots b
where p.assigned_bot_id = b.id
  and p.role is distinct from 'superadmin'
  and p.organization_id is distinct from b.organization_id;

-- Optional eyeball of the full map before the gate (run alone if wanted):
--   select id, email, role, disabled, organization_id, assigned_bot_id
--   from public.profiles order by role, created_at;
-- Expected on production after 3a/3b:
--   ornellakuate@ / shaun@ / austinewebdev@  -> org = Bombers Blueprint org id
--   lou / abigail (disabled)                 -> org = Bombers Blueprint org id
--   meta-review@getmu.co                     -> org = ...00d0 (unchanged)
--   iamanthony1007@ / nellakuate@ (superadmin) -> org null, bot ...0002

-- VERIFY, THE GATE. Expected: ZERO ROWS, both environments. If ANY row
-- returns, STOP. Do not paste any further chunk until it is resolved.
select id, email, role, disabled, organization_id, assigned_bot_id
from public.profiles
where role is distinct from 'superadmin'
  and coalesce(disabled, false) = false
  and organization_id is null;


-- ============================================================================
-- CHUNK 4: the invite lookup RPC (D4)
-- ============================================================================
-- Replaces the anon SELECT policy on invites, which permitted LISTING every
-- pending unexpired invite with its token. RLS cannot see a WHERE clause, so
-- a policy can never express "only the row whose token you already hold"; a
-- SECURITY DEFINER function taking the token as an argument can. Returns only
-- the fields AcceptInvite renders. The token itself is NOT returned (the
-- caller already has it), and status is not needed (only pending unexpired
-- rows are returned at all).
--
-- The anon policy itself is dropped in chunk 11, AFTER the dashboard deploy
-- that switches AcceptInvite.jsx onto this RPC.

create or replace function public.lookup_invite(invite_token text)
returns table (
  id              uuid,
  email           text,
  name            text,
  role            text,
  assigned_bot_id uuid,
  permissions     jsonb,
  expires_at      timestamptz,
  bot_name        text
)
language sql
stable
security definer
set search_path = public
as $$
  -- to_jsonb on permissions is LOAD-BEARING, found live on production
  -- 2026-08-29: the repo schema declares invites.permissions jsonb, but the
  -- real production column is text[] (schema.sql is a reconstruction and this
  -- is where the drift surfaced, as a 42P13 at CREATE time). to_jsonb
  -- normalizes either underlying type to the declared jsonb, and the
  -- dashboard receives the same JSON array of strings in both cases.
  select i.id, i.email, i.name, i.role, i.assigned_bot_id,
         to_jsonb(i.permissions), i.expires_at, b.name
  from public.invites i
  left join public.bots b on b.id = i.assigned_bot_id
  where i.token = invite_token
    and i.status = 'pending'
    and (i.expires_at is null or i.expires_at > now())
  limit 1;
$$;

revoke execute on function public.lookup_invite(text) from public;
grant  execute on function public.lookup_invite(text) to anon;
grant  execute on function public.lookup_invite(text) to authenticated;

-- PostgREST must reload to expose /rest/v1/rpc/lookup_invite.
notify pgrst, 'reload schema';

-- Spot check (run alone if wanted): select * from public.lookup_invite('x');
-- Expected: zero rows.

-- VERIFY (expected, both environments, exactly 1 row):
--   lookup_invite | true | s | {search_path=public}
select p.proname, p.prosecdef as secdef, p.provolatile as vol, p.proconfig as config
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'lookup_invite';


-- ============================================================================
-- >>> DEPLOY GATE. Between chunk 4 and chunk 5: deploy the dashboard build
-- >>> carrying the AcceptInvite RPC switch and the Connections oauth/init
-- >>> switch, and the Worker carrying the tenant assertions. Staging first,
-- >>> per the standing rule. Then continue.
-- ============================================================================


-- ============================================================================
-- CHUNK 5: policies, bot-scoped set A
-- (conversations, reviews, learnings, coach_flag_reasons)
-- ============================================================================
-- Command sets match what the dashboard actually does (Phase 0 refresh
-- Section 6): conversations and reviews are read/insert/update, learnings and
-- coach_flag_reasons are read/insert. Every UPDATE carries WITH CHECK
-- mirroring USING so a row cannot be moved to another tenant.

-- conversations
drop policy if exists conversations_tenant_select on public.conversations;
create policy conversations_tenant_select on public.conversations
  for select to authenticated
  using (bot_id in (select public.auth_bot_ids()));
drop policy if exists conversations_tenant_insert on public.conversations;
create policy conversations_tenant_insert on public.conversations
  for insert to authenticated
  with check (bot_id in (select public.auth_bot_ids()));
drop policy if exists conversations_tenant_update on public.conversations;
create policy conversations_tenant_update on public.conversations
  for update to authenticated
  using (bot_id in (select public.auth_bot_ids()))
  with check (bot_id in (select public.auth_bot_ids()));
drop policy if exists conversations_service_all on public.conversations;
create policy conversations_service_all on public.conversations
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['conversations_tenant_select', 'conversations_tenant_insert',
                       'conversations_tenant_update', 'conversations_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.conversations'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.conversations', pol.polname);
    end if;
  end loop;
end $$;

-- reviews
drop policy if exists reviews_tenant_select on public.reviews;
create policy reviews_tenant_select on public.reviews
  for select to authenticated
  using (bot_id in (select public.auth_bot_ids()));
drop policy if exists reviews_tenant_insert on public.reviews;
create policy reviews_tenant_insert on public.reviews
  for insert to authenticated
  with check (bot_id in (select public.auth_bot_ids()));
drop policy if exists reviews_tenant_update on public.reviews;
create policy reviews_tenant_update on public.reviews
  for update to authenticated
  using (bot_id in (select public.auth_bot_ids()))
  with check (bot_id in (select public.auth_bot_ids()));
drop policy if exists reviews_service_all on public.reviews;
create policy reviews_service_all on public.reviews
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['reviews_tenant_select', 'reviews_tenant_insert',
                       'reviews_tenant_update', 'reviews_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.reviews'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.reviews', pol.polname);
    end if;
  end loop;
end $$;

-- learnings (read and insert: Save and Train; no dashboard update/delete)
drop policy if exists learnings_tenant_select on public.learnings;
create policy learnings_tenant_select on public.learnings
  for select to authenticated
  using (bot_id in (select public.auth_bot_ids()));
drop policy if exists learnings_tenant_insert on public.learnings;
create policy learnings_tenant_insert on public.learnings
  for insert to authenticated
  with check (bot_id in (select public.auth_bot_ids()));
drop policy if exists learnings_service_all on public.learnings;
create policy learnings_service_all on public.learnings
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['learnings_tenant_select', 'learnings_tenant_insert',
                       'learnings_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.learnings'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.learnings', pol.polname);
    end if;
  end loop;
end $$;

-- coach_flag_reasons (read and insert: flag / unflag logs an event)
drop policy if exists coach_flag_reasons_tenant_select on public.coach_flag_reasons;
create policy coach_flag_reasons_tenant_select on public.coach_flag_reasons
  for select to authenticated
  using (bot_id in (select public.auth_bot_ids()));
drop policy if exists coach_flag_reasons_tenant_insert on public.coach_flag_reasons;
create policy coach_flag_reasons_tenant_insert on public.coach_flag_reasons
  for insert to authenticated
  with check (bot_id in (select public.auth_bot_ids()));
drop policy if exists coach_flag_reasons_service_all on public.coach_flag_reasons;
create policy coach_flag_reasons_service_all on public.coach_flag_reasons
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['coach_flag_reasons_tenant_select',
                       'coach_flag_reasons_tenant_insert',
                       'coach_flag_reasons_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.coach_flag_reasons'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.coach_flag_reasons', pol.polname);
    end if;
  end loop;
end $$;

-- VERIFY (expected, both environments, exactly these 14 rows in this order):
--   coach_flag_reasons | coach_flag_reasons_service_all    | *
--   coach_flag_reasons | coach_flag_reasons_tenant_insert  | a
--   coach_flag_reasons | coach_flag_reasons_tenant_select  | r
--   conversations      | conversations_service_all         | *
--   conversations      | conversations_tenant_insert       | a
--   conversations      | conversations_tenant_select       | r
--   conversations      | conversations_tenant_update       | w
--   learnings          | learnings_service_all             | *
--   learnings          | learnings_tenant_insert           | a
--   learnings          | learnings_tenant_select           | r
--   reviews            | reviews_service_all               | *
--   reviews            | reviews_tenant_insert             | a
--   reviews            | reviews_tenant_select             | r
--   reviews            | reviews_tenant_update             | w
select c.relname as table_name, p.polname, p.polcmd
from pg_policy p join pg_class c on c.oid = p.polrelid
where c.relname in ('conversations', 'reviews', 'learnings', 'coach_flag_reasons')
order by 1, 2;


-- ============================================================================
-- CHUNK 6: policies, bot-scoped set B
-- (bot_documents, prompt_versions, reconciliation_queue, conversation_examples)
-- ============================================================================

-- bot_documents: the only table the dashboard deletes from
drop policy if exists bot_documents_tenant_select on public.bot_documents;
create policy bot_documents_tenant_select on public.bot_documents
  for select to authenticated
  using (bot_id in (select public.auth_bot_ids()));
drop policy if exists bot_documents_tenant_insert on public.bot_documents;
create policy bot_documents_tenant_insert on public.bot_documents
  for insert to authenticated
  with check (bot_id in (select public.auth_bot_ids()));
drop policy if exists bot_documents_tenant_update on public.bot_documents;
create policy bot_documents_tenant_update on public.bot_documents
  for update to authenticated
  using (bot_id in (select public.auth_bot_ids()))
  with check (bot_id in (select public.auth_bot_ids()));
drop policy if exists bot_documents_tenant_delete on public.bot_documents;
create policy bot_documents_tenant_delete on public.bot_documents
  for delete to authenticated
  using (bot_id in (select public.auth_bot_ids()));
drop policy if exists bot_documents_service_all on public.bot_documents;
create policy bot_documents_service_all on public.bot_documents
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['bot_documents_tenant_select', 'bot_documents_tenant_insert',
                       'bot_documents_tenant_update', 'bot_documents_tenant_delete',
                       'bot_documents_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.bot_documents'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.bot_documents', pol.polname);
    end if;
  end loop;
end $$;

-- prompt_versions: read and insert (saving or training writes a version)
drop policy if exists prompt_versions_tenant_select on public.prompt_versions;
create policy prompt_versions_tenant_select on public.prompt_versions
  for select to authenticated
  using (bot_id in (select public.auth_bot_ids()));
drop policy if exists prompt_versions_tenant_insert on public.prompt_versions;
create policy prompt_versions_tenant_insert on public.prompt_versions
  for insert to authenticated
  with check (bot_id in (select public.auth_bot_ids()));
drop policy if exists prompt_versions_service_all on public.prompt_versions;
create policy prompt_versions_service_all on public.prompt_versions
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['prompt_versions_tenant_select', 'prompt_versions_tenant_insert',
                       'prompt_versions_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.prompt_versions'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.prompt_versions', pol.polname);
    end if;
  end loop;
end $$;

-- reconciliation_queue: written by the Worker, read/update from the dashboard
drop policy if exists reconciliation_queue_tenant_select on public.reconciliation_queue;
create policy reconciliation_queue_tenant_select on public.reconciliation_queue
  for select to authenticated
  using (bot_id in (select public.auth_bot_ids()));
drop policy if exists reconciliation_queue_tenant_insert on public.reconciliation_queue;
create policy reconciliation_queue_tenant_insert on public.reconciliation_queue
  for insert to authenticated
  with check (bot_id in (select public.auth_bot_ids()));
drop policy if exists reconciliation_queue_tenant_update on public.reconciliation_queue;
create policy reconciliation_queue_tenant_update on public.reconciliation_queue
  for update to authenticated
  using (bot_id in (select public.auth_bot_ids()))
  with check (bot_id in (select public.auth_bot_ids()));
drop policy if exists reconciliation_queue_service_all on public.reconciliation_queue;
create policy reconciliation_queue_service_all on public.reconciliation_queue
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['reconciliation_queue_tenant_select',
                       'reconciliation_queue_tenant_insert',
                       'reconciliation_queue_tenant_update',
                       'reconciliation_queue_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.reconciliation_queue'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.reconciliation_queue', pol.polname);
    end if;
  end loop;
end $$;

-- conversation_examples: dashboard reads only (Tester library). Rebuilt onto
-- the helpers; the sweep also removes the two remaining inline-subquery
-- policies from the original scoped set (production) without naming them.
drop policy if exists conversation_examples_tenant_select on public.conversation_examples;
create policy conversation_examples_tenant_select on public.conversation_examples
  for select to authenticated
  using (bot_id in (select public.auth_bot_ids()));
drop policy if exists conversation_examples_service_all on public.conversation_examples;
create policy conversation_examples_service_all on public.conversation_examples
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['conversation_examples_tenant_select',
                       'conversation_examples_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.conversation_examples'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.conversation_examples', pol.polname);
    end if;
  end loop;
end $$;

-- VERIFY (expected, both environments, exactly these 14 rows):
--   bot_documents         | bot_documents_service_all           | *
--   bot_documents         | bot_documents_tenant_delete         | d
--   bot_documents         | bot_documents_tenant_insert         | a
--   bot_documents         | bot_documents_tenant_select         | r
--   bot_documents         | bot_documents_tenant_update         | w
--   conversation_examples | conversation_examples_service_all   | *
--   conversation_examples | conversation_examples_tenant_select | r
--   prompt_versions       | prompt_versions_service_all         | *
--   prompt_versions       | prompt_versions_tenant_insert       | a
--   prompt_versions       | prompt_versions_tenant_select       | r
--   reconciliation_queue  | reconciliation_queue_service_all    | *
--   reconciliation_queue  | reconciliation_queue_tenant_insert  | a
--   reconciliation_queue  | reconciliation_queue_tenant_select  | r
--   reconciliation_queue  | reconciliation_queue_tenant_update  | w
select c.relname as table_name, p.polname, p.polcmd
from pg_policy p join pg_class c on c.oid = p.polrelid
where c.relname in ('bot_documents', 'prompt_versions',
                    'reconciliation_queue', 'conversation_examples')
order by 1, 2;


-- ============================================================================
-- CHUNK 7: bots
-- ============================================================================
-- Tenant column is its own id. UPDATE stays tenant-scoped rather than
-- role-restricted, per the decision recorded in the original draft: a client
-- editing their own bot's prompt is the product working as designed. RLS no
-- longer stops a setter updating their own bot's config; the client-side
-- permission gates (prompt_editor, train_bot, settings_admin) are the control
-- there. In-tenant privilege matter, recorded, not a cross-tenant one.

drop policy if exists bots_tenant_select on public.bots;
create policy bots_tenant_select on public.bots
  for select to authenticated
  using (id in (select public.auth_bot_ids()));
drop policy if exists bots_tenant_update on public.bots;
create policy bots_tenant_update on public.bots
  for update to authenticated
  using (id in (select public.auth_bot_ids()))
  with check (id in (select public.auth_bot_ids()));
drop policy if exists bots_service_all on public.bots;
create policy bots_service_all on public.bots
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['bots_tenant_select', 'bots_tenant_update', 'bots_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.bots'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.bots', pol.polname);
    end if;
  end loop;
end $$;

-- VERIFY (expected, both environments, exactly 3 rows):
--   bots | bots_service_all   | *
--   bots | bots_tenant_select | r
--   bots | bots_tenant_update | w
select c.relname as table_name, p.polname, p.polcmd
from pg_policy p join pg_class c on c.oid = p.polrelid
where c.relname = 'bots'
order by 2;


-- ============================================================================
-- CHUNK 8: organizations
-- ============================================================================
-- Superadmin sees all (role check, never org). Staff see their own org, with
-- the explicit null guard: a null auth_org_id() must yield no rows, never a
-- NULL-equality accident.

drop policy if exists organizations_tenant_select on public.organizations;
create policy organizations_tenant_select on public.organizations
  for select to authenticated
  using (
    public.auth_is_superadmin()
    or (public.auth_org_id() is not null and id = public.auth_org_id())
  );
drop policy if exists organizations_service_all on public.organizations;
create policy organizations_service_all on public.organizations
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['organizations_tenant_select', 'organizations_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.organizations'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.organizations', pol.polname);
    end if;
  end loop;
end $$;

-- VERIFY (expected, both environments, exactly 2 rows):
--   organizations | organizations_service_all   | *
--   organizations | organizations_tenant_select | r
select c.relname as table_name, p.polname, p.polcmd
from pg_policy p join pg_class c on c.oid = p.polrelid
where c.relname = 'organizations'
order by 2;


-- ============================================================================
-- CHUNK 9: profiles (the recursion-sensitive table, with the null-org fix)
-- ============================================================================
-- SELECT: id = auth.uid() comes FIRST and UNCONDITIONALLY. This is the fix
-- for the old draft's known bug: with a bare organization_id equality, a
-- null-org user could not read their own profile row, fetchProfile silently
-- set null, and every page blanked (the staging grants failure mode). The
-- self clause makes a null org mean "you see only yourself", a degraded
-- session instead of a dead one, and covers any future profile created
-- before org assignment. Superadmins (org null by D1) also read everyone via
-- the role clause.
--
-- INSERT: self only, so invite acceptance (AcceptInvite upserts the user's
-- own row) works. Escalation caveat carried from the original draft: the user
-- sets their own role at creation, bounded by needing a valid invite token,
-- and no worse than the pre-011 posture. The SECURITY DEFINER accept RPC is
-- the proper fix, recorded as a follow-up.
--
-- UPDATE: own row, or superadmin, or admin within their own org (null-guarded
-- on both sides). WITH CHECK mirrors USING so a row cannot be moved out.

drop policy if exists profiles_tenant_select on public.profiles;
create policy profiles_tenant_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.auth_is_superadmin()
    or (organization_id is not null
        and organization_id = public.auth_org_id())
  );
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    id = auth.uid()
    or public.auth_is_superadmin()
    or (public.auth_is_admin_or_above()
        and organization_id is not null
        and organization_id = public.auth_org_id())
  )
  with check (
    id = auth.uid()
    or public.auth_is_superadmin()
    or (public.auth_is_admin_or_above()
        and organization_id is not null
        and organization_id = public.auth_org_id())
  );
drop policy if exists profiles_service_all on public.profiles;
create policy profiles_service_all on public.profiles
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['profiles_tenant_select', 'profiles_self_insert',
                       'profiles_update', 'profiles_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.profiles'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.profiles', pol.polname);
    end if;
  end loop;
end $$;

-- VERIFY (expected, both environments, exactly 4 rows):
--   profiles | profiles_self_insert   | a
--   profiles | profiles_service_all   | *
--   profiles | profiles_tenant_select | r
--   profiles | profiles_update        | w
select c.relname as table_name, p.polname, p.polcmd
from pg_policy p join pg_class c on c.oid = p.polrelid
where c.relname = 'profiles'
order by 2;


-- ============================================================================
-- CHUNK 10: audit_log
-- ============================================================================
-- Dormant table (nothing writes it). Read for admin/superadmin only. The
-- sweep removes the old authenticated INSERT WITH CHECK (true), which let any
-- signed-in user forge audit entries. No UPDATE or DELETE for anyone: an
-- audit log is append-only. It has no bot_id, so it cannot be tenant-scoped
-- without a schema change; recorded future work.

drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select on public.audit_log
  for select to authenticated
  using (public.auth_is_admin_or_above());
drop policy if exists audit_log_service_all on public.audit_log;
create policy audit_log_service_all on public.audit_log
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['audit_log_admin_select', 'audit_log_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.audit_log'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.audit_log', pol.polname);
    end if;
  end loop;
end $$;

-- VERIFY (expected, both environments, exactly 2 rows):
--   audit_log | audit_log_admin_select | r
--   audit_log | audit_log_service_all  | *
select c.relname as table_name, p.polname, p.polcmd
from pg_policy p join pg_class c on c.oid = p.polrelid
where c.relname = 'audit_log'
order by 2;


-- ============================================================================
-- CHUNK 11: invites
-- ============================================================================
-- PRECONDITION: the dashboard deploy at the DEPLOY GATE is live in this
-- environment. This chunk drops the anon listing policy the OLD AcceptInvite
-- depended on.
--
-- What changes and why:
--   - "Anyone can read invite by token" (anon SELECT): DROPPED via the sweep.
--     It permitted listing every pending unexpired invite with its token,
--     role and assigned_bot_id, a tenant-and-role selection primitive for
--     anyone holding the public anon key. Replaced by chunk 4's RPC (D4).
--   - "Anyone can accept their own invite by token" (PUBLIC UPDATE, no
--     auth.uid() anywhere): replaced by invites_accept_own_update, scoped to
--     the authenticated user whose JWT email matches the invite row. Closes
--     the burn-anyone's-invite hole (baseline N-10). The accepting user is
--     always authenticated at that point (AcceptInvite signs in first), and
--     their auth email is the invite email by construction.
--   - Admin policies rebuilt on the helpers, tenant-scoped for non-superadmin:
--     an org admin manages invites tied to their own bots; superadmin manages
--     all, including null-bot invites. A non-superadmin admin can still mint
--     a null-bot invite (current UserManagement UX allows it); the resulting
--     profile has no org and fails closed everywhere until assigned.

drop policy if exists invites_admin_select on public.invites;
create policy invites_admin_select on public.invites
  for select to authenticated
  using (
    public.auth_is_superadmin()
    or (public.auth_is_admin_or_above()
        and assigned_bot_id in (select public.auth_bot_ids()))
  );
drop policy if exists invites_admin_insert on public.invites;
create policy invites_admin_insert on public.invites
  for insert to authenticated
  with check (
    public.auth_is_superadmin()
    or (public.auth_is_admin_or_above()
        and (assigned_bot_id is null
             or assigned_bot_id in (select public.auth_bot_ids())))
  );
drop policy if exists invites_admin_update on public.invites;
create policy invites_admin_update on public.invites
  for update to authenticated
  using (
    public.auth_is_superadmin()
    or (public.auth_is_admin_or_above()
        and assigned_bot_id in (select public.auth_bot_ids()))
  )
  with check (
    public.auth_is_superadmin()
    or (public.auth_is_admin_or_above()
        and (assigned_bot_id is null
             or assigned_bot_id in (select public.auth_bot_ids())))
  );
drop policy if exists invites_accept_own_update on public.invites;
create policy invites_accept_own_update on public.invites
  for update to authenticated
  using (
    status = 'pending'
    and lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  )
  with check (status = 'accepted');
drop policy if exists invites_service_all on public.invites;
create policy invites_service_all on public.invites
  for all to service_role using (true) with check (true);

do $$
declare pol record;
  keep text[] := array['invites_admin_select', 'invites_admin_insert',
                       'invites_admin_update', 'invites_accept_own_update',
                       'invites_service_all'];
begin
  for pol in select polname from pg_policy
             where polrelid = 'public.invites'::regclass loop
    if not (pol.polname = any(keep)) then
      execute format('drop policy if exists %I on public.invites', pol.polname);
    end if;
  end loop;
end $$;

-- VERIFY (expected, both environments, exactly 5 rows):
--   invites | invites_accept_own_update | w
--   invites | invites_admin_insert      | a
--   invites | invites_admin_select      | r
--   invites | invites_admin_update      | w
--   invites | invites_service_all       | *
select c.relname as table_name, p.polname, p.polcmd
from pg_policy p join pg_class c on c.oid = p.polrelid
where c.relname = 'invites'
order by 2;


-- ============================================================================
-- CHUNK 12: enable RLS
-- ============================================================================
-- Idempotent. On production this is a no-op (RLS already on everywhere). On
-- staging this is the moment the policies above go live, and the first time
-- the full end state has ever run anywhere, which is the point of staging.
-- After this chunk on staging, run the behavioral matrix before touching
-- production.

alter table public.conversations         enable row level security;
alter table public.reviews               enable row level security;
alter table public.learnings             enable row level security;
alter table public.bot_documents         enable row level security;
alter table public.prompt_versions       enable row level security;
alter table public.reconciliation_queue  enable row level security;
alter table public.coach_flag_reasons    enable row level security;
alter table public.conversation_examples enable row level security;
alter table public.bots                  enable row level security;
alter table public.organizations         enable row level security;
alter table public.profiles              enable row level security;
alter table public.audit_log             enable row level security;
alter table public.invites               enable row level security;

-- VERIFY (expected, both environments: 16 rows, rls_enabled TRUE on every
-- one; policy_count 0 only on connected_accounts and data_deletion_requests,
-- which deny by design):
--   audit_log 2, bot_documents 5, bots 3, coach_flag_reasons 3,
--   connected_accounts 0, conversation_examples 2, conversations 4,
--   data_deletion_requests 0, invites 5, learnings 3, organizations 2,
--   profiles 4, prompt_versions 3, reconciliation_queue 4, reviews 4,
--   waitlist_applications 2
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;


-- ============================================================================
-- CHUNK 13: anon table grant revokes (D5, defence in depth)
-- ============================================================================
-- PRECONDITION: chunk 4 (the RPC) is applied and the dashboard deploy is
-- live. After this chunk the anon role reaches nothing at the table level;
-- its only remaining surface is auth endpoints and EXECUTE on lookup_invite.
-- A future mis-scoped policy (the conversation_examples class of bug) then
-- exposes nothing, because Postgres checks the grant before the policy.
--
-- On staging this is a no-op (anon has no grants there), run for parity.
-- Legitimate anon usage audited before this was written: the dashboard
-- pre-login touches only /auth/v1 endpoints, AcceptInvite uses the RPC, the
-- waitlist form inserts through the Pages Function on the service key, and
-- the Worker uses the anon key only against /auth/v1/user. No table reads.
--
-- NOTE: this covers existing tables. Supabase's default privileges will still
-- grant anon on FUTURE tables; per-table revoke stays part of every new
-- table's migration (the 010/012 pattern), and altering default privileges is
-- recorded as follow-up work.

revoke all on public.audit_log              from anon;
revoke all on public.bot_documents          from anon;
revoke all on public.bots                   from anon;
revoke all on public.coach_flag_reasons     from anon;
revoke all on public.connected_accounts     from anon;
revoke all on public.conversation_examples  from anon;
revoke all on public.conversations          from anon;
revoke all on public.data_deletion_requests from anon;
revoke all on public.invites                from anon;
revoke all on public.learnings              from anon;
revoke all on public.organizations          from anon;
revoke all on public.profiles               from anon;
revoke all on public.prompt_versions        from anon;
revoke all on public.reconciliation_queue   from anon;
revoke all on public.reviews                from anon;
revoke all on public.waitlist_applications  from anon;

notify pgrst, 'reload schema';

-- VERIFY (expected, both environments: ZERO ROWS):
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
order by 1;


-- ============================================================================
-- BOOKKEEPING, after all chunks (production only): paste migration file
-- db/migrations/014_revoke_waitlist_authenticated.sql as-is. Its effect has
-- been live since 2026-08-19 (run out of band); executing the file is a
-- documented no-op that lets the migration chain own the change. Closes
-- baseline item N-6.
-- ============================================================================
