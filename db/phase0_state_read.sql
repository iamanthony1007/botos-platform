-- ============================================================================
-- Phase 0 state read: multi-tenant Phase 1 (RLS) baseline
-- ============================================================================
-- READ ONLY. Nothing here writes, alters, drops, grants or revokes. Every
-- statement is a SELECT. Safe to run on production during business hours.
--
-- Run in the Supabase SQL editor against BOTH projects and paste the output
-- back:
--   production  rydkwsjwlgnivlwlvqku
--   staging     hlpucysbaqerhwahfolg
--
-- WHY THIS FILE EXISTS. PostgREST cannot read the system catalogs, so the RLS
-- and grant state can only be read from the SQL editor. The Supabase MCP
-- server available to the Claude session authenticates to an unrelated
-- account and cannot see either project, so there is no automated route.
--
-- WHY ONE BIG QUERY. The Supabase SQL editor returns only the LAST result set
-- when several statements are run together. PART 1 is therefore a single
-- SELECT returning one cell of JSON holding every answer at once: one paste,
-- one copy, per environment. If it errors for any reason, PART 2 has the same
-- questions as seven small independent queries to run one at a time.
--
-- NO SECRET IS SELECTED ANYWHERE IN THIS FILE. Specifically:
--   connected_accounts.access_token_encrypted   never referenced
--   bots.system_prompt                          length only, never content
--   invites.token                               never selected (counts only)
-- Profile emails ARE returned, because the backfill map needs them.
-- ============================================================================


-- ============================================================================
-- PART 1: the whole baseline, one paste, one JSON cell
-- ============================================================================
-- Copy the single returned cell in full. In the Supabase editor, click the
-- cell and use the copy control rather than selecting text by hand, otherwise
-- long output gets truncated.

select jsonb_pretty(jsonb_build_object(

  'probe',    'phase0-refresh',
  'database', current_database(),
  'run_at',   now(),

  -- A. Every table in public, its RLS flag, and how many policies it carries.
  -- Any table here that is not in the Phase 0 refresh Section 2 list is an
  -- out-of-band creation and needs its own decision.
  'a_tables', (
    select coalesce(jsonb_agg(x order by x->>'table_name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'table_name',   c.relname,
        'rls_enabled',  c.relrowsecurity,
        'rls_forced',   c.relforcerowsecurity,
        'policy_count', (select count(*) from pg_policy p where p.polrelid = c.oid)
      ) as x
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    ) s
  ),

  -- B. Every policy in full, including the USING and WITH CHECK expressions
  -- and which roles it applies to. This is the authoritative answer to
  -- "is production still USING (true)".
  'b_policies', (
    select coalesce(jsonb_agg(x order by x->>'table_name', x->>'policy_name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'table_name',  c.relname,
        'policy_name', p.polname,
        'cmd',         p.polcmd::text,
        'kind',        case p.polpermissive when true then 'PERMISSIVE' else 'RESTRICTIVE' end,
        'roles',       coalesce(
                         (select jsonb_agg(r.rolname order by r.rolname)
                          from pg_roles r where r.oid = any(p.polroles)),
                         '["PUBLIC"]'::jsonb),
        'using_expr',  pg_get_expr(p.polqual, p.polrelid),
        'check_expr',  pg_get_expr(p.polwithcheck, p.polrelid)
      ) as x
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
    ) s
  ),

  -- C. Table grants. This matters MORE than the policies on staging, where
  -- the authenticated grants were once found silently stripped. Postgres
  -- checks the grant before the policy, which is why the 014 revoke denies
  -- waitlist_applications without dropping the 010 policies.
  'c_grants', (
    select coalesce(jsonb_agg(x order by x->>'table_name', x->>'grantee'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'table_name', table_name,
        'grantee',    grantee,
        'privs',      string_agg(privilege_type, ', ' order by privilege_type)
      ) as x
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('anon', 'authenticated', 'service_role')
      group by table_name, grantee
    ) s
  ),

  -- D. Every profile, with its org and its assigned bot's org side by side.
  -- This IS the backfill map. Read the `disabled` column: disabled rows are
  -- not active accounts and must not be allowed to abort the migration.
  -- to_jsonb returns every column, so a schema drift between environments
  -- shows up as extra or missing keys rather than as a query error.
  'd_profiles', case when to_regclass('public.profiles') is null then '"table missing"'::jsonb else (
    select coalesce(jsonb_agg(
             to_jsonb(p) || jsonb_build_object(
               '_org_name',   o.name,
               '_bot_name',   b.name,
               '_bot_org_id', b.organization_id
             ) order by p.role, p.created_at), '[]'::jsonb)
    from public.profiles p
    left join public.organizations o on o.id = p.organization_id
    left join public.bots b on b.id = p.assigned_bot_id
  ) end,

  -- E. Orgs and bots. FULL OUTER JOIN on purpose: it surfaces an org with no
  -- bot AND a bot with no org, both of which are live hazards here. Answers
  -- whether a Bombers Blueprint org already exists (which decides the fate of
  -- draft 011 Part 1a), what the SuperYOU bot id is, and whether its prompt
  -- is still a placeholder. The three large text columns are stripped; the
  -- prompt is reported as a length only.
  'e_orgs_bots', case when to_regclass('public.bots') is null then '"table missing"'::jsonb else (
    select coalesce(jsonb_agg(
             jsonb_build_object(
               '_org_id',         o.id,
               '_org_name',       o.name,
               '_org_created_at', o.created_at
             )
             || case when b.id is null then jsonb_build_object('_bot', null)
                else (to_jsonb(b) - 'system_prompt' - 'intent_definitions' - 'welcome_context')
                     || jsonb_build_object(
                          '_prompt_len',   length(b.system_prompt),
                          '_prompt_empty', (b.system_prompt is null
                                            or length(btrim(b.system_prompt)) = 0))
                end), '[]'::jsonb)
    from public.organizations o
    full outer join public.bots b on b.organization_id = o.id
  ) end,

  -- F. Helper preflight. Expect an empty array on both. A non-empty result
  -- means a previous attempt left functions behind, and the migration must
  -- drop them explicitly rather than rely on `create or replace`, which would
  -- silently keep a wrong owner or an unpinned search_path.
  'f_helpers', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'proname',          p.proname,
             'security_definer', p.prosecdef,
             'volatility',       p.provolatile::text,
             'config',           p.proconfig,
             'owner',            pg_get_userbyid(p.proowner))), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('auth_is_superadmin', 'auth_is_admin_or_above',
                        'auth_org_id', 'auth_bot_ids')
  ),

  -- G. Roles. Confirms service_role really has BYPASSRLS on this project.
  -- The whole "this migration does not touch the Worker" claim rests on it,
  -- so verify rather than inherit the assertion.
  'g_roles', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'rolname',   rolname,
             'bypassrls', rolbypassrls,
             'canlogin',  rolcanlogin) order by rolname), '[]'::jsonb)
    from pg_roles
    where rolname in ('anon', 'authenticated', 'service_role',
                      'authenticator', 'postgres')
  ),

  -- H. The backfill gate, previewed now. This is the exact query the
  -- migration will run between the backfill chunk and the policy chunks.
  -- Today it shows the size of the backfill. After the backfill it must
  -- return an empty array before any policy is created.
  'h_active_profiles_null_org', case when to_regclass('public.profiles') is null then '"table missing"'::jsonb else (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',              id,
             'email',           email,
             'role',            role,
             'assigned_bot_id', assigned_bot_id)), '[]'::jsonb)
    from public.profiles
    where organization_id is null
      and coalesce(disabled, false) = false
  ) end,

  -- I. invites: counts only, no token material. Section 8.1 of the Phase 0
  -- refresh turns on whether RLS is off on this table, which a_tables
  -- answers. This is just the scale of what a pending token would expose.
  'i_invites', case when to_regclass('public.invites') is null then '"table missing"'::jsonb else (
    select jsonb_build_object(
      'total',            count(*),
      'pending',          count(*) filter (where status = 'pending'),
      'pending_unexpired', count(*) filter (where status = 'pending'
                                              and (expires_at is null or expires_at > now()))
    )
    from public.invites
  ) end

));


-- ============================================================================
-- PART 2: fallback, the same questions as seven independent queries
-- ============================================================================
-- Only needed if PART 1 errors. Run these ONE AT A TIME (the editor shows
-- only the last result set) and paste each result.

-- A. tables, RLS flag, policy count
-- select c.relname as table_name, c.relrowsecurity as rls_enabled,
--        c.relforcerowsecurity as rls_forced,
--        (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relkind = 'r'
-- order by 1;

-- B. every policy in full
-- select c.relname as table_name, p.polname as policy_name, p.polcmd as cmd,
--        case p.polpermissive when true then 'PERMISSIVE' else 'RESTRICTIVE' end as kind,
--        array(select rolname from pg_roles where oid = any(p.polroles)) as roles,
--        pg_get_expr(p.polqual, p.polrelid) as using_expr,
--        pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
-- from pg_policy p
-- join pg_class c on c.oid = p.polrelid
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public'
-- order by 1, 2;

-- C. table grants
-- select table_name, grantee,
--        string_agg(privilege_type, ', ' order by privilege_type) as privs
-- from information_schema.role_table_grants
-- where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
-- group by 1, 2 order by 1, 2;

-- D. profiles, the backfill map
-- select p.id, p.email, p.role, p.disabled, p.organization_id, o.name as org_name,
--        p.assigned_bot_id, b.name as bot_name, b.organization_id as bot_org_id,
--        p.permissions, p.created_at
-- from public.profiles p
-- left join public.organizations o on o.id = p.organization_id
-- left join public.bots b on b.id = p.assigned_bot_id
-- order by p.role, p.created_at;

-- E. orgs and bots
-- select o.id as org_id, o.name as org_name, o.created_at,
--        b.id as bot_id, b.name as bot_name, b.auto_send_enabled, b.stage_automation,
--        (b.system_prompt is null or length(btrim(b.system_prompt)) = 0) as prompt_empty,
--        length(b.system_prompt) as prompt_len
-- from public.organizations o
-- full outer join public.bots b on b.organization_id = o.id
-- order by o.name nulls last, b.name nulls last;

-- F. helper preflight
-- select p.proname, p.prosecdef as security_definer, p.provolatile as volatility,
--        p.proconfig, pg_get_userbyid(p.proowner) as owner
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('auth_is_superadmin','auth_is_admin_or_above','auth_org_id','auth_bot_ids');

-- G. roles
-- select rolname, rolbypassrls, rolcanlogin from pg_roles
-- where rolname in ('anon','authenticated','service_role','authenticator','postgres')
-- order by rolname;

-- H. the backfill gate
-- select id, email, role, disabled, organization_id, assigned_bot_id
-- from public.profiles where organization_id is null and coalesce(disabled, false) = false;


-- ============================================================================
-- OPTIONAL: per-bot row counts, for the verification matrix baseline
-- ============================================================================
-- Run this on PRODUCTION only, and only if you want the "before" numbers the
-- behavioural matrix compares against (matrix row 3 needs the count that a
-- demo-tenant session can currently see across another tenant's rows).
-- Kept out of PART 1 because a missing table here would fail the whole probe.
--
-- select b.id as bot_id, b.name as bot_name,
--        (select count(*) from public.conversations c where c.bot_id = b.id) as conversations,
--        (select count(*) from public.reviews r where r.bot_id = b.id) as reviews,
--        (select count(*) from public.learnings l where l.bot_id = b.id) as learnings,
--        (select count(*) from public.bot_documents d where d.bot_id = b.id) as documents
-- from public.bots b order by b.name;
