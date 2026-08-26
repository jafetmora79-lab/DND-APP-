-- Run in the SQL Editor if schema.sql was already applied. Safe to re-run.

alter table public.live_sessions add column if not exists table_phase text not null default 'table';
alter table public.live_sessions add column if not exists ambiance_image_url text;
alter table public.live_sessions add column if not exists ambiance_caption text not null default '';
alter table public.live_sessions add column if not exists last_outcome text;

update public.live_sessions
  set table_phase = 'combat'
  where encounter_instance_id is not null
    and table_phase = 'table';

notify pgrst, 'reload schema';
