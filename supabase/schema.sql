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
  monsters_json jsonb not null default '[]'::jsonb
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
  notes text
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
