# Uploading Blockforge to the internet

Blockforge is not a static site. It needs a long-running Node process for
WebSockets, a writable disk for `data/blockforge.db` and backups, and one instance
only (worlds are simulated in memory). Netlify/Cloudflare Pages/GitHub Pages cannot
host it as-is.

Everything needed to deploy is already in this folder:

| File | Purpose |
| --- | --- |
| `Dockerfile` | Production image (`node:24-slim`, port 4173, `/data` volume, health check) |
| `.dockerignore` | Keeps `node_modules`, `data`, `.git` and dev scripts out of the image |
| `render.yaml` | Render blueprint (Docker, Starter plan, 1 GB disk at `/data`) |
| `fly.toml` | Fly.io config (shared CPU, `/data` volume, force HTTPS) |
| `server/seed.js` | On a fresh production database creates **one** owner account and starter worlds instead of the demo logins |

> Production seeding: `NODE_ENV=production` disables the public demo accounts
> (`forge/forge12345`, …). If `BLOCKFORGE_OWNER_PASSWORD` is set it is used for the
> first owner; otherwise a random password is printed once in the deploy logs.
> `BLOCKFORGE_DEMO=1` re-enables the demo accounts if you really want a public demo.

---

## Option A — Render (easiest, recommended)

Render gives HTTPS, WebSockets and a persistent disk with very little setup.
The `starter` plan is required: the free plan has no disk and sleeps.

1. Put this folder in a GitHub repository. With git:
   ```bash
   cd blockforge
   git init
   git add .
   git commit -m "Blockforge"
   # create an empty repo on github.com, then:
   git remote add origin https://github.com/<you>/blockforge.git
   git push -u origin main
   ```
   No git installed? Create the repo on github.com, choose **Add file → Upload files**,
   and drag in the contents of `blockforge-deploy.zip` (or this folder). Do **not**
   upload `data/` or `node_modules/` — they contain private accounts and are rebuilt
   automatically.
2. In <https://dashboard.render.com> choose **New → Blueprint**, pick the repo.
3. Render reads `render.yaml` and asks for `BLOCKFORGE_OWNER_PASSWORD`
   (any strong password; leave it blank to have one generated).
4. Apply. First build takes a few minutes. The service URL looks like
   `https://blockforge-xxxx.onrender.com`.
5. Open the URL, sign in as the owner, and create/publish a world.
6. Test from a phone on mobile data (not your Wi-Fi): sign up a second account and
   join the same world.

Notes:
- Every push to the repo redeploys.
- `data/` is the mounted disk `/data`: SQLite, WAL files and backups survive deploys.
- Download a backup from **Admin → Backups** any time.
- If you did not set an owner password, open **Logs** and search for
  `Owner login` — it is printed only on the first boot.

## Option B — Fly.io

```bash
fly auth signup        # or: fly auth login
cd blockforge
fly launch --no-deploy --copy-config
fly volumes create blockforge_data --size 1 --region iad
fly secrets set BLOCKFORGE_OWNER_PASSWORD='choose-a-strong-one'
fly deploy
fly open
```

`fly.toml` already sets `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=4173`,
`BLOCKFORGE_DATA=/data`, the volume mount, force HTTPS and `auto_stop_machines=false`
(so WebSockets are not disconnected). Scale vertically, not horizontally: run a
single machine.

## Option C — Railway / any Docker host

1. New project → deploy from the GitHub repo (Railway detects the `Dockerfile`).
2. Add a **volume** mounted at `/data`.
3. Set variables:
   - `NODE_ENV=production`
   - `HOST=0.0.0.0`
   - `BLOCKFORGE_DATA=/data`
   - `BLOCKFORGE_OWNER_PASSWORD=<strong password>` (optional)
4. Expose the service on port `4173`. Railway terminates TLS; the server reads
   `X-Forwarded-Proto` and marks the session cookie `Secure` automatically.

Any other Docker host works the same way:

```bash
docker build -t blockforge .
docker run -d --name blockforge -p 4173:4173 \
  -e NODE_ENV=production \
  -e BLOCKFORGE_OWNER_PASSWORD='choose-a-strong-one' \
  -v blockforge-data:/data \
  --restart unless-stopped \
  blockforge
```

## Option D — your own VPS (Ubuntu)

```bash
# on the server, as root
apt update && apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
useradd -m -s /bin/bash blockforge
su - blockforge
git clone https://github.com/<you>/blockforge.git
cd blockforge
npm ci --omit=dev
exit

# service
cat >/etc/systemd/system/blockforge.service <<'EOF'
[Unit]
Description=Blockforge
After=network.target

[Service]
User=blockforge
WorkingDirectory=/home/blockforge/blockforge
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=4173
Environment=BLOCKFORGE_DATA=/home/blockforge/blockforge/data
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now blockforge

# reverse proxy + free TLS
cat >/etc/nginx/sites-available/blockforge <<'EOF'
server {
  listen 80;
  server_name play.example.com;

  location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 1d;
  }
}
EOF
ln -s /etc/nginx/sites-available/blockforge /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d play.example.com
```

The `Upgrade`/`Connection` headers are required for WebSocket play. `HOST=127.0.0.1`
keeps Node private behind nginx.

---

## After deploying

1. Sign in as the owner. If you did not set a password, use the one from the logs.
2. Open **Studio → New place**, add a few parts, **Save**, then **Publish**.
3. On a tablet or phone on a different network, open the public URL, create a
   kid account, and join that world.
4. Both devices should see each other move and chat. Try an admin command as the
   owner (`;fly`, `;speed 40`, `;announce hello`).
5. Download a backup (**Admin → Backups**) and keep it somewhere safe.
6. Install the site on each tablet: browser menu → **Add to Home Screen**. The
   service worker caches the app, so the **Saved** tab still works with no signal.

## What must stay true

- **One instance.** Worlds, sessions and rate limits live in memory. Do not scale
  to multiple replicas without adding a shared store.
- **Persistent disk at `/data`.** Without it, every deploy loses accounts and worlds.
- **HTTPS.** Required for service workers (offline play) and for `Secure` cookies.
- **WebSockets allowed.** Some corporate proxies block them; home/mobile networks do not.

## Still want a no-server link?

You can publish a read-only demo elsewhere, but multiplayer, accounts, saving and
commands only work on the Node deployment above. The LAN mode (`npm start` + the
**Nearby** page) remains the no-internet fallback.
