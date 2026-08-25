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

### Sample table

A seeded campaign is ready on first boot:

| Role | How to enter |
| --- | --- |
| Dungeon Master | Table **Hearthkeeper**, passcode **torch** |
| Player (Elara) | Join code **HEARTH**, personal code **ELARA7K2** |
| Player (Brok) | Join code **HEARTH**, personal code **BROK4M9X** |

The **Cragmaw Ambush** is paused in round 2 with the bugbear already wounded. Open Live as the DM and hit Resume, or join as a player and watch the map.

## Architecture

The plan called for Supabase (Postgres, Realtime, RLS, Storage, Edge Functions). This first build ships a **local fallback** so the table runs without cloud credentials:

| Planned | Shipped now |
| --- | --- |
| Supabase Auth (magic link / passcode) | Passcode login for DMs; personal codes for players |
| Postgres + RLS | SQLite with the same table sketch |
| Supabase Realtime | WebSocket snapshots after every combat mutation |
| Supabase Storage | Disk files under `/uploads` |
| Edge Function + pdf-lib | Same pdf-lib parser, in the Node server |

Swap the `server/` layer for Supabase later without changing the UI. Row-level rules in this build are enforced in the API: prep writes are DM-only; live map/tracker writes are DM-only; sheet writes are owner + DM.

## Out of scope (deliberate)

Hex grids, dynamic lighting, animations, sound, multiple maps in one session, OCR for handwritten sheets, and importing from an external monster API.

Drawing/annotation (walls, measurement) is phase 2.

## Scripts

- `npm run dev` — API + Vite together
- `npm run build` — typecheck and production client
- `npm start` — API only (serves `dist/` if present)
