-- FEAT-004: the repeat rule of a recurring event, kept on each of its occurrences.

-- { "every": 1-99, "unit": "day" | "week" | "month", "until": "yyyy-mm-dd" } and nothing else.
create function public.is_repeat_rule(r jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(r) is distinct from 'object'
     or not (r ?& array['every', 'unit', 'until'])
     or (r - array['every', 'unit', 'until']) <> '{}'::jsonb then
    return false;
  end if;
  if jsonb_typeof(r->'every') <> 'number' or (r->>'every') !~ '^[0-9]{1,2}$' or (r->>'every')::int < 1 then
    return false;
  end if;
  if jsonb_typeof(r->'unit') <> 'string' or (r->>'unit') not in ('day', 'week', 'month') then
    return false;
  end if;
  if jsonb_typeof(r->'until') <> 'string' or (r->>'until') !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  return to_char((r->>'until')::date, 'YYYY-MM-DD') = r->>'until';
exception when others then
  return false; -- e.g. 2026-02-30
end $$;

alter table public.events add column repeat jsonb;
alter table public.events add constraint events_repeat_shape check (repeat is null or public.is_repeat_rule(repeat));
