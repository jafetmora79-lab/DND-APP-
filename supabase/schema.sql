-- D&D Live Table — run this in the Supabase SQL editor (once).
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
  name text not null
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
  map_id uuid
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
  advantage_against_json jsonb not null default '[]'::jsonb
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
  created_at timestamptz not null default now()
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

alter table public.encounter_templates add column if not exists characters_json jsonb not null default '[]'::jsonb;
alter table public.combatants add column if not exists constitution int not null default 10;
alter table public.combatants add column if not exists advantage_against_json jsonb not null default '[]'::jsonb;

drop function if exists public.resolve_player_attack(uuid, uuid, int, int, int);
drop function if exists public.resolve_player_attack(uuid, uuid, int, int, int, uuid);

create or replace function public.resolve_player_attack(
  p_instance uuid,
  p_target uuid,
  p_attack_index int,
  p_d20 int,
  p_damage int,
  p_attacker uuid default null
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
  if dist_sq * 5 > range_ft then
    raise exception 'That creature is out of range (% ft away, range % ft)', dist_sq * 5, range_ft;
  end if;

  total := p_d20 + bonus;
  crit := p_d20 >= 20;
  fumble := p_d20 <= 1;
  attacker_adv := coalesce(attacker.advantage_against_json, '[]'::jsonb);
  target_adv := coalesce(target.advantage_against_json, '[]'::jsonb);
  had_adv := attacker_adv @> to_jsonb(target.id::text);
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
    hit := total > target.ac;
  end if;
  update public.combatants set advantage_against_json = attacker_adv where id = attacker.id;
  update public.combatants set advantage_against_json = target_adv where id = target.id;

  if not hit then
    if fumble then
      msg := format('Natural 1 against %s — miss. %s has advantage against %s next turn.', target.name, target.name, attacker.name);
    else
      msg := format('%s vs AC %s — need higher than %s to hit %s.', total, target.ac, target.ac, target.name);
    end if;
    return json_build_object(
      'hit', false,
      'crit', false,
      'fumble', fumble,
      'hadAdvantage', had_adv,
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
    msg := format('Hit %s (%s beats AC %s) for %s damage (%s HP left).', target.name, total, target.ac, p_damage, new_hp);
  end if;

  return json_build_object(
    'hit', true,
    'crit', crit,
    'fumble', false,
    'hadAdvantage', had_adv,
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

grant execute on function public.resolve_player_attack(uuid, uuid, int, int, int, uuid) to authenticated;
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

create policy dm_accounts_self on public.dm_accounts
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy campaigns_dm on public.campaigns
  for all using (dm_account_id = auth.uid()) with check (dm_account_id = auth.uid());
create policy campaigns_player_read on public.campaigns
  for select using (public.plays_in_campaign(id));

create policy bestiary_dm on public.bestiary_monsters
  for all using (dm_account_id = auth.uid()) with check (dm_account_id = auth.uid());

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

alter publication supabase_realtime add table public.encounter_instances;
alter publication supabase_realtime add table public.combatants;
alter publication supabase_realtime add table public.tokens_on_map;
alter publication supabase_realtime add table public.live_sessions;
alter publication supabase_realtime add table public.player_characters;

insert into storage.buckets (id, name, public)
values ('maps', 'maps', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('pdfs', 'pdfs', true)
on conflict (id) do nothing;

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
