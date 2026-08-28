-- Campaign flow: skip corpses on next turn, Dex tie-break lives in the app,
-- players submit initiative and can join a fight, double-advance lock.
-- Run in the SQL Editor on existing projects, then: notify pgrst, 'reload schema';

drop function if exists public.player_advance_turn(uuid);
drop function if exists public.player_advance_turn(uuid, int);

create or replace function public.player_advance_turn(p_instance uuid, p_expected_pos int default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  inst record;
  current record;
  nxt record;
  is_dm boolean;
  is_owner boolean;
  n int;
  pos int;
  rnd int;
  orig_pos int;
  orig_rnd int;
  steps int := 0;
  wrapped boolean := false;
  can_act boolean;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  select * into inst from public.encounter_instances where id = p_instance;
  if not found then raise exception 'Encounter not found'; end if;
  is_dm := public.is_dm_of_campaign(inst.campaign_id);
  select * into current from public.combatants
    where encounter_instance_id = inst.id and turn_order_position = inst.current_turn_position;
  is_owner := found and current.source = 'character' and exists (
    select 1 from public.character_access a
    where a.user_id = auth.uid() and a.campaign_id = inst.campaign_id and a.character_id::text = current.source_id
  );
  if not is_dm and not is_owner then raise exception 'Wait for your turn to end the round.'; end if;
  if p_expected_pos is not null and inst.current_turn_position is distinct from p_expected_pos then
    return json_build_object('ok', true, 'skipped', true, 'round', inst.round_number, 'pos', inst.current_turn_position);
  end if;
  select count(*) into n from public.combatants where encounter_instance_id = inst.id;
  if n = 0 then return json_build_object('ok', true, 'round', inst.round_number, 'pos', 0); end if;
  orig_pos := inst.current_turn_position;
  orig_rnd := inst.round_number;
  pos := orig_pos;
  rnd := orig_rnd;
  loop
    steps := steps + 1;
    pos := pos + 1;
    if pos >= n then
      pos := 0;
      rnd := rnd + 1;
      wrapped := true;
      update public.combatants
        set conditions_json = coalesce(conditions_json, '[]'::jsonb) - 'Surprised'
        where encounter_instance_id = inst.id;
    end if;
    select * into nxt from public.combatants
      where encounter_instance_id = inst.id and turn_order_position = pos;
    if not found then
      nxt := null;
      can_act := false;
    else
      can_act := not (
        coalesce(nxt.death_state, 'ok') = 'dead'
        or (nxt.source = 'bestiary' and coalesce(nxt.hp_current, 0) <= 0)
        or (rnd = 1 and coalesce(nxt.conditions_json, '[]'::jsonb) @> '["Surprised"]'::jsonb)
      );
      if not can_act and coalesce(nxt.conditions_json, '[]'::jsonb) @> '["Surprised"]'::jsonb then
        update public.combatants
          set conditions_json = coalesce(conditions_json, '[]'::jsonb) - 'Surprised'
          where id = nxt.id;
      end if;
    end if;
    exit when can_act;
    if steps >= n then
      pos := orig_pos;
      rnd := orig_rnd;
      wrapped := false;
      exit;
    end if;
  end loop;
  update public.encounter_instances set current_turn_position = pos, round_number = rnd where id = inst.id;
  if nxt.id is not null and can_act then
    update public.combatants
      set turn_economy_json = '{"action":false,"bonus":false,"reaction":false,"movement":false}'::jsonb,
          movement_remaining = coalesce(speed_feet, 30)
      where id = nxt.id;
  end if;
  if wrapped then
    perform public.push_combat_activity(inst.id, format('Round %s begins.', rnd));
  end if;
  return json_build_object('ok', true, 'round', rnd, 'pos', pos);
end;
$$;

create or replace function public.player_set_initiative(p_combatant uuid, p_d20 int)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  inst record;
  is_dm boolean;
  is_owner boolean;
  sheet jsonb;
  dex int;
  bonus int;
  total int;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  if p_d20 is null or p_d20 < 1 or p_d20 > 20 then raise exception 'd20 must be between 1 and 20'; end if;
  select * into c from public.combatants where id = p_combatant;
  if not found then raise exception 'Combatant not found'; end if;
  select * into inst from public.encounter_instances where id = c.encounter_instance_id;
  if not found then raise exception 'Encounter not found'; end if;
  is_dm := public.is_dm_of_campaign(inst.campaign_id);
  is_owner := c.source = 'character' and exists (
    select 1 from public.character_access a
    where a.user_id = auth.uid() and a.campaign_id = inst.campaign_id and a.character_id::text = c.source_id
  );
  if not is_dm and not is_owner then raise exception 'Forbidden'; end if;
  dex := coalesce((c.stats_json->>'dex')::int, 10);
  bonus := floor((dex - 10) / 2.0);
  if c.source = 'character' then
    select sheet_json into sheet from public.player_characters where id::text = c.source_id;
    if sheet is not null then
      if (sheet->>'initiativeBonus') ~ '^-?[0-9]+$' then
        bonus := (sheet->>'initiativeBonus')::int;
      elsif (sheet->'abilities'->>'dex') ~ '^[0-9]+$' then
        bonus := floor(((sheet->'abilities'->>'dex')::int - 10) / 2.0);
      end if;
    end if;
  end if;
  total := p_d20 + bonus;
  update public.combatants set initiative = total where id = c.id;
  return json_build_object('ok', true, 'initiative', total);
end;
$$;

create or replace function public.player_join_fight(p_instance uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  inst record;
  ch record;
  existing record;
  map_row record;
  cid uuid;
  max_pos int;
  sheet jsonb;
  cell int;
  col int;
  row_i int;
  hp int;
  hpmax int;
  acv int;
  spd int;
  stats jsonb;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  select * into inst from public.encounter_instances where id = p_instance;
  if not found then raise exception 'Encounter not found'; end if;
  select pc.* into ch
    from public.player_characters pc
    join public.character_access a on a.character_id = pc.id
    where a.user_id = auth.uid() and a.campaign_id = inst.campaign_id
    limit 1;
  if not found then raise exception 'You are not at this table.'; end if;
  select * into existing from public.combatants
    where encounter_instance_id = inst.id and source = 'character' and source_id = ch.id::text;
  if found then
    if not exists (select 1 from public.tokens_on_map where encounter_instance_id = inst.id and ref_id = existing.id) then
      cell := 70;
      col := 0;
      row_i := 0;
      if inst.map_id is not null then
        select * into map_row from public.maps where id = inst.map_id;
        if found then
          cell := map_row.grid_size;
          col := greatest(0, least(map_row.grid_cols - 1, (map_row.grid_cols / 2) - 1));
          row_i := greatest(0, map_row.grid_rows - 2);
        end if;
      end if;
      insert into public.tokens_on_map (encounter_instance_id, x, y, ref_type, ref_id, label, color, size_squares, visible_to_players)
      values (inst.id, (col + 0.5) * cell, (row_i + 0.5) * cell, 'combatant', existing.id, ch.name, coalesce(ch.token_color, '#6ea8c9'), 1, true);
    end if;
    return json_build_object('ok', true, 'id', existing.id);
  end if;
  select coalesce(max(turn_order_position), -1) into max_pos from public.combatants where encounter_instance_id = inst.id;
  sheet := coalesce(ch.sheet_json, '{}'::jsonb);
  hp := coalesce((sheet->>'hpCurrent')::int, 10);
  hpmax := coalesce((sheet->>'hpMax')::int, 10);
  acv := coalesce((sheet->>'ac')::int, 10);
  spd := coalesce(substring(coalesce(sheet->>'speed', '30') from '([0-9]+)')::int, 30);
  stats := jsonb_build_object(
    'str', coalesce((sheet->'abilities'->>'str')::int, 10),
    'dex', coalesce((sheet->'abilities'->>'dex')::int, 10),
    'con', coalesce((sheet->'abilities'->>'con')::int, 10),
    'int', coalesce((sheet->'abilities'->>'int')::int, 10),
    'wis', coalesce((sheet->'abilities'->>'wis')::int, 10),
    'cha', coalesce((sheet->'abilities'->>'cha')::int, 10),
    'savingThrows', ''
  );
  insert into public.combatants (
    encounter_instance_id, name, source, source_id, initiative, hp_current, hp_max, hp_temp, ac,
    conditions_json, turn_order_position, color, notes, constitution, stats_json, speed_feet, movement_remaining
  ) values (
    inst.id, ch.name, 'character', ch.id::text, 0, hp, hpmax, coalesce((sheet->>'hpTemp')::int, 0), acv,
    '[]'::jsonb, max_pos + 1, coalesce(ch.token_color, '#6ea8c9'), '', coalesce((sheet->'abilities'->>'con')::int, 10),
    stats, spd, spd
  ) returning id into cid;
  cell := 70;
  col := 0;
  row_i := 0;
  if inst.map_id is not null then
    select * into map_row from public.maps where id = inst.map_id;
    if found then
      cell := map_row.grid_size;
      col := greatest(0, least(map_row.grid_cols - 1, (map_row.grid_cols / 2) - 1));
      row_i := greatest(0, map_row.grid_rows - 2);
    end if;
  end if;
  insert into public.tokens_on_map (encounter_instance_id, x, y, ref_type, ref_id, label, color, size_squares, visible_to_players)
  values (inst.id, (col + 0.5) * cell, (row_i + 0.5) * cell, 'combatant', cid, ch.name, coalesce(ch.token_color, '#6ea8c9'), 1, true);
  return json_build_object('ok', true, 'id', cid);
end;
$$;

grant execute on function public.player_advance_turn(uuid, int) to authenticated;
grant execute on function public.player_set_initiative(uuid, int) to authenticated;
grant execute on function public.player_join_fight(uuid) to authenticated;

notify pgrst, 'reload schema';
