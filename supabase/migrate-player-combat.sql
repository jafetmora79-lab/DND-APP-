-- Player combat: activity feed, declare/prompt RPCs, player end-turn, move feed lines.
-- Then: notify pgrst, 'reload schema';

alter table public.encounter_instances add column if not exists activity_json jsonb not null default '[]'::jsonb;
alter table public.encounter_instances add column if not exists prompt_json jsonb;

create or replace function public.push_combat_activity(p_instance uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cur jsonb;
  line jsonb;
  next jsonb;
  cap int := 40;
begin
  if coalesce(trim(p_text), '') = '' then return; end if;
  select coalesce(activity_json, '[]'::jsonb) into cur from public.encounter_instances where id = p_instance;
  if not found then return; end if;
  line := jsonb_build_object(
    'id', substr(md5(random()::text || clock_timestamp()::text), 1, 8),
    'at', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'text', trim(p_text)
  );
  next := coalesce(cur, '[]'::jsonb) || jsonb_build_array(line);
  if jsonb_array_length(next) > cap then
    select coalesce(jsonb_agg(elem order by n), '[]'::jsonb) into next
    from (
      select elem, n
      from jsonb_array_elements(next) with ordinality as t(elem, n)
      where n > jsonb_array_length(next) - cap
    ) s;
  end if;
  update public.encounter_instances set activity_json = next where id = p_instance;
end;
$$;

create or replace function public.append_combat_activity(p_instance uuid, p_text text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  inst record;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  select * into inst from public.encounter_instances where id = p_instance;
  if not found then raise exception 'Encounter not found'; end if;
  if not public.is_dm_of_campaign(inst.campaign_id) and not public.plays_in_campaign(inst.campaign_id) then
    raise exception 'Not allowed';
  end if;
  perform public.push_combat_activity(p_instance, p_text);
  return json_build_object('ok', true);
end;
$$;

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
    if not (cond @> '"Hiding"'::jsonb) then cond := cond || jsonb_build_array('Hiding'); end if;
    txt := format('%s used Hide.', c.name);
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
  econ := jsonb_set(econ, array[slot], 'true'::jsonb);
  update public.combatants
    set conditions_json = cond, turn_economy_json = econ, movement_remaining = remaining
    where id = c.id;
  perform public.push_combat_activity(inst.id, txt);
  return json_build_object('text', txt);
end;
$$;

create or replace function public.set_combat_prompt(p_instance uuid, p_prompt jsonb default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  inst record;
  kind text;
  cid text;
  parsed jsonb;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  select * into inst from public.encounter_instances where id = p_instance;
  if not found then raise exception 'Encounter not found'; end if;
  if not public.is_dm_of_campaign(inst.campaign_id) then raise exception 'Not allowed'; end if;
  if p_prompt is null or coalesce(p_prompt->>'kind', '') = '' then
    update public.encounter_instances set prompt_json = null where id = inst.id;
    return json_build_object('ok', true);
  end if;
  kind := p_prompt->>'kind';
  cid := coalesce(p_prompt->>'combatantId', p_prompt->>'combatant_id', '');
  if kind not in ('reaction', 'save') or cid = '' then raise exception 'Invalid prompt'; end if;
  parsed := jsonb_build_object('kind', kind, 'combatantId', cid);
  if coalesce(p_prompt->>'ability', '') <> '' then
    parsed := parsed || jsonb_build_object('ability', p_prompt->>'ability');
  end if;
  if coalesce(p_prompt->>'dc', '') <> '' then
    parsed := parsed || jsonb_build_object('dc', (p_prompt->>'dc')::int);
  end if;
  update public.encounter_instances set prompt_json = parsed where id = inst.id;
  return json_build_object('ok', true);
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

create or replace function public.player_advance_turn(p_instance uuid)
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
  select count(*) into n from public.combatants where encounter_instance_id = inst.id;
  if n = 0 then return json_build_object('ok', true); end if;
  pos := inst.current_turn_position + 1;
  rnd := inst.round_number;
  if pos >= n then
    pos := 0;
    rnd := rnd + 1;
  end if;
  update public.encounter_instances set current_turn_position = pos, round_number = rnd where id = inst.id;
  select * into nxt from public.combatants
    where encounter_instance_id = inst.id and turn_order_position = pos;
  if found then
    update public.combatants
      set turn_economy_json = '{"action":false,"bonus":false,"reaction":false,"movement":false}'::jsonb,
          movement_remaining = coalesce(speed_feet, 30)
      where id = nxt.id;
  end if;
  return json_build_object('ok', true, 'round', rnd, 'pos', pos);
end;
$$;

create or replace function public.move_combatant_token(p_token uuid, p_x double precision, p_y double precision)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  tok record;
  inst record;
  c record;
  map_row record;
  cell int;
  from_col int;
  from_row int;
  to_col int;
  to_row int;
  cost int;
  left_ft int;
  is_dm boolean;
  is_owner boolean;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  select * into tok from public.tokens_on_map where id = p_token;
  if not found then raise exception 'Token not found'; end if;
  select * into inst from public.encounter_instances where id = tok.encounter_instance_id;
  if not found then raise exception 'Encounter not found'; end if;
  select * into c from public.combatants where id = tok.ref_id;
  if not found then raise exception 'Combatant not found'; end if;
  is_dm := public.is_dm_of_campaign(inst.campaign_id);
  is_owner := c.source = 'character' and exists (
    select 1 from public.character_access a
    where a.user_id = auth.uid() and a.campaign_id = inst.campaign_id and a.character_id::text = c.source_id
  );
  if not is_dm and not is_owner then raise exception 'Not found'; end if;
  if not is_dm and c.turn_order_position is distinct from inst.current_turn_position then
    raise exception 'Wait for your turn to move.';
  end if;
  cell := 70;
  if inst.map_id is not null then
    select * into map_row from public.maps where id = inst.map_id;
    if found then cell := map_row.grid_size; end if;
  end if;
  from_col := round((tok.x - cell / 2.0) / cell);
  from_row := round((tok.y - cell / 2.0) / cell);
  to_col := round((p_x - cell / 2.0) / cell);
  to_row := round((p_y - cell / 2.0) / cell);
  cost := greatest(abs(from_col - to_col), abs(from_row - to_row)) * 5;
  if (is_owner or c.turn_order_position = inst.current_turn_position) and cost > 0 and c.turn_order_position = inst.current_turn_position then
    left_ft := coalesce(c.movement_remaining, c.speed_feet, 30);
    if cost > left_ft then
      raise exception 'Not enough movement (% ft left, need % ft).', left_ft, cost;
    end if;
    update public.combatants set movement_remaining = left_ft - cost where id = c.id;
    perform public.push_combat_activity(inst.id, format('%s moved %s ft.', c.name, cost));
  end if;
  update public.tokens_on_map set x = p_x, y = p_y where id = p_token;
  return json_build_object('ok', true, 'remaining', coalesce((select movement_remaining from public.combatants where id = c.id), 0));
end;
$$;

grant execute on function public.append_combat_activity(uuid, text) to authenticated;
grant execute on function public.declare_combat_action(uuid, text, text, uuid, uuid, text, text) to authenticated;
grant execute on function public.set_combat_prompt(uuid, jsonb) to authenticated;
grant execute on function public.answer_combat_prompt(uuid, boolean, int, text) to authenticated;
grant execute on function public.player_advance_turn(uuid) to authenticated;
grant execute on function public.move_combatant_token(uuid, double precision, double precision) to authenticated;

notify pgrst, 'reload schema';
