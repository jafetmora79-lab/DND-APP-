-- Existing hosted projects: run this after schema.sql, then:
--   notify pgrst, 'reload schema';
-- New projects that ran the current schema.sql already have these RPCs.
--
-- Action-economy fixes:
--   1. Extra Attack: resolve_player_attack now takes a character's
--      sheet.attacksPerAction into account instead of locking the Action
--      slot after a single attack.
--   2. Two-weapon fighting: resolve_player_attack now takes p_slot
--      ('action' | 'bonus' | 'reaction') and marks the matching economy
--      slot instead of always marking Action.
--   3. Reaction-slot attacks (opportunity attacks) mark the Reaction slot
--      the same way, via the same p_slot parameter.

alter table public.combatants add column if not exists attacks_used int not null default 0;

drop function if exists public.resolve_player_attack(uuid, uuid, int, int, int);
drop function if exists public.resolve_player_attack(uuid, uuid, int, int, int, uuid);
drop function if exists public.resolve_player_attack(uuid, uuid, int, int, int, uuid, int, text);
drop function if exists public.resolve_player_attack(uuid, uuid, int, int, int, uuid, int, text, int);
drop function if exists public.resolve_player_attack(uuid, uuid, int, int, int, uuid, int, text, int, text);

create or replace function public.resolve_player_attack(
  p_instance uuid,
  p_target uuid,
  p_attack_index int,
  p_d20 int,
  p_damage int,
  p_attacker uuid default null,
  p_d20_b int default null,
  p_roll_mode text default 'normal',
  p_cover int default 0,
  p_slot text default 'action'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  access_row record;
  ch record;
  inst record;
  attacker record;
  target record;
  from_tok record;
  to_tok record;
  map_row record;
  beast record;
  atk jsonb;
  bonus int;
  range_ft int;
  dist_sq int;
  hit boolean;
  crit boolean;
  fumble boolean;
  had_adv boolean;
  total int;
  new_temp int;
  new_hp int;
  sheet jsonb;
  msg text;
  attacker_adv jsonb;
  target_adv jsonb;
  used_d20 int;
  mode text;
  dice_note text;
  cover int;
  effective_ac int;
  hiding boolean;
  resolved_slot text;
  attacks_per_action int;
  next_attacks_used int;
begin
  if auth.uid() is null then
    raise exception 'Sign-in required';
  end if;
  if p_d20 < 1 or p_d20 > 20 then
    raise exception 'd20 must be between 1 and 20';
  end if;
  if p_damage < 0 or p_damage > 999 then
    raise exception 'Damage looks wrong';
  end if;

  select * into inst from public.encounter_instances where id = p_instance;
  if not found then
    raise exception 'Encounter not found';
  end if;

  if public.is_dm_of_campaign(inst.campaign_id) then
    if p_attacker is null then
      raise exception 'Select the attacking creature first';
    end if;
    select * into attacker from public.combatants
      where id = p_attacker and encounter_instance_id = inst.id;
    if not found then
      raise exception 'Attacker is not on the map';
    end if;
  else
    select * into access_row from public.character_access
      where user_id = auth.uid() and campaign_id = inst.campaign_id;
    if not found then
      raise exception 'You are not at this table';
    end if;
    select * into ch from public.player_characters where id = access_row.character_id;
    if not found then
      raise exception 'Character not found';
    end if;
    select * into attacker from public.combatants
      where encounter_instance_id = inst.id
        and source = 'character'
        and source_id = ch.id::text;
    if not found then
      raise exception 'You are not on the map yet. Ask the DM to place you.';
    end if;
  end if;

  resolved_slot := case when p_slot in ('bonus', 'reaction') then p_slot else 'action' end;
  if coalesce(attacker.turn_economy_json, '{}'::jsonb) ->> resolved_slot = 'true' then
    raise exception 'Your % is already used.', resolved_slot;
  end if;
  attacks_per_action := 1;

  select * into target from public.combatants
    where id = p_target and encounter_instance_id = inst.id;
  if not found then
    raise exception 'Target not found';
  end if;
  if target.id = attacker.id then
    raise exception 'Pick a different creature';
  end if;
  if coalesce(attacker.death_state, 'ok') in ('dying', 'stable', 'dead')
     or coalesce(attacker.conditions_json, '[]'::jsonb) @> '"Unconscious"'::jsonb
     or coalesce(attacker.conditions_json, '[]'::jsonb) @> '"Paralyzed"'::jsonb
     or coalesce(attacker.conditions_json, '[]'::jsonb) @> '"Stunned"'::jsonb
     or coalesce(attacker.conditions_json, '[]'::jsonb) @> '"Incapacitated"'::jsonb
     or coalesce(attacker.conditions_json, '[]'::jsonb) @> '"Petrified"'::jsonb then
    raise exception '% cannot take a normal attack', attacker.name;
  end if;

  if attacker.source = 'character' then
    select * into ch from public.player_characters where id = attacker.source_id::uuid;
    if not found then
      raise exception 'Character not found';
    end if;
    sheet := ch.sheet_json;
    attacks_per_action := greatest(1, coalesce((sheet->>'attacksPerAction')::int, 1));
    if jsonb_typeof(sheet->'attacks') is distinct from 'array' then
      raise exception 'No attacks on the sheet';
    end if;
    atk := sheet->'attacks'->p_attack_index;
    if atk is null or coalesce(atk->>'name','') = '' then
      raise exception 'That attack is not on the sheet';
    end if;
    bonus := coalesce((regexp_match(coalesce(atk->>'bonus', '0'), '([+-]?[0-9]+)'))[1]::int, 0);
    range_ft := coalesce((regexp_match(coalesce(nullif(atk->>'range', ''), '5'), '([0-9]+)'))[1]::int, 5);
  else
    select * into beast from public.bestiary_monsters where id = attacker.source_id::uuid;
    if not found then
      raise exception 'Monster not found';
    end if;
    atk := beast.actions->p_attack_index;
    if atk is null or coalesce(atk->>'name','') = '' then
      atk := jsonb_build_object('name', 'Strike', 'desc', 'Melee Weapon Attack: +0 to hit, reach 5 ft.');
    end if;
    bonus := coalesce((regexp_match(coalesce(atk->>'desc', atk->>'bonus', '0'), '([+-][0-9]+)\s*to hit'))[1]::int, coalesce((regexp_match(coalesce(atk->>'bonus', '0'), '([+-]?[0-9]+)'))[1]::int, 0));
    range_ft := coalesce((regexp_match(coalesce(atk->>'desc', atk->>'range', '5'), '(?:reach|range)\s+([0-9]+)\s*ft'))[1]::int, coalesce((regexp_match(coalesce(atk->>'range', '5'), '([0-9]+)'))[1]::int, 5));
  end if;
  if range_ft <= 0 then range_ft := 5; end if;

  select * into from_tok from public.tokens_on_map
    where encounter_instance_id = inst.id and ref_id = attacker.id;
  if not found then
    raise exception 'Both creatures need to be on the map';
  end if;
  select * into to_tok from public.tokens_on_map
    where encounter_instance_id = inst.id and ref_id = target.id;
  if not found then
    raise exception 'Both creatures need to be on the map';
  end if;

  select * into map_row from public.maps where id = inst.map_id;
  if not found then
    raise exception 'Map not found';
  end if;

  dist_sq := greatest(
    abs(floor(from_tok.x / map_row.grid_size)::int - floor(to_tok.x / map_row.grid_size)::int),
    abs(floor(from_tok.y / map_row.grid_size)::int - floor(to_tok.y / map_row.grid_size)::int)
  );
  -- Player attacks: DM is the range authority. Keep the check for DM-driven monster attacks.
  if public.is_dm_of_campaign(inst.campaign_id) and dist_sq * 5 > range_ft then
    raise exception 'That creature is out of range (% ft away, range % ft)', dist_sq * 5, range_ft;
  end if;

  total := p_d20 + bonus;
  crit := p_d20 >= 20;
  fumble := p_d20 <= 1;
  attacker_adv := coalesce(attacker.advantage_against_json, '[]'::jsonb);
  target_adv := coalesce(target.advantage_against_json, '[]'::jsonb);
  hiding := coalesce(attacker.conditions_json, '[]'::jsonb) @> '"Hiding"'::jsonb;
  had_adv := (attacker_adv @> to_jsonb(target.id::text)) or hiding;
  mode := coalesce(nullif(p_roll_mode, ''), 'normal');
  if had_adv and mode = 'disadvantage' then mode := 'normal'; end if;
  if had_adv and mode = 'normal' then mode := 'advantage'; end if;
  if mode <> 'normal' then
    if p_d20_b is null or p_d20_b < 1 or p_d20_b > 20 then
      raise exception 'Enter both d20s for advantage or disadvantage';
    end if;
    if mode = 'advantage' then used_d20 := greatest(p_d20, p_d20_b); else used_d20 := least(p_d20, p_d20_b); end if;
    dice_note := format('%s / %s → %s used', p_d20, p_d20_b, used_d20);
  else
    used_d20 := p_d20;
    dice_note := used_d20::text;
  end if;
  total := used_d20 + bonus;
  crit := used_d20 >= 20;
  fumble := used_d20 <= 1;
  cover := greatest(0, coalesce(p_cover, 0));
  effective_ac := target.ac + cover;
  attacker_adv := coalesce((
    select jsonb_agg(to_jsonb(x))
    from jsonb_array_elements_text(attacker_adv) x
    where x <> target.id::text
  ), '[]'::jsonb);
  if fumble then
    hit := false;
    if not (target_adv @> to_jsonb(attacker.id::text)) then
      target_adv := target_adv || jsonb_build_array(attacker.id::text);
    end if;
  elsif crit then
    hit := true;
  else
    hit := total > effective_ac;
  end if;
  update public.combatants set advantage_against_json = attacker_adv where id = attacker.id;
  update public.combatants set advantage_against_json = target_adv where id = target.id;
  update public.combatants
    set conditions_json = coalesce((
          select jsonb_agg(to_jsonb(x))
          from jsonb_array_elements_text(coalesce(conditions_json, '[]'::jsonb)) x
          where lower(x) <> 'hiding'
        ), '[]'::jsonb)
    where id in (attacker.id, target.id);
  next_attacks_used := coalesce(attacker.attacks_used, 0) + 1;
  if resolved_slot = 'action' then
    update public.combatants
      set attacks_used = next_attacks_used,
          turn_economy_json = case when next_attacks_used >= attacks_per_action
            then jsonb_set(coalesce(turn_economy_json, '{}'::jsonb), '{action}', 'true'::jsonb)
            else coalesce(turn_economy_json, '{}'::jsonb)
          end
      where id = attacker.id;
  else
    update public.combatants
      set turn_economy_json = jsonb_set(coalesce(turn_economy_json, '{}'::jsonb), array[resolved_slot], 'true'::jsonb)
      where id = attacker.id;
  end if;

  if not hit then
    if fumble then
      msg := format('%s. Natural 1 against %s — miss. %s has advantage against %s next turn.', dice_note, target.name, target.name, attacker.name);
    else
      msg := format('%s. %s vs AC %s — need higher than %s to hit %s.', dice_note, total, effective_ac, effective_ac, target.name);
    end if;
    return json_build_object(
      'hit', false,
      'crit', false,
      'fumble', fumble,
      'hadAdvantage', had_adv,
      'rollMode', mode,
      'd20', used_d20,
      'd20b', p_d20_b,
      'total', total,
      'ac', effective_ac,
      'damage', 0,
      'hpCurrent', target.hp_current,
      'hpTemp', target.hp_temp,
      'targetName', target.name,
      'message', msg
    );
  end if;

  new_temp := greatest(0, target.hp_temp);
  new_hp := target.hp_current;
  if p_damage <= new_temp then
    new_temp := new_temp - p_damage;
  else
    new_hp := greatest(0, new_hp - (p_damage - new_temp));
    new_temp := 0;
  end if;

  update public.combatants set hp_current = new_hp, hp_temp = new_temp where id = target.id;
  if new_hp > 0 then
    update public.combatants
      set conditions_json = coalesce((
            select jsonb_agg(to_jsonb(x))
            from jsonb_array_elements_text(coalesce(conditions_json, '[]'::jsonb)) x
            where x <> 'Unconscious'
          ), '[]'::jsonb),
          death_success = case when coalesce(death_state, 'ok') <> 'ok' then 0 else death_success end,
          death_fail = case when coalesce(death_state, 'ok') <> 'ok' then 0 else death_fail end,
          death_state = case when coalesce(death_state, 'ok') <> 'ok' then 'ok' else death_state end
      where id = target.id;
  else
    if not (coalesce(target.conditions_json, '[]'::jsonb) @> '"Unconscious"'::jsonb) then
      update public.combatants
        set conditions_json = coalesce(conditions_json, '[]'::jsonb) || '"Unconscious"'::jsonb
        where id = target.id;
    end if;
    if target.source = 'character' and coalesce(target.death_state, 'ok') <> 'dead' then
      if target.hp_current > 0 and coalesce(target.death_state, 'ok') in ('ok', '') then
        update public.combatants set death_state = 'dying', death_success = 0, death_fail = 0 where id = target.id;
      elsif coalesce(target.death_state, 'ok') = 'dying' then
        update public.combatants
          set death_fail = least(3, coalesce(death_fail, 0) + case when target.hp_current <= 0 and crit then 2 else 1 end)
          where id = target.id;
        update public.combatants set death_state = 'dead' where id = target.id and death_fail >= 3;
      elsif coalesce(target.death_state, 'ok') = 'stable' then
        update public.combatants
          set death_state = 'dying', death_success = 0,
              death_fail = least(3, case when target.hp_current <= 0 and crit then 2 else 1 end)
          where id = target.id;
      end if;
    end if;
  end if;
  if target.source = 'character' then
    update public.player_characters
      set sheet_json = jsonb_set(jsonb_set(coalesce(sheet_json, '{}'::jsonb), '{hpCurrent}', to_jsonb(new_hp)), '{hpTemp}', to_jsonb(new_temp))
      where id = target.source_id::uuid;
  end if;

  if crit then
    msg := format('%s. Natural 20! %s damage to %s (%s HP left).', dice_note, p_damage, target.name, new_hp);
  else
    msg := format('%s. Hit %s (%s beats AC %s) for %s damage (%s HP left).', dice_note, target.name, total, effective_ac, p_damage, new_hp);
  end if;

  return json_build_object(
    'hit', true,
    'crit', crit,
    'fumble', false,
    'hadAdvantage', had_adv,
    'rollMode', mode,
    'd20', used_d20,
    'd20b', p_d20_b,
    'total', total,
    'ac', effective_ac,
    'damage', p_damage,
    'hpCurrent', new_hp,
    'hpTemp', new_temp,
    'targetName', target.name,
    'message', msg
  );
end;
$$;

grant execute on function public.resolve_player_attack(uuid, uuid, int, int, int, uuid, int, text, int, text) to authenticated;

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
          movement_remaining = coalesce(speed_feet, 30),
          attacks_used = 0
      where id = nxt.id;
  end if;
  if wrapped then
    perform public.push_combat_activity(inst.id, format('Round %s begins.', rnd));
  end if;
  return json_build_object('ok', true, 'round', rnd, 'pos', pos);
end;
$$;

grant execute on function public.player_advance_turn(uuid, int) to authenticated;

notify pgrst, 'reload schema';
