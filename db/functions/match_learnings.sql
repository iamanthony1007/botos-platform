-- match_learnings: pgvector semantic retrieval RPC for the learnings table.
--
-- PROVENANCE / STATUS (read this before trusting the body below):
--   This function was created directly in the Supabase SQL editor during
--   Phase B of the cost-reduction work (2026-05-19), on BOTH the production
--   project (rydkwsjwlgnivlwlvqku) and the staging project (hlpucysbaqerhwahfolg).
--   It was never committed to db/migrations, so this file is being added purely
--   to bring the existing function under version control. The function is NOT
--   being altered by the Phase 2 retrieval fix; that fix is Worker-side only.
--
--   The body below is RECONSTRUCTED from the verified live contract (observed
--   request/response shape against production on 2026-06-03), NOT dumped from
--   pg_get_functiondef. It matches the parameters, return columns, ordering,
--   threshold/limit behavior, and bot-scoping confirmed by live testing.
--   Before relying on it as the canonical source, capture the exact live
--   definition and replace this body. See the verification query at the bottom.
--
-- VERIFIED CONTRACT (live, 2026-06-03):
--   args:    query_embedding vector(1024), target_bot_id uuid,
--            match_threshold double precision, match_count integer
--   returns: id, conversation_stage, situation_context, original_reply,
--            corrected_reply, reason, tags, similarity
--   filter:  bot_id = target_bot_id AND embedding IS NOT NULL
--            AND (1 - (embedding <=> query_embedding)) > match_threshold
--   order:   similarity DESC (i.e. embedding <=> query_embedding ASC)
--   limit:   match_count
--
-- SCHEMA DRIFT NOTE: learnings.tags is text[] on production and jsonb on
-- staging (documented in PROGRESS 2026-05-19). The return column type for
-- "tags" therefore differs between environments. PostgREST serializes both to
-- a JSON array, so the Worker reads them identically via (tags || []). The
-- reconstruction below reflects the PRODUCTION shape (text[]).

create or replace function public.match_learnings(
  query_embedding vector(1024),
  target_bot_id uuid,
  match_threshold double precision,
  match_count integer
)
returns table (
  id uuid,
  conversation_stage text,
  situation_context text,
  original_reply text,
  corrected_reply text,
  reason text,
  tags text[],
  similarity double precision
)
language sql
stable
as $$
  select
    l.id,
    l.conversation_stage,
    l.situation_context,
    l.original_reply,
    l.corrected_reply,
    l.reason,
    l.tags,
    1 - (l.embedding <=> query_embedding) as similarity
  from public.learnings l
  where l.bot_id = target_bot_id
    and l.embedding is not null
    and 1 - (l.embedding <=> query_embedding) > match_threshold
  order by l.embedding <=> query_embedding asc
  limit match_count;
$$;

-- VERIFICATION QUERY (run in the Supabase SQL editor against each project, then
-- paste the output over the create-or-replace block above to make this file the
-- exact canonical definition):
--
--   select pg_get_functiondef(p.oid)
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'match_learnings';
