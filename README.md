# MTG-PvP — Self-hosted Magic: The Gathering Home Table

A private, self-hosted Magic: The Gathering game for playing at home with the kids (up to 4 players). It has three parts:

1. **A fully-tagged card catalog** — every card from every era, imported from [Scryfall](https://scryfall.com/docs/api/bulk-data), searchable by set / year / type / color / legality and more.
2. **A powerful deck builder** — Scryfall-style search (including the "cards that ARE a vampire" vs "cards that REFERENCE vampires" split), live format validation, and deck stats.
3. **A real-time multiplayer table** with a **hybrid rules model**: the software enforces the *framework* of Magic (turns, phases, priority, land drops, timing, summoning sickness, combat + damage math, the stack, state-based checks) while *card effects* are performed by the players — with undo, an override for weird cards, and a relaxed/strict enforcement toggle.

> This is for private, in-home use with your own family. Card data & images come from Scryfall under the WotC Fan Content Policy.

## Stack

TypeScript monorepo (npm workspaces): **React 18 + Vite + Tailwind + Zustand** client, **Express + `ws`** server, **Postgres** database, packaged as a **Docker Compose** stack and published via **Cloudflare Tunnel** — matching the conventions of the other apps on the home server.

```
shared/   types + formats + search parser (used by client and server)
server/   express API, auth, card search, deck builder, rules engine, websocket
client/   react app: browse, deck builder, lobby, game table
```

## Quick start (Docker, on the home server)

```bash
cp .env.example .env         # then edit the secrets (see below)
docker compose up -d --build

# One-time: download the full card catalog from Scryfall (~a few minutes).
docker compose run --rm app npm run import:cards
```

Then open **http://10.0.0.16:8477** on the LAN (or **https://mtg.jsb-emr.us** once the tunnel is set up).

On first boot the server creates an **admin account** from `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Sign in, go to **Admin**, and create accounts for each kid. (Public self-registration is off unless you set `INVITE_CODE`.)

### Secrets to set in `.env`

| var | what |
|---|---|
| `POSTGRES_PASSWORD` | any long random string |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | your first login; change the password after |
| `INVITE_CODE` | optional; set it to allow self-registration with this code |
| `TUNNEL_TOKEN` | Cloudflare Zero Trust → Tunnels → connector token (or remove the `cloudflared` service to run LAN-only) |

### Cloudflare Tunnel ingress

Point the tunnel hostname `mtg.jsb-emr.us` at `http://app:8477` (the compose service name). Everything stays behind the tunnel; the app never listens on a public port.

## Local development

```bash
npm install
# bring up a local postgres however you like, then:
export DATABASE_URL=postgres://mtg:mtg@localhost:5432/mtg
npm run db:migrate
npm run import:cards -- --type default_cards   # or --file ./some-scryfall-dump.json
npm run dev            # server on :8477, client (vite) on :5174 with /api + /ws proxy
```

## Importing cards

```bash
npm run import:cards                    # downloads Scryfall "default_cards" (recommended)
npm run import:cards -- --type all_cards # every printing incl. digital
npm run import:cards -- --file dump.json # import a local Scryfall bulk file
```

Images are **not** bulk-downloaded — the first time a card image is shown it's fetched from Scryfall and cached to `/data/image-cache`, then served locally forever.

## The rules model (important)

The table is a **hybrid**, deliberately **not** a full automated engine (that's the XMage/Forge decade-long scope) and **not** a free-for-all tabletop. The software enforces the card-agnostic framework; you perform card effects by dragging/clicking. See [`docs/rules-model.md`](docs/rules-model.md).

- **Relaxed** mode (default) nudges but lets you do anything — great for little kids.
- **Strict** mode enforces timing, land drops, summoning sickness, combat, etc.
- **Undo** steps back any action; the **override** menu bypasses a check and logs it.

## Formats

Formats are data-driven ([`shared/src/formats.ts`](shared/src/formats.ts)): Standard, Pioneer, Modern, Pauper, Commander, and a no-restrictions **House** format. Adding another format Scryfall tracks is a few lines.

## Search language

See [`docs/search.md`](docs/search.md) for the full operator list.
