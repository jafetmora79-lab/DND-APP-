# Supabase setup

The app talks to Supabase when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set. Otherwise it uses the local SQLite server.

## 1. Project settings

In the Supabase dashboard:

1. **Authentication → Providers → Email** — turn **off** “Confirm email” (table-name + passcode login has no inbox).
2. **Authentication → Providers → Anonymous** — **enable** (players join with a personal code, not an email).
3. Copy **Project URL** and **anon public** key from **Settings → API**.
4. **Storage → New buckets** named `maps` and `pdfs`, both **public** (or run `storage-bucket.sql`). Character sheet PDFs upload to `pdfs`, falling back to `maps/character-pdfs/` if that bucket is missing.

Do not put the `service_role` key in the frontend.

## 2. Database

Open **SQL Editor → New query**, paste the **entire** `schema.sql` file, and click **Run**.

That creates every table (including `maps`), row-level security, the `join_table` / `peek_join` RPCs, realtime, and the `maps` + `pdfs` storage buckets. New projects should run this file only.

If you already ran an older `schema.sql` and creating a map fails with **blocked_cells** / schema cache, run `migrate-map-maker.sql` (or re-run the current `schema.sql`). It adds the column and reloads PostgREST.

If it was applied before encounter play (one token per monster copy, player start squares, player attacks), also run `migrate-encounter-play.sql`. The app can still save player starting squares without that column (it stores them with the monster JSON); the migrate is optional for this feature.

If it was applied before the campaign table (scene image between fights, next encounter, won/lost), also run `migrate-campaign-table.sql`.

If it was applied before combat completeness (advantage dice, death saves, turn reminders), also run `migrate-combat-completeness.sql`, then re-run the `resolve_player_attack` / `resolve_death_save` / `set_turn_economy` functions from `schema.sql`.

If it was applied before the campaign hub (timeline, quests, NPCs, loot), also run `migrate-campaign-mvp.sql`.

If it was applied before player combat (activity feed, declare/prompt, player end-turn), also run `migrate-player-combat.sql`.

If it was applied before campaign flow (skip dead on next turn, player initiative, join fight), also run `migrate-campaign-flow.sql`.

If it was applied before player token tap stat blocks, also run `migrate-vision-terrain.sql`.

If it was applied before cover terrain and Hide, also run `migrate-cover-hide.sql`.

## 3. App env

```bash
cp .env.example .env.local
```

Fill in the two `VITE_` values, then `npm run dev`. Claim a new table name — the SRD 5.1 bestiary seeds on first register.

## GitHub Pages

GitHub Pages can only host the static Vite build. It cannot run the SQLite server, so Pages **requires** the two `VITE_` secrets above. Add those secrets **once**. You do not re-add them after every push.

The live site currently republishes `/docs` on every push to `main`. That folder is a setup page, not the app. Switch Source to **GitHub Actions** so the secret-baked workflow artifact is what phones load.

1. Settings → Pages → Build and deployment → Source: **GitHub Actions** (required; “Deploy from a branch” / `/docs` republishes the setup page and makes `actions/deploy-pages` fail).
2. Repo **Actions secrets** (not Environments): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — once.
3. Actions → GitHub Pages → **Run workflow**. Wait about a minute.
4. If the site is `https://user.github.io/repo-name/`, add Actions variable `VITE_BASE` = `/repo-name/`.
5. The workflow sets `VITE_HASH_ROUTER=1` so refresh-on-a-subpath works.

A later push only updates the live site when that workflow ran. Cloud-agent merges often skip it — click **Run workflow** if the site looks old. Do not touch secrets.

Vercel or Netlify is simpler than Pages for a SPA (no hash router, no `VITE_BASE`) — same two env vars.
