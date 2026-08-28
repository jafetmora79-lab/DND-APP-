-- D&D Live Table — paste this entire file into the Supabase SQL editor and Run (once).
-- New projects: this is the only SQL you need. Do not run migrate-map-maker.sql first.
-- Then: Authentication → Providers → enable Anonymous
--        Authentication → Providers → Email: turn OFF "Confirm email"

create extension if not exists "pgcrypto";

create table if not exists public.dm_accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  dm_account_id uuid not null references public.dm_accounts (id) on delete cascade,
  name text not null,
  hub_json jsonb not null default '{}'::jsonb
);

create table if not exists public.bestiary_monsters (
  id uuid primary key default gen_random_uuid(),
  dm_account_id uuid not null references public.dm_accounts (id) on delete cascade,
  name text not null,
  size text,
  creature_type text,
  alignment text,
  ac_value int,
  ac_note text,
  hp_max int,
  hit_dice_formula text,
  speed text,
  str int, dex int, con int, int_score int, wis int, cha int,
  saving_throws text,
  skills text,
  damage_vulnerabilities text,
  damage_resistances text,
  damage_immunities text,
  condition_immunities text,
  senses text,
  languages text,
  challenge_rating double precision,
  xp int,
  proficiency_bonus int,
  traits jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  legendary_actions jsonb not null default '[]'::jsonb,
  reactions jsonb not null default '[]'::jsonb,
  bonus_actions jsonb not null default '[]'::jsonb,
  lair_actions jsonb not null default '[]'::jsonb,
  source text
);

create table if not exists public.player_characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  personal_code text not null unique,
  owner_display_name text,
  name text,
  token_color text,
  source_pdf_url text,
  sheet_json jsonb not null
);

create table if not exists public.character_access (
  user_id uuid not null references auth.users (id) on delete cascade,
  character_id uuid not null references public.player_characters (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  primary key (user_id, campaign_id)
);

create table if not exists public.maps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name text not null,
  image_url text not null default '',
  grid_size int not null,
  grid_cols int not null,
  grid_rows int not null,
  grid_type text not null default 'square',
  blocked_cells jsonb not null default '[]'::jsonb
);

-- CREATE TABLE IF NOT EXISTS does not add new columns to an existing maps table.
alter table public.maps add column if not exists blocked_cells jsonb not null default '[]'::jsonb;

create table if not exists public.encounter_templates (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  map_id uuid not null references public.maps (id) on delete cascade,
  name text not null,
  monsters_json jsonb not null default '[]'::jsonb,
  characters_json jsonb not null default '[]'::jsonb
);

create table if not exists public.encounter_instances (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  encounter_template_id uuid,
  name text not null,
  status text not null,
  round_number int not null default 1,
  current_turn_position int not null default 0,
  fog_state jsonb not null,
  map_id uuid,
  activity_json jsonb not null default '[]'::jsonb,
  prompt_json jsonb
);

create table if not exists public.combatants (
  id uuid primary key default gen_random_uuid(),
  encounter_instance_id uuid not null references public.encounter_instances (id) on delete cascade,
  name text not null,
  source text not null,
  source_id text,
  initiative int not null default 0,
  hp_current int not null,
  hp_max int not null,
  hp_temp int not null default 0,
  ac int not null,
  conditions_json jsonb not null default '[]'::jsonb,
  turn_order_position int not null,
  color text,
  notes text,
  constitution int not null default 10,
  advantage_against_json jsonb not null default '[]'::jsonb,
  death_state text not null default 'ok',
  death_success int not null default 0,
  death_fail int not null default 0,
  turn_economy_json jsonb not null default '{"action":false,"bonus":false,"reaction":false,"movement":false}'::jsonb,
  stats_json jsonb,
  speed_feet int not null default 30,
  movement_remaining int not null default 30
);

create table if not exists public.tokens_on_map (
  id uuid primary key default gen_random_uuid(),
  encounter_instance_id uuid not null references public.encounter_instances (id) on delete cascade,
  x double precision not null,
  y double precision not null,
  ref_type text not null,
  ref_id uuid not null,
  label text,
  color text,
  size_squares int not null default 1,
  visible_to_players boolean not null default true
);

create table if not exists public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  encounter_instance_id uuid,
  created_at timestamptz not null default now(),
  table_phase text not null default 'table',
  ambiance_image_url text,
  ambiance_caption text not null default '',
  last_outcome text
);

create or replace function public.is_dm_of_campaign(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = cid and c.dm_account_id = auth.uid()
  );
$$;

create or replace function public.plays_in_campaign(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.character_access a
    where a.campaign_id = cid and a.user_id = auth.uid()
  );
$$;

create or replace function public.peek_join(p_join text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  sess record;
  camp text;
begin
  select * into sess from public.live_sessions where upper(join_code) = upper(trim(p_join));
  if not found then
    raise exception 'No table is using that join code tonight';
  end if;
  select name into camp from public.campaigns where id = sess.campaign_id;
  return json_build_object('campaignName', camp, 'joinCode', sess.join_code);
end;
$$;

create or replace function public.join_table(p_join text, p_personal text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  sess record;
  ch record;
begin
  if auth.uid() is null then
    raise exception 'Sign-in required';
  end if;
  select * into sess from public.live_sessions where upper(join_code) = upper(trim(p_join));
  if not found then
    raise exception 'No table is using that join code tonight';
  end if;
  select * into ch from public.player_characters
    where campaign_id = sess.campaign_id and upper(personal_code) = upper(trim(p_personal));
  if not found then
    raise exception 'That personal code does not belong to this campaign';
  end if;
  insert into public.character_access (user_id, character_id, campaign_id)
  values (auth.uid(), ch.id, ch.campaign_id)
  on conflict (user_id, campaign_id) do update set character_id = excluded.character_id;
  return json_build_object(
    'characterId', ch.id,
    'campaignId', ch.campaign_id,
    'name', ch.name
  );
end;
$$;

grant execute on function public.peek_join(text) to anon, authenticated;
grant execute on function public.join_table(text, text) to authenticated;
grant execute on function public.is_dm_of_campaign(uuid) to authenticated;
grant execute on function public.plays_in_campaign(uuid) to authenticated;

alter table public.campaigns add column if not exists hub_json jsonb not null default '{}'::jsonb;
alter table public.encounter_templates add column if not exists characters_json jsonb not null default '[]'::jsonb;
alter table public.combatants add column if not exists constitution int not null default 10;
alter table public.combatants add column if not exists advantage_against_json jsonb not null default '[]'::jsonb;
alter table public.combatants add column if not exists death_state text not null default 'ok';
alter table public.combatants add column if not exists death_success int not null default 0;
alter table public.combatants add column if not exists death_fail int not null default 0;
alter table public.combatants add column if not exists turn_economy_json jsonb not null default '{"action":false,"bonus":false,"reaction":false,"movement":false}'::jsonb;
alter table public.combatants add column if not exists stats_json jsonb;
alter table public.combatants add column if not exists speed_feet int not null default 30;
alter table public.combatants add column if not exists movement_remaining int not null default 30;
alter table public.encounter_instances add column if not exists activity_json jsonb not null default '[]'::jsonb;
alter table public.encounter_instances add column if not exists prompt_json jsonb;

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

create or replace function public.resolve_death_save(p_combatant uuid, p_d20 int)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  inst record;
  succ int;
  fail int;
  state text;
  hp int;
  cond jsonb;
  revived boolean := false;
  msg text;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  if p_d20 < 1 or p_d20 > 20 then raise exception 'd20 must be between 1 and 20'; end if;
  select * into c from public.combatants where id = p_combatant;
  if not found then raise exception 'Combatant not found'; end if;
  select * into inst from public.encounter_instances where id = c.encounter_instance_id;
  if not public.is_dm_of_campaign(inst.campaign_id)
     and not (c.source = 'character' and public.plays_in_campaign(inst.campaign_id) and exists (
       select 1 from public.character_access a where a.user_id = auth.uid() and a.character_id::text = c.source_id and a.campaign_id = inst.campaign_id
     )) then
    raise exception 'Not allowed';
  end if;
  if c.source <> 'character' then raise exception 'Death saves are for player characters'; end if;
  succ := coalesce(c.death_success, 0);
  fail := coalesce(c.death_fail, 0);
  state := coalesce(nullif(c.death_state, ''), 'ok');
  hp := c.hp_current;
  cond := coalesce(c.conditions_json, '[]'::jsonb);
  if state = 'dead' then
    return json_build_object('deathSuccess', succ, 'deathFail', fail, 'deathState', state, 'hpCurrent', hp, 'message', 'Already dead.', 'revived', false);
  end if;
  if state <> 'dying' then state := 'dying'; end if;
  if p_d20 >= 20 then
    hp := 1; state := 'ok'; succ := 0; fail := 0; revived := true;
    cond := coalesce((select jsonb_agg(to_jsonb(x)) from jsonb_array_elements_text(cond) x where x <> 'Unconscious'), '[]'::jsonb);
    msg := 'Natural 20 — regain 1 HP and wake.';
  elsif p_d20 <= 1 then
    fail := least(3, fail + 2);
    msg := 'Natural 1 — two death-save failures.';
  elsif p_d20 >= 10 then
    succ := least(3, succ + 1);
    msg := format('%s — death save success (%s/3).', p_d20, succ);
  else
    fail := least(3, fail + 1);
    msg := format('%s — death save failure (%s/3).', p_d20, fail);
  end if;
  if not revived and fail >= 3 then state := 'dead'; msg := msg || ' Dead.';
  elsif not revived and succ >= 3 then state := 'stable'; msg := msg || ' Stabilized.';
  end if;
  if not revived and (state = 'dying' or state = 'stable') and not (cond @> '"Unconscious"'::jsonb) then
    cond := cond || '"Unconscious"'::jsonb;
  end if;
  update public.combatants set death_state = state, death_success = succ, death_fail = fail, hp_current = hp, conditions_json = cond where id = c.id;
  return json_build_object('deathSuccess', succ, 'deathFail', fail, 'deathState', state, 'hpCurrent', hp, 'message', msg, 'revived', revived);
end;
$$;

create or replace function public.set_turn_economy(p_combatant uuid, p_economy jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  inst record;
  econ jsonb;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  select * into c from public.combatants where id = p_combatant;
  if not found then raise exception 'Combatant not found'; end if;
  select * into inst from public.encounter_instances where id = c.encounter_instance_id;
  if not public.is_dm_of_campaign(inst.campaign_id)
     and not (c.source = 'character' and exists (
       select 1 from public.character_access a where a.user_id = auth.uid() and a.character_id::text = c.source_id and a.campaign_id = inst.campaign_id
     )) then
    raise exception 'Not allowed';
  end if;
  econ := jsonb_build_object(
    'action', coalesce((p_economy->>'action')::boolean, false),
    'bonus', coalesce((p_economy->>'bonus')::boolean, false),
    'reaction', coalesce((p_economy->>'reaction')::boolean, false),
    'movement', coalesce((p_economy->>'movement')::boolean, false)
  );
  update public.combatants set turn_economy_json = econ where id = c.id;
  return json_build_object('ok', true);
end;
$$;

grant execute on function public.resolve_death_save(uuid, int) to authenticated;
grant execute on function public.set_turn_economy(uuid, jsonb) to authenticated;

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

grant execute on function public.move_combatant_token(uuid, double precision, double precision) to authenticated;
notify pgrst, 'reload schema';

alter table public.dm_accounts enable row level security;
alter table public.campaigns enable row level security;
alter table public.bestiary_monsters enable row level security;
alter table public.player_characters enable row level security;
alter table public.character_access enable row level security;
alter table public.maps enable row level security;
alter table public.encounter_templates enable row level security;
alter table public.encounter_instances enable row level security;
alter table public.combatants enable row level security;
alter table public.tokens_on_map enable row level security;
alter table public.live_sessions enable row level security;

drop policy if exists dm_accounts_self on public.dm_accounts;
drop policy if exists campaigns_dm on public.campaigns;
drop policy if exists campaigns_player_read on public.campaigns;
drop policy if exists bestiary_dm on public.bestiary_monsters;
drop policy if exists bestiary_player_fight on public.bestiary_monsters;
drop policy if exists characters_member on public.player_characters;
drop policy if exists characters_dm_write on public.player_characters;
drop policy if exists characters_owner_update on public.player_characters;
drop policy if exists access_self on public.character_access;
drop policy if exists maps_member on public.maps;
drop policy if exists maps_dm_write on public.maps;
drop policy if exists templates_dm on public.encounter_templates;
drop policy if exists instances_member on public.encounter_instances;
drop policy if exists instances_dm_write on public.encounter_instances;
drop policy if exists combatants_member on public.combatants;
drop policy if exists combatants_dm_write on public.combatants;
drop policy if exists tokens_member on public.tokens_on_map;
drop policy if exists tokens_dm_write on public.tokens_on_map;
drop policy if exists sessions_member on public.live_sessions;
drop policy if exists sessions_dm_write on public.live_sessions;

create policy dm_accounts_self on public.dm_accounts
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy campaigns_dm on public.campaigns
  for all using (dm_account_id = auth.uid()) with check (dm_account_id = auth.uid());
create policy campaigns_player_read on public.campaigns
  for select using (public.plays_in_campaign(id));

create policy bestiary_dm on public.bestiary_monsters
  for all using (dm_account_id = auth.uid()) with check (dm_account_id = auth.uid());
create policy bestiary_player_fight on public.bestiary_monsters
  for select using (
    exists (
      select 1
      from public.combatants c
      join public.encounter_instances i on i.id = c.encounter_instance_id
      where c.source = 'bestiary'
        and c.source_id = bestiary_monsters.id::text
        and public.plays_in_campaign(i.campaign_id)
    )
  );

create policy characters_member on public.player_characters
  for select using (public.is_dm_of_campaign(campaign_id) or public.plays_in_campaign(campaign_id));
create policy characters_dm_write on public.player_characters
  for all using (public.is_dm_of_campaign(campaign_id)) with check (public.is_dm_of_campaign(campaign_id));
create policy characters_owner_update on public.player_characters
  for update using (
    exists (
      select 1 from public.character_access a
      where a.character_id = player_characters.id and a.user_id = auth.uid()
    )
  );

create policy access_self on public.character_access
  for select using (user_id = auth.uid() or public.is_dm_of_campaign(campaign_id));

create policy maps_member on public.maps
  for select using (public.is_dm_of_campaign(campaign_id) or public.plays_in_campaign(campaign_id));
create policy maps_dm_write on public.maps
  for all using (public.is_dm_of_campaign(campaign_id)) with check (public.is_dm_of_campaign(campaign_id));

create policy templates_dm on public.encounter_templates
  for all using (public.is_dm_of_campaign(campaign_id)) with check (public.is_dm_of_campaign(campaign_id));

create policy instances_member on public.encounter_instances
  for select using (public.is_dm_of_campaign(campaign_id) or public.plays_in_campaign(campaign_id));
create policy instances_dm_write on public.encounter_instances
  for all using (public.is_dm_of_campaign(campaign_id)) with check (public.is_dm_of_campaign(campaign_id));

create policy combatants_member on public.combatants
  for select using (
    exists (
      select 1 from public.encounter_instances i
      where i.id = encounter_instance_id
        and (public.is_dm_of_campaign(i.campaign_id) or public.plays_in_campaign(i.campaign_id))
    )
  );
create policy combatants_dm_write on public.combatants
  for all using (
    exists (
      select 1 from public.encounter_instances i
      where i.id = encounter_instance_id and public.is_dm_of_campaign(i.campaign_id)
    )
  )
  with check (
    exists (
      select 1 from public.encounter_instances i
      where i.id = encounter_instance_id and public.is_dm_of_campaign(i.campaign_id)
    )
  );

create policy tokens_member on public.tokens_on_map
  for select using (
    exists (
      select 1 from public.encounter_instances i
      where i.id = encounter_instance_id
        and (public.is_dm_of_campaign(i.campaign_id) or public.plays_in_campaign(i.campaign_id))
    )
  );
create policy tokens_dm_write on public.tokens_on_map
  for all using (
    exists (
      select 1 from public.encounter_instances i
      where i.id = encounter_instance_id and public.is_dm_of_campaign(i.campaign_id)
    )
  )
  with check (
    exists (
      select 1 from public.encounter_instances i
      where i.id = encounter_instance_id and public.is_dm_of_campaign(i.campaign_id)
    )
  );

create policy sessions_member on public.live_sessions
  for select using (public.is_dm_of_campaign(campaign_id) or public.plays_in_campaign(campaign_id));
create policy sessions_dm_write on public.live_sessions
  for all using (public.is_dm_of_campaign(campaign_id)) with check (public.is_dm_of_campaign(campaign_id));

do $$
begin
  alter publication supabase_realtime add table public.encounter_instances;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.combatants;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.tokens_on_map;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.live_sessions;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.player_characters;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.campaigns;
exception when duplicate_object then null;
end $$;

insert into storage.buckets (id, name, public)
values ('maps', 'maps', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('pdfs', 'pdfs', true)
on conflict (id) do nothing;

drop policy if exists maps_public_read on storage.objects;
drop policy if exists maps_dm_write on storage.objects;
drop policy if exists maps_dm_update on storage.objects;
drop policy if exists maps_dm_delete on storage.objects;
drop policy if exists pdfs_public_read on storage.objects;
drop policy if exists pdfs_dm_write on storage.objects;
drop policy if exists pdfs_dm_update on storage.objects;
drop policy if exists pdfs_dm_delete on storage.objects;

create policy maps_public_read on storage.objects
  for select using (bucket_id = 'maps');
create policy maps_dm_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'maps');
create policy maps_dm_update on storage.objects
  for update to authenticated
  using (bucket_id = 'maps');
create policy maps_dm_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'maps');

create policy pdfs_public_read on storage.objects
  for select using (bucket_id = 'pdfs');
create policy pdfs_dm_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pdfs');
create policy pdfs_dm_update on storage.objects
  for update to authenticated
  using (bucket_id = 'pdfs');
create policy pdfs_dm_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'pdfs');

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

grant execute on function public.append_combat_activity(uuid, text) to authenticated;
grant execute on function public.declare_combat_action(uuid, text, text, uuid, uuid, text, text) to authenticated;
grant execute on function public.apply_hide_result(uuid, uuid, boolean, text, boolean, text) to authenticated;
grant execute on function public.set_combat_prompt(uuid, jsonb) to authenticated;
grant execute on function public.answer_combat_prompt(uuid, boolean, int, text) to authenticated;
grant execute on function public.player_advance_turn(uuid, int) to authenticated;
grant execute on function public.player_set_initiative(uuid, int) to authenticated;
grant execute on function public.player_join_fight(uuid) to authenticated;

notify pgrst, 'reload schema';
