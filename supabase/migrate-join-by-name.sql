-- Existing hosted projects: run this after schema.sql, then:
--   notify pgrst, 'reload schema';
-- Players join with their character name (Elara, Brok…). Old personal codes still work.

create or replace function public.join_table(p_join text, p_personal text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  sess record;
  ch record;
  q text;
  n int;
begin
  if auth.uid() is null then
    raise exception 'Sign-in required';
  end if;
  select * into sess from public.live_sessions where upper(join_code) = upper(trim(p_join));
  if not found then
    raise exception 'No table is using that join code tonight';
  end if;
  q := regexp_replace(btrim(coalesce(p_personal, '')), '\s+', ' ', 'g');
  if q = '' then
    raise exception 'Enter your character name.';
  end if;
  select count(*) into n from public.player_characters
    where campaign_id = sess.campaign_id
      and upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) = upper(q);
  if n > 1 then
    raise exception 'Two characters share that name. Ask the DM to rename one.';
  end if;
  if n = 1 then
    select * into ch from public.player_characters
      where campaign_id = sess.campaign_id
        and upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) = upper(q);
  else
    select count(*) into n from public.player_characters
      where campaign_id = sess.campaign_id
        and (upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) = upper(q)
          or upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) like upper(q) || ' %');
    if n > 1 then
      raise exception 'Several characters match that name. Use the full character name.';
    end if;
    if n = 1 then
      select * into ch from public.player_characters
        where campaign_id = sess.campaign_id
          and (upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) = upper(q)
            or upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) like upper(q) || ' %');
    else
      select * into ch from public.player_characters
        where campaign_id = sess.campaign_id and upper(personal_code) = upper(q);
      if not found then
        raise exception 'No character with that name at this table.';
      end if;
    end if;
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

grant execute on function public.join_table(text, text) to authenticated;
notify pgrst, 'reload schema';
