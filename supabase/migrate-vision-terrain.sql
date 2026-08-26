-- Existing hosted projects: run this after schema.sql, then:
--   notify pgrst, 'reload schema';
-- New projects that ran the current schema.sql already have this policy.

-- Players may read bestiary rows for monsters currently in a fight they play in,
-- so tapping a visible token can open the full stat block.

drop policy if exists bestiary_player_fight on public.bestiary_monsters;
create policy bestiary_player_fight on public.bestiary_monsters
  for select using (
    exists (
      select 1
      from public.combatants c
      join public.encounter_instances i on i.id = c.encounter_instance_id
      where c.source = 'bestiary'
        and c.source_id = bestiary_monsters.id::text
        and public.plays_in_campaign(i.campaign_id)
    )
  );
