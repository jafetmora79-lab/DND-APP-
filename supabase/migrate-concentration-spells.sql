-- Existing hosted projects: run this in the Supabase SQL Editor, then:
--   notify pgrst, 'reload schema';
-- New projects that ran the current schema.sql already have these RPCs.
--
-- Spell casting and concentration:
--   1. declare_combat_action gains 'castSpell' / 'concentrate' kinds — cast
--      a specific prepared spell (client tracks/decrements the spell slot
--      on the character sheet separately); 'concentrate' also tags the
--      caster Concentrating.
--   2. resolve_player_attack: when a hit damages a Concentrating target,
--      it either clears the tag (if the hit drops them to 0 HP) or sets an
--      automatic Constitution save prompt at DC max(10, damage/2), tagged
--      reason: 'concentration'.
--   3. answer_combat_prompt: failing a save prompt tagged reason:
--      'concentration' clears the Concentrating condition.
--
-- Full current definitions of all three functions below (safe to re-run).

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
    attacks_per_action := greatest(1, coalesce(beast.attacks_per_action, 1));
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
  if coalesce(target.conditions_json, '[]'::jsonb) @> '"Concentrating"'::jsonb then
    if new_hp <= 0 then
      update public.combatants
        set conditions_json = coalesce((
              select jsonb_agg(to_jsonb(x))
              from jsonb_array_elements_text(coalesce(conditions_json, '[]'::jsonb)) x
              where lower(x) <> 'concentrating'
            ), '[]'::jsonb)
        where id = target.id;
      perform public.push_combat_activity(inst.id, format('%s lost concentration.', target.name));
    elsif p_damage > 0 then
      update public.encounter_instances
        set prompt_json = jsonb_build_object(
          'kind', 'save', 'combatantId', target.id, 'ability', 'con', 'dc', greatest(10, p_damage / 2), 'reason', 'concentration'
        )
        where id = inst.id;
      perform public.push_combat_activity(
        inst.id, format('%s must make a DC %s Constitution save to maintain concentration.', target.name, greatest(10, p_damage / 2))
      );
    end if;
  end if;
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
  kind := lower(coalesce(p_kind, ''));
  if kind = 'interact' then
    if coalesce((econ->>'interact')::boolean, false) then
      raise exception 'You already used your free object interaction this turn.';
    end if;
  elsif coalesce((econ->>slot)::boolean, false) then
    raise exception 'Your % is already used.', slot;
  end if;
  cond := coalesce(c.conditions_json, '[]'::jsonb);
  speed := coalesce(c.speed_feet, 30);
  remaining := greatest(0, coalesce(c.movement_remaining, speed));
  if kind = 'interact' then
    label := trim(coalesce(p_other, ''));
    if label = '' then raise exception 'Say what you want to interact with.'; end if;
    txt := format('%s interacts with %s (free object interaction).', c.name, label);
  elsif kind = 'ready' then
    label := trim(coalesce(p_custom, p_other, ''));
    if label = '' then raise exception 'Describe your trigger and response for Ready.'; end if;
    txt := format('%s readied an action: %s.', c.name, label);
  elsif kind in ('castspell', 'concentrate') then
    label := trim(coalesce(p_other, ''));
    if label = '' then raise exception 'Pick a spell to cast.'; end if;
    if kind = 'concentrate' and not (cond @> '"Concentrating"'::jsonb) then
      cond := cond || jsonb_build_array('Concentrating');
    end if;
    txt := format('%s casts %s%s.', c.name, label, case when kind = 'concentrate' then ' (concentrating)' else '' end);
  elsif kind = 'dash' then
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
  if kind in ('dash', 'help', 'other', 'custom', 'interact', 'ready', 'castspell', 'concentrate') then
    cond := coalesce((
      select jsonb_agg(to_jsonb(x))
      from jsonb_array_elements_text(coalesce(cond, '[]'::jsonb)) x
      where lower(x) <> 'hiding'
    ), '[]'::jsonb);
  end if;
  if kind = 'interact' then
    econ := jsonb_set(econ, '{interact}', 'true'::jsonb);
  else
    econ := jsonb_set(econ, array[slot], 'true'::jsonb);
  end if;
  update public.combatants
    set conditions_json = cond, turn_economy_json = econ, movement_remaining = remaining
    where id = c.id;
  perform public.push_combat_activity(inst.id, txt);
  return json_build_object('text', txt);
end;
$$;

create or replace function public.answer_combat_prompt(
  p_instance uuid,
  p_use boolean default null,
  p_d20 int default null,
  p_other text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  inst record;
  c record;
  prompt jsonb;
  kind text;
  is_dm boolean;
  is_owner boolean;
  ability text;
  dc int;
  sheet jsonb;
  score int;
  modifier int;
  lvl int;
  prof int;
  total int;
  ok boolean;
  txt text;
  econ jsonb;
  note text;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  select * into inst from public.encounter_instances where id = p_instance;
  if not found then raise exception 'Encounter not found'; end if;
  prompt := inst.prompt_json;
  if prompt is null then raise exception 'Nothing is waiting.'; end if;
  kind := prompt->>'kind';
  select * into c from public.combatants where id = (prompt->>'combatantId')::uuid and encounter_instance_id = inst.id;
  if not found then raise exception 'Combatant not found'; end if;
  is_dm := public.is_dm_of_campaign(inst.campaign_id);
  is_owner := c.source = 'character' and exists (
    select 1 from public.character_access a
    where a.user_id = auth.uid() and a.campaign_id = inst.campaign_id and a.character_id::text = c.source_id
  );
  if not is_dm and not is_owner then raise exception 'This prompt is not for you.'; end if;
  if kind = 'save' then
    if p_d20 is null or p_d20 < 1 or p_d20 > 20 then raise exception 'd20 must be between 1 and 20'; end if;
    ability := lower(coalesce(nullif(prompt->>'ability', ''), 'dex'));
    dc := coalesce((prompt->>'dc')::int, 13);
    modifier := 0;
    if c.source = 'character' then
      select sheet_json into sheet from public.player_characters where id = c.source_id::uuid;
      score := coalesce((sheet->'abilities'->>ability)::int, 10);
      modifier := floor((score - 10)::numeric / 2)::int;
      if coalesce((sheet->'savingThrowProf'->>ability)::boolean, false) then
        lvl := coalesce((sheet->>'level')::int, 1);
        prof := 2 + greatest(0, floor((lvl - 1)::numeric / 4)::int);
        modifier := modifier + prof;
      end if;
    else
      score := coalesce((c.stats_json->>ability)::int, case when ability = 'con' then coalesce(c.constitution, 10) else 10 end);
      modifier := floor((score - 10)::numeric / 2)::int;
    end if;
    total := p_d20 + modifier;
    ok := total >= dc;
    txt := format('%s %s save: %s %s%s = %s — %s.',
      c.name, upper(ability), p_d20, case when modifier >= 0 then '+' else '' end, modifier, total,
      case when ok then 'SUCCESS' else 'FAILURE' end);
    if coalesce(prompt->>'reason', '') = 'concentration' and not ok
       and coalesce(c.conditions_json, '[]'::jsonb) @> '"Concentrating"'::jsonb then
      update public.combatants
        set conditions_json = coalesce((
              select jsonb_agg(to_jsonb(x))
              from jsonb_array_elements_text(coalesce(conditions_json, '[]'::jsonb)) x
              where lower(x) <> 'concentrating'
            ), '[]'::jsonb)
        where id = c.id;
      txt := txt || ' Lost concentration.';
    end if;
    perform public.push_combat_activity(inst.id, txt);
    update public.encounter_instances set prompt_json = null where id = inst.id;
    return json_build_object('success', ok, 'total', total, 'message', txt);
  end if;
  if coalesce(p_use, false) then
    econ := jsonb_set(coalesce(c.turn_economy_json, '{}'::jsonb), '{reaction}', 'true'::jsonb);
    update public.combatants set turn_economy_json = econ where id = c.id;
    note := trim(coalesce(p_other, ''));
    if note <> '' then
      perform public.push_combat_activity(inst.id, format('%s used their Reaction (%s).', c.name, note));
    else
      perform public.push_combat_activity(inst.id, format('%s used their Reaction.', c.name));
    end if;
  else
    perform public.push_combat_activity(inst.id, format('%s declined a Reaction.', c.name));
  end if;
  update public.encounter_instances set prompt_json = null where id = inst.id;
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.resolve_player_attack(uuid, uuid, int, int, int, uuid, int, text, int, text) to authenticated;
grant execute on function public.declare_combat_action(uuid, text, text, uuid, uuid, text, text) to authenticated;
grant execute on function public.answer_combat_prompt(uuid, boolean, int, text) to authenticated;

notify pgrst, 'reload schema';
