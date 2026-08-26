# Supabase setup

The app talks to Supabase when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set. Otherwise it uses the local SQLite server.

## 1. Project settings

In the Supabase dashboard:

1. **Authentication → Providers → Email** — turn **off** “Confirm email” (table-name + passcode login has no inbox).
2. **Authentication → Providers → Anonymous** — **enable** (players join with a personal code, not an email).
3. Copy **Project URL** and **anon public** key from **Settings → API**.
4. **Storage → New bucket** named `maps`, set to **public** (or run `storage-bucket.sql`).

Do not put the `service_role` key in the frontend.

## 2. Database

Run `schema.sql` once in **SQL Editor**.

That creates tables, row-level security, the `join_table` / `peek_join` RPCs, realtime publication, and a public `maps` storage bucket.

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
