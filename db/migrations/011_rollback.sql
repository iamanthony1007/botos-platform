-- ============================================================================
-- Migration 011 (v2) ROLLBACK
-- ============================================================================
-- Restores the pre-011 policy posture, reconstructed VERBATIM from the live
-- production baseline read on 2026-08-29 (docs/MULTI-TENANCY-PHASE-0-BASELINE
-- .md), not from memory. This DELIBERATELY restores the INSECURE permissive
-- state: authenticated USING (true) on the core tables, the exact
-- cross-tenant hole 011 exists to close. It exists so that if 011 locks the
-- platform owner out of her dashboard, access is restored with a paste rather
-- than a debugging session in production. Do NOT mistake this file for a good
-- configuration. Re-apply 011 once the lockout cause is understood.
--
-- Idempotent and single-paste: unlike 011 it is safe to run in one go, since
-- every policy it creates is permissive (a partial application cannot lock
-- anyone out, only leave some tables still tenant-scoped).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT RESTORE:
--   1. "Service role full access" on conversation_examples. That policy was
--      the PUBLIC-scoped hole dropped on production 2026-08-29, before 011.
--      It was a bug, not a posture. It stays dead.
--   2. Anon table grants (011 chunk 13 revokes). Nothing legitimate ever used
--      them: pre-login the dashboard touches only auth endpoints, invite
--      lookup goes through the RPC, waitlist inserts via the Pages Function
--      on the service key. Restoring blanket anon grants in an emergency is
--      strictly more surface for zero function. Consequence: the restored
--      "Anyone can read invite by token" anon policy is inert at the grant
--      level, which is fine because the deployed AcceptInvite uses the RPC.
--   3. The chunk 2/3 data changes (the Bombers Blueprint organization, the
--      bot repoint, the profile org backfill). Data, not policy; harmless
--      under permissive policies; reverting it carries its own risk.
--   4. The lookup_invite RPC. The deployed dashboard calls it. It reads one
--      row by exact token and returns no token material; keeping it costs
--      nothing under any posture.
--   5. RLS enablement state. Production had RLS ON everywhere before 011 and
--      keeps it. On staging this rollback leaves RLS ON with permissive
--      policies, which is behaviorally identical for the dashboard to the old
--      RLS-off state (and closer to production than staging ever was).
--
-- Rehearse on staging before production ever needs it, per the plan.

-- ----------------------------------------------------------------------------
-- 1. Drop every current policy on the 13 tables 011 touches (by iteration,
--    never by name), then the helper functions (safe only after the policies
--    that reference them are gone).
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  pol record;
  targets text[] := array[
    'conversations', 'reviews', 'learnings', 'bot_documents', 'prompt_versions',
    'reconciliation_queue', 'coach_flag_reasons', 'conversation_examples',
    'bots', 'organizations', 'profiles', 'audit_log', 'invites'
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

-- ----------------------------------------------------------------------------
-- 2. Recreate the pre-011 production policies, names and expressions from the
--    2026-08-29 baseline.
-- ----------------------------------------------------------------------------

-- conversations
create policy "Authenticated can read conversations" on public.conversations
  for select to authenticated using (true);
create policy "Authenticated can insert conversations" on public.conversations
  for insert to authenticated with check (true);
create policy "Authenticated can update conversations" on public.conversations
  for update to authenticated using (true);

-- reviews
create policy "Authenticated can read reviews" on public.reviews
  for select to authenticated using (true);
create policy "Authenticated can insert reviews" on public.reviews
  for insert to authenticated with check (true);
create policy "Authenticated can update reviews" on public.reviews
  for update to authenticated using (true);

-- learnings
create policy "Authenticated can read learnings" on public.learnings
  for select to authenticated using (true);
create policy "Authenticated can insert learnings" on public.learnings
  for insert to authenticated with check (true);

-- bot_documents
create policy "Authenticated can read bot_documents" on public.bot_documents
  for select to authenticated using (true);
create policy "Authenticated can insert bot_documents" on public.bot_documents
  for insert to authenticated with check (true);
create policy "Authenticated can update bot_documents" on public.bot_documents
  for update to authenticated using (true);
create policy "Authenticated can delete bot_documents" on public.bot_documents
  for delete to authenticated using (true);

-- prompt_versions
create policy "Authenticated can read prompt_versions" on public.prompt_versions
  for select to authenticated using (true);
create policy "Authenticated can insert prompt_versions" on public.prompt_versions
  for insert to authenticated with check (true);

-- reconciliation_queue
create policy "Authenticated can read reconciliation_queue" on public.reconciliation_queue
  for select to authenticated using (true);
create policy "Authenticated can insert reconciliation_queue" on public.reconciliation_queue
  for insert to authenticated with check (true);
create policy "Authenticated can update reconciliation_queue" on public.reconciliation_queue
  for update to authenticated using (true);

-- coach_flag_reasons
create policy "Authenticated users can read coach_flag_reasons" on public.coach_flag_reasons
  for select to authenticated using (true);
create policy "Authenticated users can insert coach_flag_reasons" on public.coach_flag_reasons
  for insert to authenticated with check (true);

-- conversation_examples: the two original scoped policies, PUBLIC-roled and
-- inline-subquery exactly as production had them. The third ("Service role
-- full access") stays dead, see header. service_role itself needs no policy
-- (BYPASSRLS), which is also why the Worker was never affected.
create policy "Clients read examples" on public.conversation_examples
  for select
  using (
    bot_id in (
      select profiles.assigned_bot_id from public.profiles
      where profiles.id = auth.uid() and profiles.assigned_bot_id is not null
    )
  );
create policy "Admins read examples" on public.conversation_examples
  for select
  using (
    bot_id in (
      select b.id
      from public.bots b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
        and (p.role = 'admin' or p.role = 'superadmin')
    )
  );

-- bots
create policy "Authenticated can read bots" on public.bots
  for select to authenticated using (true);
create policy "Authenticated can update bots" on public.bots
  for update to authenticated using (true);

-- organizations
create policy "Authenticated can read organizations" on public.organizations
  for select to authenticated using (true);

-- profiles
create policy "Authenticated users can read profiles" on public.profiles
  for select to authenticated using (true);
create policy "Users can insert own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id);
create policy "Admins can update any profile" on public.profiles
  for update
  using (
    exists (
      select 1 from public.profiles profiles_1
      where profiles_1.id = auth.uid()
        and profiles_1.role = any (array['admin'::text, 'superadmin'::text])
    )
  );

-- audit_log (restored faithfully, forgeable INSERT included: this file's
-- contract is the pre-011 state, not a better one)
create policy "Authenticated can read audit_log" on public.audit_log
  for select to authenticated using (true);
create policy "Authenticated can insert audit_log" on public.audit_log
  for insert to authenticated with check (true);

-- invites: all five originals. The anon listing policy comes back inert on
-- any environment where chunk 13's anon revoke has run (grant checked before
-- policy); the accept-by-token PUBLIC policy is what the accept flow's
-- authenticated UPDATE rides on.
create policy "Admins can view invites" on public.invites
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin'::text, 'superadmin'::text])
    )
  );
create policy "Admins can insert invites" on public.invites
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin'::text, 'superadmin'::text])
    )
  );
create policy "Admins can update invites" on public.invites
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin'::text, 'superadmin'::text])
    )
  );
create policy "Anyone can read invite by token" on public.invites
  for select to anon
  using (status = 'pending'::text and expires_at > now());
create policy "Anyone can accept their own invite by token" on public.invites
  for update
  using (status = 'pending'::text)
  with check (status = 'accepted'::text);

-- ----------------------------------------------------------------------------
-- 3. VERIFY. Expected: 34 policies across the 13 tables, per-table counts
--    audit_log 2, bot_documents 4, bots 2, coach_flag_reasons 2,
--    conversation_examples 2, conversations 3, invites 5, learnings 2,
--    organizations 1, profiles 4, prompt_versions 2, reconciliation_queue 3,
--    reviews 3. Then sign into the dashboard as the superadmin and eyeball
--    the Inbox rendering rows.
-- ----------------------------------------------------------------------------
select c.relname as table_name, count(p.polname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in ('conversations', 'reviews', 'learnings', 'bot_documents',
                    'prompt_versions', 'reconciliation_queue',
                    'coach_flag_reasons', 'conversation_examples', 'bots',
                    'organizations', 'profiles', 'audit_log', 'invites')
group by 1
order by 1;
