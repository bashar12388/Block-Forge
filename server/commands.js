// Admin command engine.
//
// Every command runs on the server. The client never decides whether it is
// allowed to do anything; it only *asks*. Unknown commands are silently dropped
// for low-privilege players so the command surface is not enumerable.

import {
  adjustCoins, banUser, commandHistory, grantItem, logCommand, now,
  setRole, userByUsername,
} from './db.js';
import { ITEMS, ITEM_MAP } from '../shared/catalog.js';

export const LEVELS = {
  0: 'Player',
  1: 'Moderator',
  2: 'Admin',
  3: 'Owner',
};

const DURATION_RX = /^(\d+)(s|m|h|d|w)$/i;

function parseDuration(input) {
  const m = DURATION_RX.exec(String(input || '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2].toLowerCase()];
  return Math.max(1000, n * unit);
}

function resolvePlayer(world, needle) {
  const q = String(needle || '').replace(/^@/, '').toLowerCase();
  if (!q) return { matches: [] };
  const players = [...world.players.values()];
  const exact = players.filter((p) => p.username.toLowerCase() === q);
  if (exact.length === 1) return { matches: exact };
  const partial = players.filter((p) => p.username.toLowerCase().startsWith(q));
  return { matches: partial };
}

function targetOrError(world, needle, ctx) {
  const q = String(needle || '').replace(/^@/, '').toLowerCase();
  if (q && (q === 'me' || q === 'self' || q === ctx.player.username.toLowerCase())) return ctx.player;
  const { matches } = resolvePlayer(world, needle);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    ctx.reply(`Multiple players match "${needle}": ${matches.map((p) => p.username).join(', ')}`, 'err');
    return null;
  }
  ctx.reply(`No player named "${needle}" is in this server.`, 'err');
  return null;
}

function eligibleTargets(world, needle, ctx) {
  const q = String(needle || '').toLowerCase();
  if (!q) return ctx.player ? [ctx.player] : null;
  if (q === 'all' || q === 'everyone') return [...world.players.values()];
  const one = targetOrError(world, needle, ctx);
  return one ? [one] : null;
}

function resolveItem(needle) {
  const q = String(needle || '').trim().toLowerCase();
  if (!q) return null;
  if (ITEM_MAP.has(q)) return ITEM_MAP.get(q);
  const byName = ITEMS.filter((i) => i.name.toLowerCase() === q);
  if (byName.length === 1) return byName[0];
  const partial = ITEMS.filter((i) => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q));
  return partial.length === 1 ? partial[0] : null;
}

/** A command definition. `run` returns a human-readable result line. */
const COMMANDS = [
  {
    name: 'help', level: 1, usage: ';help', desc: 'List the commands available to you.',
    run(ctx) {
      const usable = COMMANDS.filter((c) => c.level <= ctx.level);
      const lines = usable.map((c) => `${c.usage.padEnd(24)} level ${c.level}  ${c.desc}`);
      ctx.reply(`Commands available to you (${LEVELS[ctx.level]}):`, 'info');
      for (const line of lines) ctx.reply(line, 'info');
      return { ok: true, message: `${usable.length} commands listed` };
    },
  },

  {
    name: 'fly', level: 1, usage: ';fly', desc: 'Toggle flight for yourself.',
    run(ctx) {
      const { player } = ctx;
      player.state.fly = true;
      player.state.vel[1] = 0;
      ctx.syncSelf();
      ctx.reply('Flight enabled. Space to rise, Shift to descend.', 'ok');
      return { ok: true, message: 'fly on' };
    },
  },
  {
    name: 'unfly', level: 1, usage: ';unfly', desc: 'Disable flight.',
    run(ctx) {
      ctx.player.state.fly = false;
      ctx.syncSelf();
      ctx.reply('Flight disabled.', 'ok');
      return { ok: true, message: 'fly off' };
    },
  },
  {
    name: 'speed', level: 1, usage: ';speed [0-400]', desc: 'Set your walk speed.',
    run(ctx, args) {
      const n = Number(args[0]);
      if (!Number.isFinite(n) || n < 0 || n > 400) {
        return { ok: false, message: 'Speed must be between 0 and 400.' };
      }
      ctx.player.state.speed = n;
      ctx.syncSelf();
      return { ok: true, message: `speed ${n}`, reply: `Walk speed set to ${n}.` };
    },
  },
  {
    name: 'jump', level: 1, usage: ';jump [0-400]', desc: 'Set your jump power.',
    run(ctx, args) {
      const n = Number(args[0]);
      if (!Number.isFinite(n) || n < 0 || n > 400) {
        return { ok: false, message: 'Jump power must be between 0 and 400.' };
      }
      ctx.player.state.jumpPower = n;
      ctx.syncSelf();
      return { ok: true, message: `jump ${n}`, reply: `Jump power set to ${n}.` };
    },
  },
  {
    name: 'invisible', level: 1, usage: ';invisible', desc: 'Hide your character from others.',
    run(ctx) {
      ctx.player.invisible = true;
      ctx.world.broadcastFlags(ctx.player);
      ctx.reply('You are now invisible.', 'ok');
      return { ok: true, message: 'invisible on' };
    },
  },
  {
    name: 'visible', level: 1, usage: ';visible', desc: 'Show your character again.',
    run(ctx) {
      ctx.player.invisible = false;
      ctx.world.broadcastFlags(ctx.player);
      ctx.reply('You are visible again.', 'ok');
      return { ok: true, message: 'invisible off' };
    },
  },

  {
    name: 'bring', level: 1, usage: ';bring [player|all]', desc: 'Teleport a player to you.',
    run(ctx, args) {
      const targets = eligibleTargets(ctx.world, args[0], ctx);
      if (!targets) return { ok: false, message: 'no target' };
      const dest = ctx.player.state.pos;
      for (const t of targets) {
        if (t.id === ctx.player.id) continue;
        ctx.world.teleport(t, [dest[0], dest[1] + 1.5, dest[2]]);
      }
      const names = targets.filter((t) => t.id !== ctx.player.id).map((t) => t.username);
      if (!names.length) return { ok: false, message: 'nothing to bring' };
      ctx.reply(`Brought ${names.join(', ')} to you.`, 'ok');
      return { ok: true, message: `bring ${names.join(',')}`, target: names.join(',') };
    },
  },
  {
    name: 'to', level: 1, usage: ';to [player]', desc: 'Teleport yourself to a player.',
    run(ctx, args) {
      const target = targetOrError(ctx.world, args[0], ctx);
      if (!target) return { ok: false, message: 'no target' };
      if (target.id === ctx.player.id) return { ok: false, message: 'cannot teleport to self' };
      const p = target.state.pos;
      ctx.world.teleport(ctx.player, [p[0], p[1] + 1.5, p[2]]);
      ctx.reply(`Teleported to ${target.username}.`, 'ok');
      return { ok: true, message: `to ${target.username}`, target: target.username };
    },
  },
  {
    name: 'freeze', level: 1, usage: ';freeze [player|all]', desc: 'Freeze a player in place.',
    run(ctx, args) {
      const targets = eligibleTargets(ctx.world, args[0], ctx);
      if (!targets) return { ok: false, message: 'no target' };
      for (const t of targets) {
        t.state.frozen = true;
        t.state.vel[0] = t.state.vel[2] = 0;
        ctx.world.broadcastFlags(t);
      }
      const names = targets.map((t) => t.username);
      ctx.reply(`Froze ${names.join(', ')}.`, 'ok');
      return { ok: true, message: `freeze ${names.join(',')}`, target: names.join(',') };
    },
  },
  {
    name: 'unfreeze', level: 1, usage: ';unfreeze [player|all]', desc: 'Unfreeze a player.',
    run(ctx, args) {
      const targets = eligibleTargets(ctx.world, args[0], ctx);
      if (!targets) return { ok: false, message: 'no target' };
      for (const t of targets) {
        t.state.frozen = false;
        ctx.world.broadcastFlags(t);
      }
      const names = targets.map((t) => t.username);
      ctx.reply(`Unfroze ${names.join(', ')}.`, 'ok');
      return { ok: true, message: `unfreeze ${names.join(',')}` };
    },
  },
  {
    name: 'heal', level: 1, usage: ';heal [player|all]', desc: 'Respawn a player at the spawn point.',
    run(ctx, args) {
      const targets = eligibleTargets(ctx.world, args[0], ctx);
      if (!targets) return { ok: false, message: 'no target' };
      for (const t of targets) {
        ctx.world.teleport(t, ctx.world.spawn);
        t.state.vel = [0, 0, 0];
      }
      ctx.reply(`Respawned ${targets.map((t) => t.username).join(', ')}.`, 'ok');
      return { ok: true, message: 'heal' };
    },
  },
  {
    name: 'announce', level: 1, usage: ';announce [message]', desc: 'Broadcast a server-wide message.', rest: true,
    run(ctx, args, afterName) {
      const text = String(afterName || '').trim();
      if (!text) return { ok: false, message: 'empty announcement' };
      ctx.world.announce(`${ctx.player.username}: ${text}`);
      return { ok: true, message: `announce "${text}"` };
    },
  },

  {
    name: 'kick', level: 2, usage: ';kick [player] [reason]', desc: 'Remove a player from this server.',
    run(ctx, args) {
      const target = targetOrError(ctx.world, args[0], ctx);
      if (!target) return { ok: false, message: 'no target' };
      if (target.effectiveLevel >= ctx.level && target.id !== ctx.player.id) {
        ctx.reply(`You cannot kick ${target.username} (equal or higher rank).`, 'err');
        return { ok: false, message: 'rank too high' };
      }
      const reason = args.slice(1).join(' ') || 'No reason given';
      ctx.world.kick(target, reason, ctx.player.username);
      return { ok: true, message: `kick ${target.username}: ${reason}`, target: target.username };
    },
  },
  {
    name: 'ban', level: 2, usage: ';ban [player] [duration?] [reason?]', desc: 'Ban a player (online or offline).',
    run(ctx, args) {
      const needle = String(args[0] || '').replace(/^@/, '');
      if (!needle) return { ok: false, message: 'no target' };

      let online = null;
      const found = resolvePlayer(ctx.world, needle);
      if (found.matches.length === 1) online = found.matches[0];

      const dbUser = online ? null : userByUsername(needle);
      const userID = online?.id || dbUser?.id;
      const username = online?.username || dbUser?.username;
      if (!userID) return { ok: false, message: 'unknown user' };
      if (username.toLowerCase() === ctx.player.username.toLowerCase()) {
        return { ok: false, message: 'cannot ban self' };
      }

      const targetLevel = Math.max(online?.effectiveLevel ?? 0, dbUser?.role ?? 0);
      if (targetLevel >= ctx.level) {
        return { ok: false, message: 'rank too high', reply: 'You cannot ban someone at or above your rank.' };
      }

      let duration = null;
      let rest = args.slice(1);
      const maybe = parseDuration(rest[0]);
      if (maybe) { duration = maybe; rest = rest.slice(1); }
      const reason = rest.join(' ').slice(0, 200) || 'Banned by an administrator';
      const until = duration ? now() + duration : now() + 100 * 365 * 86_400_000;

      banUser(userID, until, reason);
      if (online) ctx.world.kick(online, `Banned: ${reason}`, ctx.player.username);
      const human = duration ? formatDuration(duration) : 'permanently';
      ctx.reply(`Banned ${username} ${human}. Reason: ${reason}`, 'ok');
      return { ok: true, message: `ban ${username} ${duration || 'permanent'} ${reason}`, target: username };
    },
  },
  {
    name: 'unban', level: 2, usage: ';unban [username]', desc: 'Lift a ban.',
    run(ctx, args) {
      const username = String(args[0] || '').replace(/^@/, '');
      const user = userByUsername(username);
      if (!user) return { ok: false, message: 'unknown user' };
      if (!user.banned_until) return { ok: false, message: 'not banned', reply: `${user.username} is not banned.` };
      banUser(user.id, 0, '');
      ctx.reply(`Unbanned ${user.username}.`, 'ok');
      return { ok: true, message: `unban ${user.username}`, target: user.username };
    },
  },
  {
    name: 'give', level: 2, usage: ';give [player] [item]', desc: 'Grant a catalog item to a player.', rest: true,
    run(ctx, args) {
      const target = targetOrError(ctx.world, args[0], ctx);
      if (!target) return { ok: false, message: 'no target' };
      const itemName = args.slice(1).join(' ');
      const item = resolveItem(itemName);
      if (!item) return { ok: false, message: 'unknown item', reply: `No catalog item matches "${itemName}".` };
      grantItem(target.id, item.id);
      ctx.world.sendTo(target, { t: 'chat', kind: 'system', text: `You received ${item.name} from ${ctx.player.username}.` });
      ctx.reply(`Gave ${item.name} to ${target.username}.`, 'ok');
      return { ok: true, message: `give ${target.username} ${item.id}`, target: target.username };
    },
  },
  {
    name: 'coins', level: 2, usage: ';coins [player] [amount]', desc: 'Adjust a player\'s Sparks balance.',
    run(ctx, args) {
      const target = targetOrError(ctx.world, args[0], ctx);
      if (!target) return { ok: false, message: 'no target' };
      const amount = Math.round(Number(args[1]));
      if (!Number.isFinite(amount) || Math.abs(amount) > 100_000) {
        return { ok: false, message: 'bad amount' };
      }
      const total = adjustCoins(target.id, amount);
      ctx.world.sendTo(target, { t: 'coins', coins: total });
      ctx.reply(`${amount >= 0 ? 'Gave' : 'Removed'} ${Math.abs(amount)} Sparks ${amount >= 0 ? 'to' : 'from'} ${target.username} (now ${total}).`, 'ok');
      return { ok: true, message: `coins ${target.username} ${amount}`, target: target.username };
    },
  },

  {
    name: 'role', level: 3, usage: ';role [user] [0-3]', desc: 'Set a platform permission level.',
    run(ctx, args) {
      const username = String(args[0] || '');
      const level = Number(args[1]);
      if (!Number.isInteger(level) || level < 0 || level > 3) {
        return { ok: false, message: 'bad level' };
      }
      const user = userByUsername(username);
      if (!user) return { ok: false, message: 'unknown user' };
      setRole(user.id, level);
      const online = [...ctx.world.players.values()].find((p) => p.id === user.id);
      if (online) {
        online.role = level;
        online.effectiveLevel = ctx.world.effectiveLevel(online);
        ctx.world.broadcastFlags(online);
      }
      ctx.reply(`${user.username} is now ${LEVELS[level]} (level ${level}).`, 'ok');
      return { ok: true, message: `role ${user.username} ${level}`, target: user.username };
    },
  },
  {
    name: 'shutdown', level: 3, usage: ';shutdown', desc: 'Shut down this server for everyone.',
    run(ctx) {
      if (ctx.world.shuttingDown) return { ok: false, message: 'already shutting down' };
      ctx.reply('Shutting down this server.', 'ok');
      ctx.world.announce(`Server shutdown requested by ${ctx.player.username}.`);
      setTimeout(() => ctx.world.shutdown(`Server shut down by ${ctx.player.username}`), 1200);
      return { ok: true, message: 'shutdown' };
    },
  },
  {
    name: 'history', level: 2, usage: ';history', desc: 'Show recent admin actions in this server.',
    run(ctx) {
      const rows = commandHistory({ gameID: ctx.world.gameId, limit: 10 });
      if (!rows.length) return { ok: false, message: 'no history', reply: 'No commands logged yet.' };
      for (const row of rows) {
        const when = new Date(row.created_at).toLocaleTimeString();
        ctx.reply(`${when} ${row.actor_name}: ${row.raw} — ${row.ok ? 'ok' : 'failed'}`, 'info');
      }
      return { ok: true, message: 'history shown' };
    },
  },
];

function formatDuration(ms) {
  const units = [['w', 604_800_000], ['d', 86_400_000], ['h', 3_600_000], ['m', 60_000], ['s', 1000]];
  for (const [suffix, size] of units) {
    if (ms >= size) return `${Math.round(ms / size)}${suffix}`;
  }
  return '1s';
}

export const COMMAND_INDEX = new Map(COMMANDS.map((c) => [c.name, c]));
export const COMMAND_LIST = COMMANDS.map((c) => ({
  name: c.name, level: c.level, usage: c.usage, desc: c.desc,
}));

/**
 * Execute a raw command string such as `;speed 42`.
 * Returns the result, or null when the player is not allowed to know it exists.
 */
export function executeCommand(raw, ctx) {
  const text = String(raw || '').trim();
  if (!text.startsWith(';')) return null;
  const body = text.slice(1).trim();
  if (!body) return { ok: false, message: 'empty' };

  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(body);
  const name = (match?.[1] || '').toLowerCase();
  const rest = match?.[2] || '';
  const args = rest.length ? rest.split(/\s+/) : [];
  const command = COMMAND_INDEX.get(name);

  // Silent for everyone who is not staff at all: nothing to learn here.
  if (ctx.level < 1) return null;

  const record = (ok, message, target = '') => {
    logCommand({
      gameID: ctx.world.gameId,
      actorID: ctx.player.id,
      actorName: ctx.player.username,
      target,
      command: name,
      raw: text.slice(0, 300),
      ok,
      message,
    });
  };

  if (!command) {
    ctx.reply(`Unknown command ";${name}". Try ;help.`, 'err');
    record(false, 'unknown command');
    return { ok: false, message: 'unknown command' };
  }
  if (ctx.level < command.level) {
    ctx.reply(`";${name}" requires level ${command.level} (${LEVELS[command.level]}).`, 'err');
    record(false, 'insufficient level');
    return { ok: false, message: 'insufficient level' };
  }

  let result;
  try {
    result = command.run(ctx, args, rest) || { ok: true, message: 'done' };
  } catch (err) {
    console.error('[command]', name, err);
    ctx.reply(`Command failed: ${err.message}`, 'err');
    result = { ok: false, message: err.message };
  }

  if (result.reply) ctx.reply(result.reply, result.ok ? 'ok' : 'err');
  else if (!result.ok && result.message && !result.reply) ctx.reply(`;${name}: ${result.message}`, 'err');
  record(!!result.ok, result.message || '', result.target || '');
  return result;
}

export function commandsAllowedFor(level) {
  return COMMAND_LIST.filter((c) => c.level <= level);
}
