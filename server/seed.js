import crypto from 'node:crypto';
import { createGame, createUser, db, grantItem, setRole } from './db.js';
import { hashPassword } from './auth.js';
import { DEFAULT_AVATAR, sanitizeAvatar } from '../shared/catalog.js';
import { TEMPLATES } from './templates.js';

const DEMO_USERS = [
  {
    username: 'forge', password: 'forge12345', role: 3,
    avatar: { ...DEFAULT_AVATAR, shirt: '#a855f7', pants: '#111827', hat: 'hat.crown', face: 'face.cool', effect: 'effect.ember', skin: '#d99a63' },
    items: ['hat.cap', 'hat.headphones', 'hat.crown', 'hat.halo', 'face.cool', 'face.happy', 'emote.dance', 'effect.ember', 'effect.sparkle'],
  },
  {
    username: 'admin', password: 'admin12345', role: 2,
    avatar: { ...DEFAULT_AVATAR, shirt: '#ef4444', pants: '#0f172a', hat: 'hat.headphones', face: 'face.happy', skin: '#f4c69a' },
    items: ['hat.cap', 'hat.headphones', 'face.happy', 'emote.cheer', 'effect.sparkle'],
  },
  {
    username: 'mod', password: 'mod12345', role: 1,
    avatar: { ...DEFAULT_AVATAR, shirt: '#22c55e', pants: '#1e293b', hat: 'hat.beanie', face: 'face.smile', skin: '#7a4a28' },
    items: ['hat.beanie', 'face.shock'],
  },
  {
    username: 'player', password: 'player12345', role: 0,
    avatar: { ...DEFAULT_AVATAR, shirt: '#06b6d4', pants: '#334155', skin: '#b06b3c' },
    items: [],
  },
];

const DEMO_GAMES = [
  { name: 'Neon Obby: Zero Gravity', template: 'obby', owner: 'forge', visits: 148_203, likes: 12_480, thumb: 'neon' },
  { name: 'Sky Tower Climb', template: 'tower', owner: 'admin', visits: 92_540, likes: 7_310, thumb: 'sunset' },
  { name: 'Sculpture Garden', template: 'showcase', owner: 'mod', visits: 41_902, likes: 3_120, thumb: 'aurora' },
  { name: 'Starter House Sandbox', template: 'house', owner: 'player', visits: 30_417, likes: 2_040, thumb: 'meadow' },
  { name: 'Build Lab Baseplate', template: 'baseplate', owner: 'forge', visits: 18_330, likes: 1_205, thumb: 'aurora' },
  { name: 'Neon Obby 2: Harder Mode', template: 'obby', owner: 'admin', visits: 12_090, likes: 998, thumb: 'ember' },
  { name: 'Harbor House Tycoon', template: 'house', owner: 'mod', visits: 8_140, likes: 612, thumb: 'ocean' },
  { name: 'Spire Defense Prototype', template: 'tower', owner: 'player', visits: 4_760, likes: 301, thumb: 'neon' },
];

function avatarsBackfilled(user) {
  const owned = new Set(user.items || []);
  for (const slot of ['hat', 'face', 'emote', 'effect']) {
    const id = user.avatar?.[slot];
    if (!id) continue;
    grantItem(user.id, id);
    owned.add(id);
  }
  return owned;
}

export function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return false;

  // On a public deployment the demo logins would hand ownership to anyone who
  // reads this file. Keep them for local/LAN use, but on a production host
  // create one real owner instead (password from env or generated once).
  const isProd = process.env.NODE_ENV === 'production';
  const demoMode = !isProd || process.env.BLOCKFORGE_DEMO === '1';
  const ownerName = String(process.env.BLOCKFORGE_OWNER_USERNAME || 'forge').trim() || 'forge';
  const ownerPassword = demoMode
    ? 'forge12345'
    : (process.env.BLOCKFORGE_OWNER_PASSWORD || crypto.randomBytes(15).toString('base64url'));

  const users = demoMode
    ? DEMO_USERS
    : [{
        username: ownerName,
        password: ownerPassword,
        role: 3,
        avatar: DEMO_USERS[0].avatar,
        items: DEMO_USERS[0].items,
      }];

  console.log(demoMode
    ? '[seed] first run — creating demo accounts and games'
    : `[seed] first run — creating owner account "${ownerName}" and starter worlds`);

  const created = {};
  for (const demo of users) {
    const { salt, hash } = hashPassword(demo.password);
    const user = createUser({
      username: demo.username,
      passHash: hash,
      passSalt: salt,
      avatar: sanitizeAvatar(demo.avatar),
    });
    setRole(user.id, demo.role);
    for (const item of ['hat.none', 'face.smile', 'emote.wave', 'effect.none', ...demo.items]) {
      grantItem(user.id, item);
    }
    avatarsBackfilled({ ...user, avatar: demo.avatar });
    created[demo.username] = user;
  }

  const fallbackOwner = created[ownerName] || created.forge || Object.values(created)[0];

  let i = 0;
  for (const demo of DEMO_GAMES) {
    const owner = created[demo.owner] || fallbackOwner;
    const template = TEMPLATES[demo.template];
    const built = template.build();
    const game = createGame({
      ownerID: owner.id,
      name: demo.name,
      description: template.blurb,
      thumb: demo.thumb,
      parts: built.parts,
      spawn: built.spawn,
    });
    const created_at = Date.now() - (DEMO_GAMES.length - i) * 86_400_000 * 3;
    db.prepare('UPDATE games SET published = 1, visits = ?, likes = ?, created_at = ?, updated_at = ? WHERE id = ?')
      .run(demo.visits, demo.likes, created_at, created_at + 86_400_000, game.id);
    i++;
  }

  if (demoMode) {
    console.log('[seed] demo logins:', DEMO_USERS.map((u) => `${u.username}/${u.password}`).join(', '));
  } else if (!process.env.BLOCKFORGE_OWNER_PASSWORD) {
    console.log('');
    console.log('============================================================');
    console.log(`  Owner login: ${ownerName}`);
    console.log(`  Password:    ${ownerPassword}`);
    console.log('  Save this now — it is not shown again.');
    console.log('============================================================');
    console.log('');
  } else {
    console.log(`[seed] owner "${ownerName}" created with BLOCKFORGE_OWNER_PASSWORD`);
  }
  return true;
}
