-- Existing hosted projects: run this in the Supabase SQL Editor. No
-- "notify pgrst, 'reload schema'" needed — these are plain columns, not
-- functions, but it doesn't hurt to run it anyway.
-- New projects that ran the current schema.sql already have these columns.
--
-- Grid alignment tool: a map's background image can now be pinned to the
-- grid by scale + offset instead of always being force-stretched to fill
-- it. bg_scale is nullable on purpose — null means "legacy behavior:
-- stretch the image to exactly fill the grid", which is how every existing
-- map already renders, so nothing changes for maps that are never
-- recalibrated with the new "Align grid to image" tool.
--
-- Safe to re-run.

alter table public.maps add column if not exists bg_scale double precision;
alter table public.maps add column if not exists bg_offset_x double precision not null default 0;
alter table public.maps add column if not exists bg_offset_y double precision not null default 0;
