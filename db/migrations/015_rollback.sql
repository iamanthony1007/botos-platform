-- Rollback for migration 015 (waitlist funnel fields).
--
-- Restores the pre-015 posture: NOT NULL back on the old application-form
-- columns, phone column dropped.
--
-- TWO CONDITIONS, read before running:
--
--   1. The NOT NULL restore FAILS if any funnel-era rows exist, because those
--      rows have nulls in the old columns. That failure is a feature: it
--      forces a decision about real applicant data instead of losing it
--      silently. Either backfill placeholders first or accept staying rolled
--      forward. Check with:
--        select count(*) from public.waitlist_applications
--        where first_name is null;
--
--   2. DROPPING phone DESTROYS every phone number collected by the funnel
--      form. Export first if any funnel-era rows exist.
--
-- Only run this together with reverting the site to the pre-funnel form:
-- the funnel form cannot insert into the restored schema.

alter table public.waitlist_applications
  alter column first_name            set not null,
  alter column last_name             set not null,
  alter column what_you_sell         set not null,
  alter column main_offer_price      set not null,
  alter column inbound_leads_per_day set not null,
  alter column booked_calls_per_week set not null,
  alter column avg_monthly_revenue   set not null,
  alter column lead_source           set not null,
  alter column response_speed        set not null,
  alter column has_dm_script         set not null,
  alter column current_crm           set not null,
  alter column team_size             set not null,
  alter column failed_dm_example     set not null;

alter table public.waitlist_applications
  drop column if exists phone;
