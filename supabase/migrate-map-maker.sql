-- Adds blocked_cells to an existing maps table, then reloads the API schema cache.
-- Safe to run even if the column is already there.
-- If public.maps does not exist, run schema.sql instead.

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

notify pgrst, 'reload schema';
