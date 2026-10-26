-- MGH Energy Control — database schema (the API also creates this automatically on first use).
create table if not exists docs (
  path text primary key,            -- e.g. rounds/2026-10-21/checks/r1-eng, ac/2026-10-21, meters/2026-10-21
  collection text not null,         -- e.g. rounds/2026-10-21/checks, ac, meters, days, acdays, config
  doc_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists docs_collection_date on docs (collection, (data->>'date'));

create or replace function jsonb_deep_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; r jsonb;
begin
  if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(b) is distinct from 'object' then return b; end if;
  r := a;
  for k in select jsonb_object_keys(b) loop
    if r ? k then r := jsonb_set(r, array[k], jsonb_deep_merge(r->k, b->k));
    else r := r || jsonb_build_object(k, b->k); end if;
  end loop;
  return r;
end $$;

-- Useful reports straight from SQL:
-- Daily kWh readings:      select doc_id as date, data->'readings' from docs where collection = 'meters' order by doc_id;
-- Energy round summaries:  select doc_id as date, data->'summary' from docs where collection = 'days' order by doc_id;
-- AC daily summaries:      select doc_id as date, data from docs where collection = 'acdays' order by doc_id;
