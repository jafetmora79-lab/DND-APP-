-- Combat completeness: death saves, turn economy, knockout columns.
-- After this file, also re-run schema.sql from
--   drop function if exists public.resolve_player_attack
-- through the grant execute lines so advantage/disadvantage dice match the app.
-- Then: notify pgrst, 'reload schema';

alter table public.combatants add column if not exists death_state text not null default 'ok';
alter table public.combatants add column if not exists death_success int not null default 0;
alter table public.combatants add column if not exists death_fail int not null default 0;
alter table public.combatants add column if not exists turn_economy_json jsonb not null default '{"action":false,"bonus":false,"reaction":false,"movement":false}'::jsonb;

notify pgrst, 'reload schema';
