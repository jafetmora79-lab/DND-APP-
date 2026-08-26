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

That creates every table (including `maps`), row-level security, the `join_table` / `peek_join` RPCs, realtime, and the `maps` + `pdfs` storage buckets.

Do **not** start with `migrate-map-maker.sql`. That file only adds `blocked_cells` to a `maps` table that already exists. On a new project it will do nothing useful and used to error with `relation "public.maps" does not exist`.

## 3. App env

```bash
cp .env.example .env.local
```

Fill in the two `VITE_` values, then `npm run dev`. Claim a new table name — the SRD 5.1 bestiary seeds on first register.

## GitHub Pages

GitHub Pages can only host the static Vite build. It cannot run the SQLite server, so Pages **requires** the two `VITE_` secrets above.

1. Push this repo to GitHub.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions** (required; “Deploy from a branch” / `/docs` makes `actions/deploy-pages` 404).
3. Repo **Actions secrets** (not Environments): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
4. If the site is `https://user.github.io/repo-name/`, add Actions variable `VITE_BASE` = `/repo-name/`.
5. The workflow sets `VITE_HASH_ROUTER=1` so refresh-on-a-subpath works.

Vercel or Netlify is simpler than Pages for a SPA (no hash router, no `VITE_BASE`) — same two env vars.
