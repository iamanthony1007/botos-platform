-- Migration 011: tenant RLS policies
--
-- PURPOSE
-- Close the tenant isolation hole confirmed in Phase 0 / Phase 1. Today every
-- core table has an authenticated policy of USING (true), so any signed-in user
-- can read and write every row regardless of bot_id. The dashboard's
-- .eq('bot_id', ...) filters run in the browser and are not a security boundary.
-- This migration replaces the permissive policies with tenant-scoped ones,
-- following the pattern already used correctly on conversation_examples.
--
-- ROLE MODEL (confirmed with Anthony)
--   superadmin           platform-wide, every bot in every organization
--   admin                every bot in their own organization
--   client, setter       their assigned_bot_id only
--
-- SAFETY
-- The Worker authenticates with SUPABASE_SERVICE_KEY. service_role has
-- BYPASSRLS, verified on production, so none of this touches the Worker. A
-- belt-and-braces service_role policy is added to each table anyway, matching
-- the existing conversation_examples table.
--
-- The whole migration is one transaction: data backfill, then a verification
-- gate that aborts on a null organization_id, then helpers, then policies. A
-- partial application is impossible. If anything locks a user out, apply
-- db/migrations/011_rollback.sql.
--
-- NOT in this phase: the Worker BOT_ID constant, tenant routing through
-- connected_accounts, the invites anon-update gap, and adding bot_id to
-- audit_log. All logged separately.

begin;

-- ============================================================================
-- PART 1: DATA MIGRATION (must run before the policies, which depend on it)
-- ============================================================================

-- 1a. Give Bombers Blueprint its own organization.
-- It currently sits under "Nella Platform" (...0001), which is the PLATFORM
-- organization that superadmins belong to, not a client org. Create a dedicated
-- client organization and repoint the bot. id defaults to gen_random_uuid();
-- capture it in a CTE so the insert and the update are atomic (no invented UUID).
with new_org as (
  insert into public.organizations (name)
  values ('Bombers Blueprint')
  returning id
)
update public.bots
set organization_id = (select id from new_org)
where id = '00000000-0000-0000-0000-000000000002';

-- 1b. Backfill profiles.organization_id. It is currently null on all rows, which
-- would make every org-scoped policy match nothing and lock everyone out.
-- The rule is NOT "copy from the assigned bot": that would place Nella, a
-- superadmin, inside the client's organization. Two explicit updates:

-- superadmin -> the platform organization ("Nella Platform")
update public.profiles
set organization_id = '00000000-0000-0000-0000-000000000001'
where role = 'superadmin';

-- everyone else -> the organization of their assigned bot
update public.profiles p
set organization_id = b.organization_id
from public.bots b
where p.assigned_bot_id = b.id
  and p.role is distinct from 'superadmin';

-- 1c. Verify before any policy is created. If a single profile still has a null
-- organization_id, abort the whole transaction rather than commit policies that
-- lock someone out.
do $$
declare
  null_count int;
begin
  select count(*) into null_count
  from public.profiles
  where organization_id is null;
  if null_count > 0 then
    raise exception
      'Aborting migration 011: % profile row(s) still have a null organization_id after backfill.',
      null_count;
  end if;
end $$;

-- ============================================================================
-- PART 2: HELPER FUNCTIONS
-- ============================================================================
-- STABLE SECURITY DEFINER functions, evaluated once per query, not per row.
-- SECURITY DEFINER is essential: these read public.profiles, and once profiles
-- itself has restrictive policies, an inline subquery on profiles inside another
-- table's policy would trigger profiles RLS and recurse or silently return
-- nothing. Running as the (superuser) owner bypasses that. search_path is pinned
-- and execute is revoked from public and granted only to authenticated.

create or replace function public.auth_is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'superadmin'
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
    where id = auth.uid() and role in ('admin', 'superadmin')
  );
$$;

create or replace function public.auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

-- Every bot the current user may access:
--   superadmin -> all bots
--   admin      -> all bots in their organization
--   others     -> just their assigned_bot_id
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
    and b.organization_id = public.auth_org_id()
  union
  select p.assigned_bot_id from public.profiles p
  where p.id = auth.uid() and p.assigned_bot_id is not null;
$$;

revoke execute on function public.auth_is_superadmin()      from public;
revoke execute on function public.auth_is_admin_or_above()  from public;
revoke execute on function public.auth_org_id()             from public;
revoke execute on function public.auth_bot_ids()            from public;
grant  execute on function public.auth_is_superadmin()      to authenticated;
grant  execute on function public.auth_is_admin_or_above()  to authenticated;
grant  execute on function public.auth_org_id()             to authenticated;
grant  execute on function public.auth_bot_ids()            to authenticated;

-- ============================================================================
-- PART 3: POLICIES
-- ============================================================================

-- 3a. Ensure RLS is enabled on every target table (idempotent), then drop ALL
-- existing policies on those tables by iterating pg_policy. This is stronger
-- than dropping by name: policies are OR'd together, so a single surviving
-- USING (true) would defeat every restrictive policy beside it, and a name typo
-- in a hardcoded drop list is exactly how that happens. invites and
-- connected_accounts are deliberately NOT in this list and are left untouched.
do $$
declare
  t text;
  pol record;
  targets text[] := array[
    'conversations', 'reviews', 'learnings', 'bot_documents', 'prompt_versions',
    'reconciliation_queue', 'coach_flag_reasons', 'conversation_examples',
    'bots', 'waitlist_applications', 'organizations', 'profiles', 'audit_log'
  ];
begin
  foreach t in array targets loop
    execute format('alter table public.%I enable row level security', t);
    for pol in
      select polname from pg_policy where polrelid = ('public.' || t)::regclass
    loop
      execute format('drop policy if exists %I on public.%I', pol.polname, t);
    end loop;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Bot-scoped tables. Row visibility follows bot_id membership. UPDATE carries
-- WITH CHECK as well as USING, so a row cannot be moved to another tenant.
-- Command sets match what the dashboard actually does today (Step 1a inventory)
-- plus what RLS allowed before, minus the cross-tenant reach.
-- ----------------------------------------------------------------------------

-- conversations: setter/client read, insert, and update their bot's rows.
create policy conversations_tenant_select on public.conversations
  for select to authenticated using (bot_id in (select public.auth_bot_ids()));
create policy conversations_tenant_insert on public.conversations
  for insert to authenticated with check (bot_id in (select public.auth_bot_ids()));
create policy conversations_tenant_update on public.conversations
  for update to authenticated
  using (bot_id in (select public.auth_bot_ids()))
  with check (bot_id in (select public.auth_bot_ids()));
create policy conversations_service_all on public.conversations
  for all to service_role using (true) with check (true);

-- reviews: same shape (approve / edit / discard write here).
create policy reviews_tenant_select on public.reviews
  for select to authenticated using (bot_id in (select public.auth_bot_ids()));
create policy reviews_tenant_insert on public.reviews
  for insert to authenticated with check (bot_id in (select public.auth_bot_ids()));
create policy reviews_tenant_update on public.reviews
  for update to authenticated
  using (bot_id in (select public.auth_bot_ids()))
  with check (bot_id in (select public.auth_bot_ids()));
create policy reviews_service_all on public.reviews
  for all to service_role using (true) with check (true);

-- learnings: read and insert (Save and Train). No update/delete from the dashboard.
create policy learnings_tenant_select on public.learnings
  for select to authenticated using (bot_id in (select public.auth_bot_ids()));
create policy learnings_tenant_insert on public.learnings
  for insert to authenticated with check (bot_id in (select public.auth_bot_ids()));
create policy learnings_service_all on public.learnings
  for all to service_role using (true) with check (true);

-- bot_documents: the only table the dashboard deletes from (Documents page).
create policy bot_documents_tenant_select on public.bot_documents
  for select to authenticated using (bot_id in (select public.auth_bot_ids()));
create policy bot_documents_tenant_insert on public.bot_documents
  for insert to authenticated with check (bot_id in (select public.auth_bot_ids()));
create policy bot_documents_tenant_update on public.bot_documents
  for update to authenticated
  using (bot_id in (select public.auth_bot_ids()))
  with check (bot_id in (select public.auth_bot_ids()));
create policy bot_documents_tenant_delete on public.bot_documents
  for delete to authenticated using (bot_id in (select public.auth_bot_ids()));
create policy bot_documents_service_all on public.bot_documents
  for all to service_role using (true) with check (true);

-- prompt_versions: read and insert (a new version is written when a prompt is
-- saved or trained). Tenant-scoped INSERT, matching the bots UPDATE decision:
-- the boundary is tenant, not role.
create policy prompt_versions_tenant_select on public.prompt_versions
  for select to authenticated using (bot_id in (select public.auth_bot_ids()));
create policy prompt_versions_tenant_insert on public.prompt_versions
  for insert to authenticated with check (bot_id in (select public.auth_bot_ids()));
create policy prompt_versions_service_all on public.prompt_versions
  for all to service_role using (true) with check (true);

-- reconciliation_queue: bot-scoped. Written by the Worker (service key), read by
-- the dashboard. Keep select/insert/update tenant-scoped to match prior access.
create policy reconciliation_queue_tenant_select on public.reconciliation_queue
  for select to authenticated using (bot_id in (select public.auth_bot_ids()));
create policy reconciliation_queue_tenant_insert on public.reconciliation_queue
  for insert to authenticated with check (bot_id in (select public.auth_bot_ids()));
create policy reconciliation_queue_tenant_update on public.reconciliation_queue
  for update to authenticated
  using (bot_id in (select public.auth_bot_ids()))
  with check (bot_id in (select public.auth_bot_ids()));
create policy reconciliation_queue_service_all on public.reconciliation_queue
  for all to service_role using (true) with check (true);

-- coach_flag_reasons: read and insert (flag / unflag for coach logs an event).
create policy coach_flag_reasons_tenant_select on public.coach_flag_reasons
  for select to authenticated using (bot_id in (select public.auth_bot_ids()));
create policy coach_flag_reasons_tenant_insert on public.coach_flag_reasons
  for insert to authenticated with check (bot_id in (select public.auth_bot_ids()));
create policy coach_flag_reasons_service_all on public.coach_flag_reasons
  for all to service_role using (true) with check (true);

-- conversation_examples: read only from the dashboard (Tester library). This is
-- the table that was already scoped correctly with an inline profiles subquery;
-- it is rewritten onto the helpers here so it does not recurse once profiles is
-- locked down.
create policy conversation_examples_tenant_select on public.conversation_examples
  for select to authenticated using (bot_id in (select public.auth_bot_ids()));
create policy conversation_examples_service_all on public.conversation_examples
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- bots: its tenant column is its own id, not bot_id. SELECT and UPDATE are
-- scoped to the bots the user may access. Per Anthony's decision, UPDATE is
-- tenant-scoped, not role-restricted: a client editing their own bot's prompt is
-- the product working as designed. NOTE: this means RLS no longer stops a setter
-- from updating bots; the client-side permission gates (prompt_editor,
-- train_bot, settings_admin) are the only control there. That is an in-tenant
-- privilege matter for the permissions model, not a cross-tenant one.
-- ----------------------------------------------------------------------------
create policy bots_tenant_select on public.bots
  for select to authenticated using (id in (select public.auth_bot_ids()));
create policy bots_tenant_update on public.bots
  for update to authenticated
  using (id in (select public.auth_bot_ids()))
  with check (id in (select public.auth_bot_ids()));
create policy bots_service_all on public.bots
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- waitlist_applications: platform-level, no bot_id. Restrict to admin/superadmin
-- for select and update. This closes the gap logged in migration 010 (every
-- signed-in user, including setters, could read all applicant PII). Inserts come
-- from the Pages Function using the service key, so no authenticated INSERT.
-- ----------------------------------------------------------------------------
create policy waitlist_admin_select on public.waitlist_applications
  for select to authenticated using (public.auth_is_admin_or_above());
create policy waitlist_admin_update on public.waitlist_applications
  for update to authenticated
  using (public.auth_is_admin_or_above())
  with check (public.auth_is_admin_or_above());
create policy waitlist_service_all on public.waitlist_applications
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- organizations: a user sees their own organization; superadmin sees all.
-- ----------------------------------------------------------------------------
create policy organizations_tenant_select on public.organizations
  for select to authenticated
  using (id = public.auth_org_id() or public.auth_is_superadmin());
create policy organizations_service_all on public.organizations
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- profiles: the recursion-sensitive table. All checks go through the helpers.
--   SELECT: same organization, or superadmin sees all. NOT self-only, because
--           the Inbox renders other users' names and self-only would blank them.
--   INSERT: self only (id = auth.uid()), so invite acceptance (AcceptInvite
--           upserts the user's own row) works. Escalation caveat: this lets a
--           user set their own role at creation. It is bounded by needing a
--           valid invite token and already existed under USING (true), so it is
--           no worse than today. A SECURITY DEFINER invite-acceptance RPC is the
--           proper fix and is logged as a real follow-up.
--   UPDATE: own row, or superadmin (any), or admin (same organization). WITH
--           CHECK mirrors USING so a row cannot be moved to another org.
-- ----------------------------------------------------------------------------
create policy profiles_tenant_select on public.profiles
  for select to authenticated
  using (organization_id = public.auth_org_id() or public.auth_is_superadmin());
create policy profiles_self_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    id = auth.uid()
    or public.auth_is_superadmin()
    or (public.auth_is_admin_or_above() and organization_id = public.auth_org_id())
  )
  with check (
    id = auth.uid()
    or public.auth_is_superadmin()
    or (public.auth_is_admin_or_above() and organization_id = public.auth_org_id())
  );
create policy profiles_service_all on public.profiles
  for all to service_role using (true) with check (true);

-- ----------------------------------------------------------------------------
-- audit_log: dormant (nothing writes it: not the Worker, not the dashboard, no
-- trigger). Read for admin/superadmin only (a security artifact, least
-- privilege). No INSERT for authenticated (the old WITH CHECK (true) let any
-- signed-in user forge audit entries). No UPDATE or DELETE for anyone: an audit
-- log is append-only. It has no bot_id, so it cannot be tenant-scoped without a
-- schema change, logged as future work.
-- ----------------------------------------------------------------------------
create policy audit_log_admin_select on public.audit_log
  for select to authenticated using (public.auth_is_admin_or_above());
create policy audit_log_service_all on public.audit_log
  for all to service_role using (true) with check (true);

commit;
