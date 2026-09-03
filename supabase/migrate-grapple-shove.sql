-- Existing hosted projects: run this in the Supabase SQL Editor, then:
--   notify pgrst, 'reload schema';
-- New projects that ran the current schema.sql already have this RPC.
--
-- Grapple and Shove: previously just flat text declarations with no effect.
-- The client now resolves the contest (attacker's Athletics roll vs. the
-- target's static defense, same pattern as Hide vs. passive Perception) and
-- calls this function to persist the outcome: it locks the attacker's
-- chosen slot and, on success, tags the target Grappled or Prone.
--
-- Safe to re-run.

create or replace function public.apply_contest_result(
  p_instance uuid,
  p_combatant uuid,
  p_target uuid,
  p_kind text,
  p_success boolean,
  p_text text default '',
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
  t record;
  is_dm boolean;
  slot text;
  econ jsonb;
  cond jsonb;
  txt text;
  label text;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  select * into inst from public.encounter_instances where id = p_instance;
  if not found then raise exception 'Encounter not found'; end if;
  is_dm := public.is_dm_of_campaign(inst.campaign_id);
  if is_dm then
    select * into c from public.combatants where id = p_combatant and encounter_instance_id = inst.id;
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
  select * into t from public.combatants where id = p_target and encounter_instance_id = inst.id;
  if not found then raise exception 'Target not found'; end if;
  if t.id = c.id then raise exception 'Pick a different creature'; end if;
  slot := case when p_slot in ('bonus', 'reaction') then p_slot else 'action' end;
  econ := coalesce(c.turn_economy_json, '{}'::jsonb);
  if coalesce((econ->>slot)::boolean, false) then
    raise exception 'Your % is already used.', slot;
  end if;
  econ := jsonb_set(econ, array[slot], 'true'::jsonb);
  cond := coalesce((
    select jsonb_agg(to_jsonb(x))
    from jsonb_array_elements_text(coalesce(c.conditions_json, '[]'::jsonb)) x
    where lower(x) <> 'hiding'
  ), '[]'::jsonb);
  update public.combatants set turn_economy_json = econ, conditions_json = cond where id = c.id;
  txt := coalesce(nullif(trim(p_text), ''), format('%s attempts a %s on %s.', c.name, p_kind, t.name));
  if p_success then
    label := case when lower(p_kind) = 'grapple' then 'Grappled' else 'Prone' end;
    if not (coalesce(t.conditions_json, '[]'::jsonb) @> to_jsonb(label)) then
      update public.combatants
        set conditions_json = coalesce(t.conditions_json, '[]'::jsonb) || to_jsonb(label)
        where id = t.id;
    end if;
  end if;
  perform public.push_combat_activity(inst.id, txt);
  return json_build_object('text', txt, 'success', p_success);
end;
$$;

grant execute on function public.apply_contest_result(uuid, uuid, uuid, text, boolean, text, text) to authenticated;

notify pgrst, 'reload schema';
