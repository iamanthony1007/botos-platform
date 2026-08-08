-- Migration 011 ROLLBACK
--
-- Restores the pre-011 policy configuration. This DELIBERATELY restores the
-- INSECURE state: authenticated USING (true) on the core tables, which is the
-- exact cross-tenant hole that 011 exists to close. It is here so that if 011
-- locks the platform owner out of her dashboard, access is restored with a
-- single paste rather than a debugging session in production. Do NOT mistake
-- this file for a good configuration. Re-apply 011 once the lockout cause is
-- understood and fixed.
--
-- This undoes only the policies and helper functions. It does NOT revert the
-- Part 1 data migration from 011 (the Bombers Blueprint organization and the
-- profiles.organization_id backfill). That data is harmless under permissive
-- policies, and reverting it carries its own risk.

begin;

-- 1. Drop every 011 policy on the target tables (name-independent), then the helpers.
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
    for pol in
      select polname from pg_policy where polrelid = ('public.' || t)::regclass
    loop
      execute format('drop policy if exists %I on public.%I', pol.polname, t);
    end loop;
  end loop;
end $$;

drop function if exists public.auth_bot_ids();
drop function if exists public.auth_org_id();
drop function if exists public.auth_is_admin_or_above();
drop function if exists public.auth_is_superadmin();

-- 2. Recreate the pre-011 permissive policies (all for the authenticated role).

-- conversations: select / insert / update, all permissive
create policy conversations_authenticated_select on public.conversations for select to authenticated using (true);
create policy conversations_authenticated_insert on public.conversations for insert to authenticated with check (true);
create policy conversations_authenticated_update on public.conversations for update to authenticated using (true) with check (true);

-- reviews
create policy reviews_authenticated_select on public.reviews for select to authenticated using (true);
create policy reviews_authenticated_insert on public.reviews for insert to authenticated with check (true);
create policy reviews_authenticated_update on public.reviews for update to authenticated using (true) with check (true);

-- learnings
create policy learnings_authenticated_select on public.learnings for select to authenticated using (true);
create policy learnings_authenticated_insert on public.learnings for insert to authenticated with check (true);

-- bot_documents (had a delete policy too)
create policy bot_documents_authenticated_select on public.bot_documents for select to authenticated using (true);
create policy bot_documents_authenticated_insert on public.bot_documents for insert to authenticated with check (true);
create policy bot_documents_authenticated_update on public.bot_documents for update to authenticated using (true) with check (true);
create policy bot_documents_authenticated_delete on public.bot_documents for delete to authenticated using (true);

-- prompt_versions
create policy prompt_versions_authenticated_select on public.prompt_versions for select to authenticated using (true);
create policy prompt_versions_authenticated_insert on public.prompt_versions for insert to authenticated with check (true);

-- reconciliation_queue
create policy reconciliation_queue_authenticated_select on public.reconciliation_queue for select to authenticated using (true);
create policy reconciliation_queue_authenticated_insert on public.reconciliation_queue for insert to authenticated with check (true);
create policy reconciliation_queue_authenticated_update on public.reconciliation_queue for update to authenticated using (true) with check (true);

-- coach_flag_reasons
create policy coach_flag_reasons_authenticated_select on public.coach_flag_reasons for select to authenticated using (true);
create policy coach_flag_reasons_authenticated_insert on public.coach_flag_reasons for insert to authenticated with check (true);

-- conversation_examples: restore the ORIGINAL scoped policies (the one table that
-- was already correct), with the inline profiles subqueries it used before 011.
create policy conversation_examples_client_select on public.conversation_examples
  for select to authenticated
  using (
    bot_id in (
      select profiles.assigned_bot_id from public.profiles
      where profiles.id = auth.uid() and profiles.assigned_bot_id is not null
    )
  );
create policy conversation_examples_admin_select on public.conversation_examples
  for select to authenticated
  using (
    bot_id in (
      select b.id from public.bots b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and (p.role = 'admin' or p.role = 'superadmin')
    )
  );
create policy conversation_examples_service_all on public.conversation_examples
  for all to service_role using (true) with check (true);

-- bots
create policy bots_authenticated_select on public.bots for select to authenticated using (true);
create policy bots_authenticated_update on public.bots for update to authenticated using (true) with check (true);

-- waitlist_applications (restores the migration-010 permissive state)
create policy waitlist_authenticated_select on public.waitlist_applications for select to authenticated using (true);
create policy waitlist_authenticated_update on public.waitlist_applications for update to authenticated using (true) with check (true);

-- organizations
create policy organizations_authenticated_select on public.organizations for select to authenticated using (true);

-- profiles: permissive select, plus the original admin/superadmin update policy
create policy profiles_authenticated_select on public.profiles for select to authenticated using (true);
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p1
      where p1.id = auth.uid() and p1.role = any (array['admin', 'superadmin'])
    )
  );

-- audit_log
create policy audit_log_authenticated_select on public.audit_log for select to authenticated using (true);
create policy audit_log_authenticated_insert on public.audit_log for insert to authenticated with check (true);

commit;
