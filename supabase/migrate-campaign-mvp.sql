-- Campaign hub: session timeline, quests, NPCs, party loot on campaigns.hub_json.
alter table public.campaigns add column if not exists hub_json jsonb not null default '{}'::jsonb;

-- Combatant save math copied from the bestiary at spawn (player snapshot has no bestiary).
alter table public.combatants add column if not exists stats_json jsonb;

do $$
begin
  alter publication supabase_realtime add table public.campaigns;
exception
  when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
