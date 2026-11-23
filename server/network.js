import os from 'node:os';

/** IPv4 addresses other devices on the same Wi-Fi/hotspot can reach. */
export function lanAddresses() {
  const found = [];
  const VIRTUAL = /(vethernet|virtualbox|vmware|docker|wsl|tailscale|zerotier|hyper-?v|loopback|vpn|tap|tun)/i;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      if (VIRTUAL.test(name)) continue;
      // 169.254.x.x means "no DHCP" — useless for a hosted game.
      if (net.address.startsWith('169.254.')) continue;
      found.push({ name, address: net.address });
    }
  }
  // Home networks and phone hotspots first; corporate/VPN ranges after.
  const rank = (ip) =>
    ip.startsWith('192.168.') ? 0
      : ip.startsWith('10.') ? 1
        : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2
          : 3;
  return found.sort((a, b) => rank(a.address) - rank(b.address));
}

export function networkInfo(port) {
  const urls = lanAddresses().map(({ name, address }) => ({
    name,
    address,
    url: `http://${address}:${port}`,
  }));
  return {
    port,
    hostname: os.hostname(),
    local: `http://localhost:${port}`,
    urls,
  };
}

/** A stable allow-list so the QR endpoint cannot encode arbitrary links. */
export function allowedUrls(port) {
  const set = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  for (const item of networkInfo(port).urls) set.add(item.url);
  return set;
}
