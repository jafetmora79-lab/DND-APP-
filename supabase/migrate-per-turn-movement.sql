-- Per-turn walk speed on combatants. Diagonal = 5 ft (same Chebyshev grid as attacks).
alter table public.combatants add column if not exists speed_feet int not null default 30;
alter table public.combatants add column if not exists movement_remaining int not null default 30;

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
  end if;
  update public.tokens_on_map set x = p_x, y = p_y where id = p_token;
  return json_build_object('ok', true, 'remaining', coalesce((select movement_remaining from public.combatants where id = c.id), 0));
end;
$$;

grant execute on function public.move_combatant_token(uuid, double precision, double precision) to authenticated;

notify pgrst, 'reload schema';
