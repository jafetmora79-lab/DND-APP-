-- Existing hosted projects: run this in the Supabase SQL Editor.
-- New projects that ran the current schema.sql already have these columns.
--
-- Token art: a character or monster can now carry a portrait image that
-- renders (circular-clipped) on its map token instead of the default
-- color+initials circle. Plain nullable columns, no RPC changes — uploads
-- go straight through the existing DM/owner update policies on these
-- tables, the same way tokenColor and sheet_json already do.
--
-- Safe to re-run.

alter table public.bestiary_monsters add column if not exists portrait_url text;
alter table public.player_characters add column if not exists portrait_url text;
