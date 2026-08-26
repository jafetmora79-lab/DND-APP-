# D&D Live Table

A campaign companion for running Dungeons & Dragons 5e at a real table: a persistent DM library, a live session that phones can follow, character sheets the whole party can read, and encounters you can pause mid-fight and resume next week — HP, positions, turn order, and fog included.

Monster stat blocks are seeded from the Systems Reference Document 5.1 (© Wizards of the Coast, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Structured JSON comes from the [5e-bits/5e-database](https://github.com/5e-bits/5e-database) project.

## What you can do

- **Dungeon Master login** with a table name and passcode. Run as many campaigns as you want.
- **Shared bestiary** across every campaign at that table (~300 SRD creatures, plus your own).
- **Prep library** per campaign: battle maps, encounter templates, player characters with personal join codes.
- **Live session**: start a new fight from a template or resume a paused one. Players enter tonight’s join code plus their personal character code.
- **Map & tokens** (Konva): pan/zoom, drag tokens on a square grid, paint fog of war. Players watch; only the DM moves pieces.
- **Encounter tracker**: initiative, current/max/temp HP, conditions, next-turn. State hangs off the encounter instance, not the night’s join code.
- **Character sheets** with Combat / Skills / Spells / Bio. Empty tabs hide. Ability modifiers, skill bonuses, and passive Perception calculate automatically. Visible to everyone; editable by the owner and the DM.
- **Fillable PDF import** reads named form fields (no OCR). Manual entry remains as a fallback.

## Run locally

```bash
npm install
npm run dev
```

Then open [http://127.0.0.1:4731](http://127.0.0.1:4731).

The Vite app proxies `/api` and `/ws` to the SQLite + WebSocket server on port **4732**. Data lives in `data/table.sqlite`; uploaded maps and PDFs live in `uploads/`.

To host the table so phones can join from anywhere, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see [supabase/README.md](supabase/README.md)). GitHub Pages can serve the static app only — it cannot replace that backend.

Public repo: [jafetmora79-lab/DND-APP-](https://github.com/jafetmora79-lab/DND-APP-). After Pages is enabled, the live URL is [https://jafetmora79-lab.github.io/DND-APP-/](https://jafetmora79-lab.github.io/DND-APP-/).

### GitHub Pages (one-time)

1. Open [Pages settings](https://github.com/jafetmora79-lab/DND-APP-/settings/pages) → **Source** → **GitHub Actions**.
2. Open [Actions secrets](https://github.com/jafetmora79-lab/DND-APP-/settings/secrets/actions) and add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Re-run the **GitHub Pages** workflow (or push to `main`).

Without those two secrets the Pages build still succeeds, but the site has no hosted backend — phones cannot join. Hosted passcodes must be **at least 6 characters** (Supabase Auth). The local sample passcode `torch` only works on `npm run dev`.

### Sample table

A seeded campaign is ready on first boot:

| Role | How to enter |
| --- | --- |
| Dungeon Master | Table **Hearthkeeper**, passcode **torch** |
| Player (Elara) | Join code **HEARTH**, personal code **ELARA7K2** |
| Player (Brok) | Join code **HEARTH**, personal code **BROK4M9X** |

The **Cragmaw Ambush** is paused in round 2 with the bugbear already wounded. Open Live as the DM and hit Resume, or join as a player and watch the map.

## Architecture

Without env vars, the app uses a local SQLite + WebSocket server so you can run tonight’s table on one machine.

With `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, the same UI talks to Supabase (Auth, Postgres, RLS, Realtime, Storage). PDF parsing runs in the browser. That is the path for a public URL (GitHub Pages, Vercel, or Netlify).

| Concern | Local (`npm run dev`) | Hosted |
| --- | --- | --- |
| Auth | Passcode + personal codes | Same UX; DMs are Auth users, players join anonymously then claim a character |
| Database | SQLite | Postgres + RLS (`supabase/schema.sql`) |
| Live sync | WebSocket | Supabase Realtime |
| Map images | `/uploads` | Storage bucket `maps` |
| GitHub Pages | Not enough on its own | Works once the two `VITE_` secrets are set |

Do not put the Supabase `service_role` key in the client.

## Out of scope (deliberate)

Hex grids, dynamic lighting, animations, sound, multiple maps in one session, OCR for handwritten sheets, and importing from an external monster API.

Drawing/annotation (walls, measurement) is phase 2.

## Scripts

- `npm run dev` — API + Vite together
- `npm run build` — typecheck and production client
- `npm start` — API only (serves `dist/` if present)
