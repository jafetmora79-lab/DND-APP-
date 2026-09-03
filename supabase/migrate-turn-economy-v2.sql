-- Existing hosted projects: run this after schema.sql (and after
-- migrate-action-economy.sql, if not already applied), then:
--   notify pgrst, 'reload schema';
-- New projects that ran the current schema.sql already have these RPCs.
--
-- Adds two new declare-action kinds and gives Dodge real teeth:
--   1. 'interact' — the free object interaction (draw a weapon, open a
--      door, pick something up). Does NOT spend the Action/Bonus/Reaction
--      slot; instead it spends a new `interact` flag on turn_economy_json,
--      capped at once per turn like the free interaction RAW allows.
--   2. 'ready' — the Ready action. Spends the chosen slot (normally
--      Action) and logs the player's trigger + response.
--   3. Dodge's disadvantage-on-attackers effect is enforced client-side
--      (src/lib/combat.ts effectiveRollMode) using the existing 'Dodging'
--      condition tag this function already writes — no schema change
--      needed for that part.
--
-- Safe to re-run.

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
  if kind in ('dash', 'help', 'other', 'custom', 'interact', 'ready') then
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
      set turn_economy_json = '{"action":false,"bonus":false,"reaction":false,"movement":false,"interact":false}'::jsonb,
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

grant execute on function public.declare_combat_action(uuid, text, text, uuid, uuid, text, text) to authenticated;
grant execute on function public.player_advance_turn(uuid, int) to authenticated;

notify pgrst, 'reload schema';
