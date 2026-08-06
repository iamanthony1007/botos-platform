-- Migration 010: waitlist_applications
--
-- NOTE: originally drafted as 009. Renumbered to 010 because
-- 009_add_connected_accounts.sql already occupies that slot (Instagram work).
--
-- Public waitlist form for getmu.co. Writes arrive ONLY through the Cloudflare
-- Pages Function at dashboard/functions/api/waitlist.js, which holds the Supabase
-- service key server-side and therefore bypasses RLS.
--
-- SECURITY MODEL
-- The dashboard ships the Supabase ANON key inside its public JS bundle. Anyone
-- can read that key out of the browser. So the anon role must have NO access to
-- this table at all: no insert, no select, no update, no delete. If anon could
-- select, every application Nella receives (names, emails, revenue figures,
-- Instagram handles) would be publicly readable.
--
-- RLS is enabled below and NO policy is granted to anon. Under Postgres RLS,
-- enabled + no matching policy = deny. That is the intended state. Do not add
-- an anon insert policy "to make the form work" -- the form does not talk to
-- Supabase directly, it posts to the Pages Function.

create table if not exists public.waitlist_applications (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Identity. Nella asked for first/last split even though her Airtable form
  -- used a single "Full Name" field. Needed for personalised email.
  first_name             text not null,
  last_name              text not null,
  email                  text not null,
  business_name          text,
  instagram_handle       text not null,

  -- Business context.
  -- NOTE: the numeric-looking fields below are TEXT on purpose. People answer
  -- "10-20", "2k", "around 5". A numeric column would reject those and the
  -- application would be lost. Never lose an application to a type error.
  what_you_sell          text not null,
  main_offer_price       text not null,
  inbound_leads_per_day  text not null,
  booked_calls_per_week  text not null,
  avg_monthly_revenue    text not null,

  -- Fixed-option fields. Constraints are safe here because the exact strings
  -- are produced by our own form and re-validated in the Pages Function before
  -- insert. If you change an option label in the frontend you MUST change it
  -- here too, or inserts will start failing silently from the user's view.
  lead_source            text not null,
  response_speed         text not null,
  has_dm_script          text not null,
  has_booking_system     text,
  current_crm            text not null,
  team_size              text not null,

  -- Multi-select. Nella's Airtable had this as single-select but the question
  -- says "bottlenecks" plural. Array is the safer choice: storing one value in
  -- an array is trivial, going from single to array later is a migration.
  bottlenecks            text[] not null default '{}',

  -- Long text. The Airtable version required a FILE UPLOAD here. Changed to a
  -- textarea: a public page cannot safely accept unauthenticated file uploads
  -- without becoming an abuse surface, and it is the highest-friction field on
  -- a form aimed at cold Instagram traffic.
  failed_dm_example      text not null,
  anything_else          text,

  -- Pipeline management. Without these the dashboard tab is a read-only list
  -- Nella cannot actually work from.
  status                 text not null default 'new',
  notes                  text,

  -- Abuse forensics. ip_hash is a SHA-256 of the IP, never the raw address:
  -- enough to spot a flood from one source, not personal data at rest.
  ip_hash                text,
  user_agent             text,

  constraint waitlist_lead_source_chk check (
    lead_source in ('Paid Ads', 'Organic', 'Both')
  ),
  constraint waitlist_response_speed_chk check (
    response_speed in ('Less than 5 minutes', 'Less than 1 hour', 'Same day', 'Next day or later')
  ),
  constraint waitlist_dm_script_chk check (
    has_dm_script in ('Yes, we have one that works', 'Yes, but it needs improvement', 'No, we dont have one yet')
  ),
  constraint waitlist_booking_chk check (
    has_booking_system is null
    or has_booking_system in ('Yes', 'No (I need help setting this up)')
  ),
  constraint waitlist_crm_chk check (
    current_crm in ('GoHighLevel', 'HubSpot', 'SalesForce', 'Close.io', 'Airtable', 'Google Sheets', 'None yet')
  ),
  constraint waitlist_team_size_chk check (
    team_size in ('Just me', '1 setter', '2-3 setters', '4+ setters')
  ),
  constraint waitlist_status_chk check (
    status in ('new', 'reviewed', 'contacted', 'accepted', 'rejected')
  ),
  constraint waitlist_email_chk check (
    email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

-- Newest first is the default dashboard view.
create index if not exists waitlist_created_at_idx
  on public.waitlist_applications (created_at desc);

-- "Show me the new ones" is the query she will run most.
create index if not exists waitlist_status_created_idx
  on public.waitlist_applications (status, created_at desc);

-- For spotting repeat applications from the same person.
create index if not exists waitlist_email_idx
  on public.waitlist_applications (lower(email));

-- Keep updated_at honest so the dashboard can sort by recent activity.
create or replace function public.set_waitlist_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists waitlist_set_updated_at on public.waitlist_applications;
create trigger waitlist_set_updated_at
  before update on public.waitlist_applications
  for each row execute function public.set_waitlist_updated_at();

-- Row Level Security

alter table public.waitlist_applications enable row level security;

-- Explicitly strip anon. Belt and braces alongside RLS: even if a policy is
-- added by mistake later, the role has no table-level grant to fall back on.
revoke all on public.waitlist_applications from anon;

-- Signed-in dashboard users can read and work applications.
--
-- TODO before onboarding a second client: this currently grants access to EVERY
-- authenticated user, which includes setters. Once multi-tenancy lands and the
-- role model is settled, narrow this to owner/admin only. Acceptable today
-- because Nella and Anthony are the only accounts, but it must not survive the
-- first real tenant.
create policy waitlist_authenticated_select
  on public.waitlist_applications
  for select
  to authenticated
  using (true);

create policy waitlist_authenticated_update
  on public.waitlist_applications
  for update
  to authenticated
  using (true)
  with check (true);

-- No INSERT policy for anon or authenticated, by design. Inserts come from the
-- Pages Function using the service key, which bypasses RLS entirely.
-- No DELETE policy for anyone. Applications are business records: set status to
-- 'rejected' rather than deleting.
