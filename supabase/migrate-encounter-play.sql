-- Run in the SQL Editor if schema.sql was already applied before encounter play (quantity tokens, player starts, player attacks).

alter table public.encounter_templates add column if not exists characters_json jsonb not null default '[]'::jsonb;
alter table public.combatants add column if not exists constitution int not null default 10;

create or replace function public.resolve_player_attack(
  p_instance uuid,
  p_target uuid,
  p_attack_index int,
  p_d20 int,
  p_damage int
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
  atk jsonb;
  bonus int;
  range_ft int;
  dist_sq int;
  hit boolean;
  crit boolean;
  total int;
  new_temp int;
  new_hp int;
  sheet jsonb;
  msg text;
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

  select * into target from public.combatants
    where id = p_target and encounter_instance_id = inst.id;
  if not found then
    raise exception 'Target not found';
  end if;
  if target.id = attacker.id then
    raise exception 'Pick a different creature';
  end if;

  sheet := ch.sheet_json;
  if jsonb_typeof(sheet->'attacks') is distinct from 'array' then
    raise exception 'No attacks on your sheet';
  end if;
  atk := sheet->'attacks'->p_attack_index;
  if atk is null or coalesce(atk->>'name','') = '' then
    raise exception 'That attack is not on your sheet';
  end if;

  bonus := coalesce((regexp_match(coalesce(atk->>'bonus', '0'), '([+-]?[0-9]+)'))[1]::int, 0);
  range_ft := coalesce((regexp_match(coalesce(nullif(atk->>'range', ''), '5'), '([0-9]+)'))[1]::int, 5);
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
  if dist_sq * 5 > range_ft then
    raise exception 'That creature is out of range (% ft away, range % ft)', dist_sq * 5, range_ft;
  end if;

  total := p_d20 + bonus;
  crit := p_d20 >= 20;
  if p_d20 <= 1 then
    hit := false;
  elsif crit then
    hit := true;
  else
    hit := total >= target.ac;
  end if;

  if not hit then
    if p_d20 = 1 then
      msg := format('Natural 1 against %s — miss.', target.name);
    else
      msg := format('%s vs AC %s — miss on %s.', total, target.ac, target.name);
    end if;
    return json_build_object(
      'hit', false,
      'crit', false,
      'total', total,
      'ac', target.ac,
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
  if target.source = 'character' then
    update public.player_characters
      set sheet_json = jsonb_set(jsonb_set(coalesce(sheet_json, '{}'::jsonb), '{hpCurrent}', to_jsonb(new_hp)), '{hpTemp}', to_jsonb(new_temp))
      where id = target.source_id::uuid;
  end if;

  if crit then
    msg := format('Natural 20! %s damage to %s (%s HP left).', p_damage, target.name, new_hp);
  else
    msg := format('Hit %s (%s vs AC %s) for %s damage (%s HP left).', target.name, total, target.ac, p_damage, new_hp);
  end if;

  return json_build_object(
    'hit', true,
    'crit', crit,
    'total', total,
    'ac', target.ac,
    'damage', p_damage,
    'hpCurrent', new_hp,
    'hpTemp', new_temp,
    'targetName', target.name,
    'message', msg
  );
end;
$$;

grant execute on function public.resolve_player_attack(uuid, uuid, int, int, int) to authenticated;
notify pgrst, 'reload schema';
