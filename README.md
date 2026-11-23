# Blockforge

A multiplayer, browser-based world-building platform in the spirit of classic block
sandboxes — built from scratch with a Node server, a SQLite database, a real-time
authoritative game loop, and a Three.js client. No game engine, no bundler, no
external services.

This is a working vertical slice, not a mockup: you can register, browse and publish
worlds, build parts in a 3D Studio, save and play your place with other people, buy
avatar items with earned currency, and run server-verified admin commands.

---

## Quick start

Requirements: **Node.js 22.5+** (24 recommended; the server uses the built-in
`node:sqlite` module).

```bash
npm install
npm start
```

Open <http://localhost:4173>. The first boot creates `data/blockforge.db` and seeds
eight demo worlds plus four accounts.

The server listens on every interface by default (`HOST=0.0.0.0`), so on startup it
also prints the address other devices on your Wi-Fi can use, for example:

```
  Blockforge running at http://localhost:4173
  Play together with no internet - same Wi-Fi or phone hotspot:
    http://192.168.1.24:4173  (Wi-Fi)
```

Set `HOST=127.0.0.1` if you want to hide it from the local network.

| Username | Password      | Role      | Level |
| -------- | ------------- | --------- | ----- |
| `forge`  | `forge12345`  | Owner     | 3     |
| `admin`  | `admin12345`  | Admin     | 2     |
| `mod`    | `mod12345`    | Moderator | 1     |
| `player` | `player12345` | Player    | 0     |

> Levels: **0** Player, **1** Moderator, **2** Admin, **3** Owner. The owner of a
> world always has effective level 3 inside that world, so you can moderate your own
> place without platform staff powers.

Other scripts:

```bash
npm run dev     # restart on file changes (node --watch)
npm run smoke   # end-to-end auth/WebSocket/permission checks (server must be up)
npm run reset   # delete the SQLite database; reseeds on next start
```

Debug hook: append `?debug=1` before the hash
(`http://localhost:4173/?debug=1#/play/<gameId>`) to expose the live `WorldView`
as `window.__bfWorld` in the console.

---

## Feature tour

### Discovery
- Home page with featured worlds, trending rows, and live player counts.
- Discover grid with search, tag filters, and sorting.
- World pages with hero art, stats (visits, likes, parts, updated), likes, and report.
- Worlds become publicly joinable only after **Publish**; drafts stay owner-only.

### Accounts and economy
- Registration and login with scrypt password hashing and HMAC-signed, HttpOnly
  session cookies.
- Sparks (the platform currency) are stored server-side. New accounts start with a
  balance; purchases and admin grants are transactional.
- Profile menu, sign-out, and an admin-only link to the platform admin console.

### Avatars
- 3D blocky avatar with skin/shirt/pants color pickers (free).
- Catalog-backed hats, faces, and emotes; owned items equip, unowned items are shown
  locked. Equip state and colors are validated and sanitized on the server.
- Emotes are visible to other players in-world (`E`).

### Shop
- Item catalog defined once in `shared/catalog.js` and shared by client and server.
- Server-side price and ownership checks; purchases are idempotent per item and
  deduct Sparks atomically. Owned items can be equipped from the shop or avatar page.

### Studio
- Real part-based editor: add blocks, spheres, cylinders, and wedges.
- Click to select, `TransformControls` gizmo for move / rotate / scale, inspector for
  color, material, transparency, and numeric transform fields.
- Duplicate, delete, undo/redo (history stack), grid + lighting, orbit camera.
- Save writes the place JSON through the API with validation and clamping; Publish
  flips the world public and reloads any live server for that world.
- Open Studio from any world page ("Edit in Studio") or from the Studio dashboard.

### Multiplayer worlds
- Server-authoritative simulation at 30 Hz; 10 Hz snapshots with interpolation.
- The **same** `shared/physics.js` runs on the server and in the client for prediction.
- Clients send intent only (`mx`, `mz`, `jump`, `up`, `yaw`); the server integrates
  position, resolves AABB collisions against place parts, and broadcasts state.
- Per-player rate limits on inputs, chat, and commands.
- Reconnect-safe player slots, kick/ban handling, world reload on publish, and a
  graceful shutdown path.
- Bluetooth/USB controllers via the Gamepad API: left stick or d-pad moves, right
  stick orbits, **A** jumps, **B**/**Y** emotes, **LT** descends while flying.

### Playing together without internet
Open **Play nearby** (`#/nearby`) on the host computer. It lists every local address
with a QR code, so a phone or tablet can join without typing anything.

1. Run Blockforge on one computer.
2. Put every device on the same Wi-Fi — or join the computer and the devices to a
   phone hotspot. The hotspot does **not** need mobile data.
3. Scan the QR code (or open the `http://192.168.x.x:4173` address) on the other
   devices, sign in, and join the same world.

Only one device runs the server; everyone else connects to it. Windows/macOS will ask
once to allow Node through the firewall — allow it on private networks.

**Why not Bluetooth networking?** Browsers cannot host a TCP/WebSocket server over
Bluetooth, so a browser game cannot use Bluetooth as its network transport. Bluetooth
*is* supported for controllers, which is the useful part for kids playing offline.
Wi-Fi and phone hotspots need no internet at all and give every device a normal,
low-latency connection.

### Tablets, touch, and true offline play
Blockforge is an installable web app (PWA) with on-screen controls, so each kid can
use their own tablet:

- **Install it** — open the site in the tablet browser, then *Add to Home Screen*.
  It opens fullscreen with no address bar. A service worker caches the shell and the
  images/scripts, so the app itself starts with no signal.
- **Touch controls appear automatically** on touch devices: a joystick on the left,
  **Jump** and the emote button on the right, and ▲/▼ while flying. The fullscreen
  button is next to the ping pill.
- **Saved worlds** — every world you open is copied to that device
  (`localStorage`, key `bf:world:<id>`) along with the last safe position. Open the
  **Saved** tab (`#/offline`) to list them.
- **Solo mode** — with no server reachable, opening a saved world starts the same
  physics locally. Movement, jumping, flight, and `;help ;fly ;unfly ;speed ;jump
  ;heal ;respawn ;clear` all work without a server. Progress is written back to the
  device every couple of seconds and on exit.
- **Sign-in cache** — the last signed-in account (name, avatar, coins, items) is
  stored on the device so the offline copy still looks like that kid. Signing in
  itself always needs the server the first time.
- **Studio drafts** — edits are safe on the device. If saving fails because the
  server is unreachable, the badge changes to *Draft on device* and the draft is
  kept until a successful save.

A typical trip: open the worlds once at home on Wi-Fi, tap *Add to Home Screen*,
then on the bus open the installed app → **Saved** → a world. When a hotspot or
server is available again, the same accounts and worlds sync as usual.

### Offline saves and backups
Everything is local-first:

- **Accounts, worlds, parts, Sparks, avatars** live in `data/blockforge.db` (SQLite,
  WAL mode) on the host computer.
- **Automatic backups** — a complete snapshot is written with `VACUUM INTO` to
  `data/backups/` at startup, every 30 minutes, and on `SIGINT`/`SIGTERM`. The newest
  12 are kept.
- **Staff backup API** — `GET /api/backups` (level 2+) lists snapshots, `POST
  /api/backups` takes one now, and `GET /api/backups/<file>` (owner only) downloads
  the file.
- **Studio drafts** — unsaved edits are mirrored to `localStorage` (`bf:draft:<id>`)
  within half a second and re-offered if the tab crashes or closes. The draft is
  cleared only after a successful server save, and a quiet server autosave runs every
  60 seconds while edits are pending. Closing a dirty tab shows the browser's
  unsaved-changes warning.
- **World cache and service worker** — see the section above. Scripts and styles are
  revalidated in the background on each load; bump `VERSION` in `public/sw.js` when the
  cached file list or caching strategy changes.


### Admin commands and moderation
- In-world chat console plus a staff panel (`F2` or the Admin panel button) with
  Players, Commands, Permissions, and History tabs.
- Commands are **silent for non-staff** so the command surface cannot be enumerated.
- Rank checks run server-side on every command. The owner of a world is level 3 in
  that world; platform staff levels come from the database.
- Every executed command (success or failure) is written to an audit log with actor,
  target, raw input, and result. `;history` and the panel read from that log.
- Platform admin console (`#/admin`): user search, role changes, bans/unbans, grants,
  reports, and recent activity.

---

## Commands

Type them in world chat. Level is the minimum required.

| Command | Level | Description |
| --- | --- | --- |
| `;help` | 1 | List commands available to you |
| `;fly` / `;unfly` | 1 | Toggle flight (Space up, Shift down) |
| `;speed [0-400]` | 1 | Set walk speed |
| `;jump [0-400]` | 1 | Set jump power |
| `;invisible` / `;visible` | 1 | Hide or show your character |
| `;bring [player\|all]` | 1 | Teleport players to you |
| `;to [player]` | 1 | Teleport yourself to a player |
| `;freeze [player\|all]` | 1 | Freeze a player (defaults to you) |
| `;unfreeze [player\|all]` | 1 | Unfreeze a player |
| `;heal [player\|all]` | 1 | Respawn at the spawn point |
| `;announce [message]` | 1 | Server-wide announcement |
| `;kick [player] [reason]` | 2 | Remove a player from this server |
| `;ban [player] [duration?] [reason?]` | 2 | Ban online or offline (`10m`, `2h`, `7d`, …) |
| `;unban [username]` | 2 | Lift a ban |
| `;give [player] [item]` | 2 | Grant a catalog item |
| `;coins [player] [amount]` | 2 | Adjust a player's Sparks |
| `;role [user] [0-3]` | 3 | Set a platform permission level |
| `;shutdown` | 3 | Shut this world down for everyone |
| `;history` | 2 | Recent admin actions in this world |

Targets accept exact names, unique prefixes, `@name`, `me`/`self`, and `all`.

---

## Upload it to the internet

Blockforge needs a Node process, WebSockets and a writable disk, so it cannot run on
static hosts such as Netlify. The repo ships ready-to-use deployment files:

- **Render** — import the repo and apply `render.yaml` (Docker, Starter plan, 1 GB
  disk at `/data`). This is the least fiddly option.
- **Fly.io** — `fly launch --no-deploy --copy-config`, create a volume, set
  `BLOCKFORGE_OWNER_PASSWORD`, then `fly deploy` (`fly.toml` is included).
- **Railway / Docker / VPS** — `docker build` + a `/data` volume + HTTPS reverse
  proxy; an nginx + systemd recipe is included.

Full step-by-step instructions, environment variables, and the post-deploy checklist
live in [`docs/DEPLOY.md`](docs/DEPLOY.md).

On a fresh production database the server creates **one owner account** (and the
starter worlds) instead of the demo logins. Set `BLOCKFORGE_OWNER_USERNAME` and
`BLOCKFORGE_OWNER_PASSWORD`, or read the generated password once from the deploy
logs. `NODE_ENV=production` is enough to disable the demo accounts;
`BLOCKFORGE_DEMO=1` turns them back on for a throwaway demo server.

Keep the LAN mode (`npm start` + **Nearby**) as the no-internet fallback: the
internet deployment and the local server use the same code and database format.

---

## Architecture

```
blockforge/
├─ server/
│  ├─ index.js      HTTP + WebSocket upgrade, static files, heartbeat, LAN banner
│  ├─ http.js       tiny router, static file serving, security headers
│  ├─ api.js        REST endpoints (auth, games, place, shop, admin, backups)
│  ├─ auth.js       scrypt passwords, signed session cookies, guards
│  ├─ db.js         node:sqlite schema + queries
│  ├─ backup.js     VACUUM INTO snapshots, rotation, shutdown hook
│  ├─ network.js    LAN address detection and QR allow-list
│  ├─ world.js      authoritative World and WorldManager
│  ├─ commands.js   command registry, permissions, audit logging
│  ├─ templates.js  place templates and place sanitization
│  └─ seed.js       first-run owner account and starter worlds
├─ shared/          code used by both server and browser
│  ├─ physics.js    character AABB movement/collision
│  ├─ catalog.js    shop items, default avatar, avatar sanitizer
│  └─ avatar.js     avatar color helpers
└─ public/
   ├─ index.html    import map + shell
   ├─ manifest.webmanifest, sw.js   installable app + offline cache
   ├─ css/app.css   design system and views
   └─ js/
      ├─ app.js, shell.js, store.js, ui.js
      ├─ gamepad.js         Bluetooth/USB controller mapping
      ├─ touch.js           on-screen joystick and buttons
      ├─ three/world3d.js   renderer, parts, prediction, camera
      ├─ three/avatar3d.js  avatar model, animation, emotes
      └─ views/             home, discover, game, play, studio, avatar, shop,
                            admin, nearby, offline
```

Deployment files: `Dockerfile`, `.dockerignore`, `render.yaml`, `fly.toml`, and
[`docs/DEPLOY.md`](docs/DEPLOY.md).

### Real-time protocol

The browser opens `GET /ws?game=<id>` upgraded to WebSocket. Session auth
happens during the HTTP upgrade, so an unauthenticated or banned user never reaches
the game loop.

Client → server: `input`, `chat`, `emote`, `ping`.
Server → client: `welcome` (place + players + self), `snap`, `join`, `leave`,
`flags`, `plflags`, `place`, `chat`, `cmd`, `emote`, `tp`, `kick`, `pong`, `error`.

Place JSON, avatars, colors, speeds, and commands are validated server-side; the
client is never trusted for position, currency, ownership, or permissions.

---

## Security notes

- Passwords: scrypt with per-user salt; unknown usernames still perform a dummy hash
  to reduce timing differences.
- Sessions: random token stored in SQLite, HMAC-signed cookie, `HttpOnly`, `SameSite=Lax`;
  `Secure` is set automatically when served over HTTPS.
- Requests: same-origin checks on state-changing routes, JSON body size limits,
  per-IP rate limits on auth and reports.
- World: server integrates movement and clamps speeds, command rates, chat rates, and
  place part counts; clients cannot teleport themselves.
- Commands: rank checks and ownership checks run server-side; non-staff get no
  response at all; all attempts are audit-logged.
- XSS: user text is escaped on render; avatar/place data is sanitized and clamped.
- Static files are served from an allow-list of directories, with path traversal
  rejection and safe content types.
- Demo logins are created only outside production. A production database starts with
  one owner account whose password comes from `BLOCKFORGE_OWNER_PASSWORD` or a
  one-time generated value in the logs.

## What is intentionally stubbed

- Terrain/heightmap sculpting and CSG unions (parts only).
- A user scripting sandbox for worlds (deliberately omitted for safety).
- Friends, direct messages, parties, and cross-server matchmaking.
- Bluetooth as a network transport — browsers cannot host a server over it. Bluetooth
  controllers are supported through the Gamepad API.
- Asset uploads (meshes/images); all art is procedural.
- Payments; Sparks are earned/seeded and granted by staff, not purchased.

## License

Private prototype. All code in this repository is original; the visual language is
inspired by block-building sandboxes but uses its own branding and assets.
