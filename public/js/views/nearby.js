import { api } from '../store.js';
import { esc, icon, toast } from '../ui.js';

export async function renderNearby(root) {
  root.innerHTML = `<div class="page nearby-page">
    <header class="nearby-head">
      <span class="hero-eyebrow"><i></i> No internet needed</span>
      <h1>Play together on your Wi-Fi</h1>
      <p>
        One device runs Blockforge. Everyone else joins from a phone, tablet, or laptop on the
        same Wi-Fi — or on a phone hotspot with no internet at all.
      </p>
    </header>

    <section class="nearby-steps">
      <article class="nearby-step">
        <span class="step-num">1</span>
        <h3>Start it once</h3>
        <p>On the host computer, open a terminal in the Blockforge folder and run <code>npm start</code>. Keep that window open.</p>
      </article>
      <article class="nearby-step">
        <span class="step-num">2</span>
        <h3>Share the network</h3>
        <p>Connect every device to the same Wi-Fi. No Wi-Fi? Turn on a phone hotspot and join it from the computer and the other devices.</p>
      </article>
      <article class="nearby-step">
        <span class="step-num">3</span>
        <h3>Scan and play</h3>
        <p>Scan a QR code below with the other device's camera, or type the address into its browser. Then sign in and join a world.</p>
      </article>
      <article class="nearby-step">
        <span class="step-num">4</span>
        <h3>Install on each tablet</h3>
        <p>In the tablet browser choose <b>Add to Home Screen</b>. It opens fullscreen, shows a joystick and Jump button, and keeps a copy of visited worlds in its <b>Saved</b> tab for when there is no server at all.</p>
      </article>
    </section>

    <section class="nearby-addresses">
      <div class="section-head">
        <h2>${icon('wifi')} Join addresses</h2>
        <button class="btn btn-sm" data-refresh>Refresh</button>
      </div>
      <div data-address-list class="nearby-list">
        <div class="empty">Looking for this computer's network address…</div>
      </div>
    </section>

    <div class="nearby-tip">
      <b>${icon('bolt')} Phone hotspot works.</b>
      A hotspot without mobile data is enough — the game never leaves your local network.
      The host laptop must stay awake and the terminal window must stay open.
    </div>

    <section class="nearby-saves">
      <div class="section-head">
        <h2>${icon('save')} Everything stays saved here</h2>
      </div>
      <div class="save-grid">
        <article class="save-card">
          <h3>One local database</h3>
          <p>Accounts, Sparks, avatars, worlds, and published places all live in <code>data/blockforge.db</code> on the host computer. No internet account, no cloud.</p>
        </article>
        <article class="save-card">
          <h3>Automatic backups</h3>
          <p>A full snapshot is written to <code>data/backups/</code> at startup, every 30 minutes, and on shutdown. The newest 12 are kept.</p>
        </article>
        <article class="save-card">
          <h3>Studio draft recovery</h3>
          <p>Unsaved Studio edits are mirrored into the browser every few seconds. Close the tab by accident and the place comes back next time.</p>
        </article>
        <article class="save-card">
          <h3>Saved worlds on the tablet</h3>
          <p>Open a world once and the tablet keeps its parts plus your last position. With no server reachable, the world opens in solo mode from the <b>Saved</b> tab.</p>
        </article>
      </div>
    </section>

    <div class="nearby-tip">
      <b>${icon('save')} On the bus with no internet?</b>
      The server computer does not need to come along. Open the installed app on the tablet and pick a world from
      <a href="#/offline" style="color:#9ab8ff">Saved</a>. You play alone on that device; positions are stored there until you are
      back on the network.
    </div>

    <div class="nearby-tip">
      <b>🎮 Bluetooth controllers</b>
      Connect an Xbox, PlayStation, or Switch controller by Bluetooth. The browser picks it up with no internet: left stick walks, right stick turns the camera, <b>A</b> jumps, <b>B</b> plays an emote, <b>LT</b> descends while flying.
    </div>

    <details class="nearby-faq">
      <summary>It doesn't connect — help</summary>
      <ul>
        <li><b>Allow the firewall.</b> The first time it starts, Windows or macOS may ask whether Node can accept connections. Choose <b>Allow</b> on private networks.</li>
        <li><b>Same network, not guest Wi-Fi.</b> Guest networks often block devices from seeing each other.</li>
        <li><b>Check the address.</b> It should look like <code>http://192.168.1.24:4173</code>, not <code>localhost</code>.</li>
        <li><b>Turn off VPNs.</b> A VPN can hide the local address from the other devices.</li>
        <li><b>Only one host.</b> Run Blockforge on one computer; everyone else joins that address.</li>
      </ul>
    </details>

    <p class="nearby-note">
      Why not Bluetooth? Browsers cannot host a game server over Bluetooth — it is limited to
      accessories like headphones and controllers. Wi-Fi and phone hotspots give every device a
      real connection with no internet required.
    </p>
  </div>`;

  const list = root.querySelector('[data-address-list]');

  async function load() {
    list.innerHTML = `<div class="empty">Looking for this computer's network address…</div>`;
    let info;
    try {
      info = await api('/api/network');
    } catch (err) {
      list.innerHTML = `<div class="empty"><b>Could not read the network</b>${esc(err.message)}</div>`;
      return;
    }

    if (!info.urls?.length) {
      list.innerHTML = `<div class="empty">
        <b>No Wi-Fi address found</b>
        Connect this computer to Wi-Fi or a phone hotspot, then press Refresh.
      </div>`;
      return;
    }

    const here = location.host;
    list.innerHTML = info.urls.map((item) => {
      const isCurrent = here === `${item.address}:${info.port}`;
      return `<article class="nearby-address${isCurrent ? ' is-current' : ''}">
        <img class="nearby-qr" src="/api/network/qr?u=${encodeURIComponent(item.url)}" alt="QR code for ${esc(item.url)}" width="152" height="152" />
        <div class="nearby-address-body">
          <span class="nearby-label">${isCurrent ? 'You are here' : 'Scan with a phone or tablet'}</span>
          <code class="nearby-url">${esc(item.url)}</code>
          <p class="hint">${esc(item.name)} · port ${info.port}</p>
          <div class="nearby-actions">
            <button class="btn btn-sm" data-copy="${esc(item.url)}">Copy link</button>
            <a class="btn btn-sm btn-ghost" href="${esc(item.url)}" target="_blank" rel="noopener">Open</a>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      toast('Link copied.', 'good');
    } catch {
      toast('Select the address and copy it manually.', 'warn');
    }
  });

  root.querySelector('[data-refresh]').addEventListener('click', load);
  await load();

  return { title: 'Play nearby' };
}
