-- Existing hosted projects: run this after schema.sql, then:
--   notify pgrst, 'reload schema';
-- New projects that ran the current schema.sql already have these RPCs.
-- Cover (+2 / +5 AC) and Hide (Stealth vs passive Perception).

drop function if exists public.resolve_player_attack(uuid, uuid, int, int, int);
drop function if exists public.resolve_player_attack(uuid, uuid, int, int, int, uuid);
drop function if exists public.resolve_player_attack(uuid, uuid, int, int, int, uuid, int, text);
drop function if exists public.resolve_player_attack(uuid, uuid, int, int, int, uuid, int, text, int);

create or replace function public.resolve_player_attack(
  p_instance uuid,
  p_target uuid,
  p_attack_index int,
  p_d20 int,
  p_damage int,
  p_attacker uuid default null,
  p_d20_b int default null,
  p_roll_mode text default 'normal',
  p_cover int default 0
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
    where encounter_instance_id = inst.id and ref_id = attacker.id::text;
  if not found then
    raise exception 'Both creatures need to be on the map';
  end if;
  select * into to_tok from public.tokens_on_map
    where encounter_instance_id = inst.id and ref_id = target.id::text;
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
  update public.combatants
    set turn_economy_json = jsonb_set(coalesce(turn_economy_json, '{}'::jsonb), '{action}', 'true'::jsonb)
    where id = attacker.id;

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
grant execute on function public.resolve_player_attack(uuid, uuid, int, int, int, uuid, int, text, int) to authenticated;

create or replace function public.declare_combat_action(
  p_instance uuid,
  p_kind text,
  p_slot text default 'action',
  p_combatant uuid default null,
  p_target uuid default null,
  p_other text default null,
  p_custom text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  inst record;
  c record;
  ally record;
  is_dm boolean;
  slot text;
  kind text;
  econ jsonb;
  cond jsonb;
  speed int;
  remaining int;
  txt text;
  label text;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  select * into inst from public.encounter_instances where id = p_instance;
  if not found then raise exception 'Encounter not found'; end if;
  is_dm := public.is_dm_of_campaign(inst.campaign_id);
  if is_dm then
    if p_combatant is not null then
      select * into c from public.combatants where id = p_combatant and encounter_instance_id = inst.id;
    else
      select * into c from public.combatants
        where encounter_instance_id = inst.id and turn_order_position = inst.current_turn_position;
    end if;
  else
    if not public.plays_in_campaign(inst.campaign_id) then raise exception 'Not allowed'; end if;
    select * into c from public.combatants
      where encounter_instance_id = inst.id
        and source = 'character'
        and source_id in (
          select character_id::text from public.character_access
          where user_id = auth.uid() and campaign_id = inst.campaign_id
        );
  end if;
  if not found then raise exception 'Combatant not found'; end if;
  if c.turn_order_position is distinct from inst.current_turn_position then
    raise exception 'Wait for your turn.';
  end if;
  slot := case when p_slot in ('bonus', 'reaction') then p_slot else 'action' end;
  econ := coalesce(c.turn_economy_json, '{}'::jsonb);
  if coalesce((econ->>slot)::boolean, false) then
    raise exception 'Your % is already used.', slot;
  end if;
  cond := coalesce(c.conditions_json, '[]'::jsonb);
  speed := coalesce(c.speed_feet, 30);
  remaining := greatest(0, coalesce(c.movement_remaining, speed));
  kind := lower(coalesce(p_kind, ''));
  if kind = 'dash' then
    remaining := remaining + speed;
    txt := format('%s used Dash.', c.name);
  elsif kind = 'dodge' then
    if not (cond @> '"Dodging"'::jsonb) then cond := cond || jsonb_build_array('Dodging'); end if;
    txt := format('%s used Dodge.', c.name);
  elsif kind = 'disengage' then
    if not (cond @> '"Disengaging"'::jsonb) then cond := cond || jsonb_build_array('Disengaging'); end if;
    txt := format('%s used Disengage.', c.name);
  elsif kind = 'hide' then
    raise exception 'Enter the d20 you rolled for Stealth (1–20).';
  elsif kind = 'help' then
    if p_target is null then raise exception 'Pick an ally to Help.'; end if;
    select * into ally from public.combatants where id = p_target and encounter_instance_id = inst.id;
    if not found or ally.id = c.id then raise exception 'Pick an ally to Help.'; end if;
    txt := format('%s used Help on %s.', c.name, ally.name);
  elsif kind in ('other', 'custom') then
    if kind = 'custom' or coalesce(p_other, '') = 'Custom' then
      label := trim(coalesce(p_custom, ''));
    else
      label := trim(coalesce(p_other, ''));
    end if;
    if label = '' then raise exception 'Say what you want to do.'; end if;
    txt := format('%s declared: %s.', c.name, label);
  else
    raise exception 'Unknown action';
  end if;
  if kind in ('dash', 'help', 'other', 'custom') then
    cond := coalesce((
      select jsonb_agg(to_jsonb(x))
      from jsonb_array_elements_text(coalesce(cond, '[]'::jsonb)) x
      where lower(x) <> 'hiding'
    ), '[]'::jsonb);
  end if;
  econ := jsonb_set(econ, array[slot], 'true'::jsonb);
  update public.combatants
    set conditions_json = cond, turn_economy_json = econ, movement_remaining = remaining
    where id = c.id;
  perform public.push_combat_activity(inst.id, txt);
  return json_build_object('text', txt);
end;
$$;
create or replace function public.apply_hide_result(
  p_instance uuid,
  p_combatant uuid,
  p_success boolean,
  p_text text default '',
  p_spend_action boolean default false,
  p_slot text default 'action'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  inst record;
  c record;
  is_dm boolean;
  cond jsonb;
  econ jsonb;
  slot text;
  txt text;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  select * into inst from public.encounter_instances where id = p_instance;
  if not found then raise exception 'Encounter not found'; end if;
  is_dm := public.is_dm_of_campaign(inst.campaign_id);
  if is_dm then
    select * into c from public.combatants where id = p_combatant and encounter_instance_id = inst.id;
  else
    if not public.plays_in_campaign(inst.campaign_id) then raise exception 'Not allowed'; end if;
    select * into c from public.combatants where id = p_combatant and encounter_instance_id = inst.id;
    if not found then raise exception 'Combatant not found'; end if;
    if c.source is distinct from 'character' or not exists (
      select 1 from public.character_access a
      where a.user_id = auth.uid() and a.campaign_id = inst.campaign_id and a.character_id::text = c.source_id
    ) then
      raise exception 'Not allowed';
    end if;
  end if;
  if not found then raise exception 'Combatant not found'; end if;
  if p_spend_action then
    if c.turn_order_position is distinct from inst.current_turn_position then
      raise exception 'Wait for your turn.';
    end if;
    slot := case when p_slot in ('bonus', 'reaction') then p_slot else 'action' end;
    econ := coalesce(c.turn_economy_json, '{}'::jsonb);
    if coalesce((econ->>slot)::boolean, false) then
      raise exception 'Your % is already used.', slot;
    end if;
    econ := jsonb_set(econ, array[slot], 'true'::jsonb);
  else
    if not is_dm then raise exception 'Not allowed'; end if;
    econ := coalesce(c.turn_economy_json, '{}'::jsonb);
  end if;
  cond := coalesce((
    select jsonb_agg(to_jsonb(x))
    from jsonb_array_elements_text(coalesce(c.conditions_json, '[]'::jsonb)) x
    where lower(x) <> 'hiding'
  ), '[]'::jsonb);
  if p_success then
    cond := cond || jsonb_build_array('Hiding');
  end if;
  update public.combatants
    set conditions_json = cond, turn_economy_json = econ
    where id = c.id;
  txt := coalesce(nullif(trim(p_text), ''), format('%s %s.', c.name, case when p_success then 'is hidden' else 'failed to hide' end));
  perform public.push_combat_activity(inst.id, txt);
  return json_build_object('text', txt);
end;
$$;
grant execute on function public.apply_hide_result(uuid, uuid, boolean, text, boolean, text) to authenticated;

notify pgrst, 'reload schema';
