-- Existing hosted projects: run this in the Supabase SQL Editor, then:
--   notify pgrst, 'reload schema';
-- New projects that ran the current schema.sql already have this RPC.
--
-- Help now has a real effect: after picking an ally (p_target) you also
-- pick which enemy they should have advantage against (reusing p_other,
-- so the function signature is unchanged). That enemy's id is added to
-- the ally's advantage_against_json, the same mechanism already used for
-- Hide and fumble-granted advantage, so their next attack roll against
-- that enemy is automatically at advantage.
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
  enemy record;
  ally_adv jsonb;
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
    if coalesce(p_other, '') = '' then raise exception 'Pick who they should have advantage against.'; end if;
    select * into enemy from public.combatants where id = (p_other)::uuid and encounter_instance_id = inst.id;
    if not found or enemy.id = ally.id or enemy.id = c.id then
      raise exception 'Pick who they should have advantage against.';
    end if;
    ally_adv := coalesce(ally.advantage_against_json, '[]'::jsonb);
    if not (ally_adv @> to_jsonb(enemy.id::text)) then
      ally_adv := ally_adv || jsonb_build_array(enemy.id::text);
    end if;
    update public.combatants set advantage_against_json = ally_adv where id = ally.id;
    txt := format('%s helps %s against %s. %s has advantage on their next attack against %s.', c.name, ally.name, enemy.name, ally.name, enemy.name);
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

grant execute on function public.declare_combat_action(uuid, text, text, uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
