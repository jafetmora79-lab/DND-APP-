# D&D Live Table

A campaign companion for running Dungeons & Dragons 5e at a real table: a persistent DM library, a live session that phones can follow, character sheets the whole party can read, and encounters you can pause mid-fight and resume next week — HP, positions, turn order, and fog included.

Monster stat blocks are seeded from the Systems Reference Document 5.1 (© Wizards of the Coast, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Structured JSON comes from the [5e-bits/5e-database](https://github.com/5e-bits/5e-database) project.

## What you can do

- **Dungeon Master login** with a table name and passcode. Run as many campaigns as you want.
- **Shared bestiary** across every campaign at that table (~300 SRD creatures, plus your own).
- **Prep library** per campaign: square 5-ft battle maps you draw from scratch (optional picture as background, blocked squares tokens cannot walk on), encounter templates, player characters with personal join codes.
- **Live session**: the campaign table stays open on one join code. Between fights, players see their character sheets and a scene image (or a hearth placeholder) while you talk and travel. Start or resume an encounter when you are ready. Copy buttons sit next to join codes and personal character codes.
- **Map & tokens** (Konva): pan/zoom, drag tokens on a square grid (5 ft per square), paint fog of war. Tokens snap back if dropped on a blocked square. Each creature has a name, HP bar, Armor Class, and a colored ring per condition (Poisoned, Unconscious / sleeping, and the rest of the tracker list).
- **Encounter tracker**: initiative, current/max/temp HP, conditions, next-turn. State hangs off the encounter instance, not the night’s join code.
- **Attacks**: pick an attack, tap a creature in range, enter the d20 from the table and the damage. d20 + bonus must be **higher than Armor Class** to hit (equal to AC misses). Natural 20 hits. Natural 1 misses and the target has advantage against the attacker next turn — same rule for players and for the DM’s monsters.
- **Encounter templates**: pick monsters from a bestiary dropdown (quantity places that many tokens). Place player characters on the map so you decide starting squares before you hit Start.
- **Character sheets** with Combat / Skills / Spells / Bio. Empty tabs hide. Ability modifiers, skill bonuses, and passive Perception calculate automatically. Visible to everyone; editable by the owner and the DM.
- **Encounter outcome**: the DM finalizes a fight as won or lost. Everyone sees a victory or defeat, then the table returns to the scene + sheets. **Next encounter** loads the next template without minting a new join code.

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

1. Open [Pages settings](https://github.com/jafetmora79-lab/DND-APP-/settings/pages) → **Build and deployment → Source** → **GitHub Actions** (not “Deploy from a branch” / `/docs`). This is required for `actions/deploy-pages`.
2. Open [Actions secrets](https://github.com/jafetmora79-lab/DND-APP-/settings/secrets/actions) and add **repository secrets** (not Environments):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Re-run the **GitHub Pages** workflow (or push to `main`).

Until Source is GitHub Actions, the workflow also writes the built site to `docs/` so the current “Deploy from a branch → `/docs`” setting can still publish.

Without those two secrets the Pages build still succeeds, but the site has no hosted backend — phones cannot join. Hosted passcodes must be **at least 6 characters** (Supabase Auth). The local sample passcode `torch` only works on `npm run dev`.

### Sample table

A seeded campaign is ready on first boot:

| Role | How to enter |
| --- | --- |
| Dungeon Master | Table **Hearthkeeper**, passcode **torch** |
| Player (Elara) | Join code **HEARTH**, personal code **ELARA7K2** |
| Player (Brok) | Join code **HEARTH**, personal code **BROK4M9X** |

The **Cragmaw Ambush** is paused in round 2 with the bugbear already wounded. Open Live as the DM — you sit at the tavern table first. Resume the ambush when the party is ready, or join as a player and read your sheet beside the scene.

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

Hex grids, dynamic lighting, token animations, sound, multiple maps in one session, OCR for handwritten sheets, and importing from an external monster API.

Measurement tools and freehand wall drawing are still out of scope; blocked squares on the 5-ft grid cover impassable terrain.

## Scripts

- `npm run dev` — API + Vite together
- `npm run build` — typecheck and production client
- `npm start` — API only (serves `dist/` if present)
