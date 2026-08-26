-- Only for databases that already ran schema.sql before map maker shipped.
-- New projects: run schema.sql instead. Do not start with this file.

do $$
begin
  if to_regclass('public.maps') is null then
    raise notice 'public.maps does not exist yet. Skip this file and run supabase/schema.sql in the SQL Editor.';
    return;
  end if;
  execute $sql$
    alter table public.maps
      add column if not exists blocked_cells jsonb not null default '[]'::jsonb
  $sql$;
end $$;
