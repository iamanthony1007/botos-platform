-- Migration 015: waitlist funnel fields
--
-- The funnel-site rebuild (feat/funnel-site, 2026-08-31) replaces the
-- three-step waitlist application with a four-field form: business name,
-- Instagram handle, email, phone. Two schema consequences:
--
--   1. phone is a NEW column. Text, not numeric: people type "(555) 123-4567",
--      "+34 600 000 000", and similar. Never lose an application to a type
--      error (the migration 010 lesson).
--   2. The columns the old form required are no longer collected, so their
--      NOT NULL constraints must go, or every new signup fails at insert.
--      The columns themselves STAY: existing applications keep their data and
--      Nella's dashboard view of old rows is unchanged.
--
-- business_name was nullable in 010 and is now required BY THE FORM AND THE
-- PAGES FUNCTION, not by the database: old rows may have it null, so adding
-- NOT NULL here would fail or need a backfill for zero benefit. Enforcement
-- lives in dashboard/functions/api/waitlist.js, the only write path.
--
-- The CHECK constraints from 010 (lead_source, response_speed, etc.) stay:
-- they only fire when a value is present, and null passes them. Bottlenecks
-- keeps its NOT NULL because it has DEFAULT '{}'.
--
-- Idempotent: safe to re-run. Apply to staging first, production only with
-- the funnel-site production deploy (the new form and this schema ship
-- together; the old form cannot write phone and the new form cannot write
-- without the relaxed constraints).

alter table public.waitlist_applications
  add column if not exists phone text;

alter table public.waitlist_applications
  alter column first_name            drop not null,
  alter column last_name             drop not null,
  alter column what_you_sell         drop not null,
  alter column main_offer_price      drop not null,
  alter column inbound_leads_per_day drop not null,
  alter column booked_calls_per_week drop not null,
  alter column avg_monthly_revenue   drop not null,
  alter column lead_source           drop not null,
  alter column response_speed        drop not null,
  alter column has_dm_script         drop not null,
  alter column current_crm           drop not null,
  alter column team_size             drop not null,
  alter column failed_dm_example     drop not null;

-- Verification: expect phone to exist and exactly these columns to be
-- nullable-or-not as listed. Run after applying:
--
--   select column_name, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'waitlist_applications'
--   order by ordinal_position;
--
-- Expected: phone present (is_nullable YES); first_name, last_name,
-- what_you_sell, main_offer_price, inbound_leads_per_day,
-- booked_calls_per_week, avg_monthly_revenue, lead_source, response_speed,
-- has_dm_script, current_crm, team_size, failed_dm_example all YES;
-- email and instagram_handle still NO; bottlenecks still NO (has default).
