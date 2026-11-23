// Bluetooth / USB controller support using the Gamepad API.
// Works fully offline. Standard mapping covers Xbox, PlayStation, Switch Pro,
// and most generic pads. Polled once per frame from the play view.

const DEADZONE = 0.18;

const applyDeadzone = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) < DEADZONE) return 0;
  const scaled = (Math.abs(n) - DEADZONE) / (1 - DEADZONE);
  return Math.sign(n) * Math.min(1, scaled);
};

export function createGamepadControls({ onConnect, onDisconnect, onEmote }) {
  let index = -1;
  let lastEmoteMask = 0;
  let emoteAt = 0;

  window.addEventListener('gamepadconnected', (e) => {
    index = e.gamepad.index;
    onConnect?.(e.gamepad.id || 'Controller');
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === index) index = -1;
    onDisconnect?.(e.gamepad.id || 'Controller');
  });

  function firstPad() {
    const pads = navigator.getGamepads?.() || [];
    if (index >= 0 && pads[index]) return pads[index];
    for (const pad of pads) if (pad && pad.connected) return pad;
    return null;
  }

  return {
    get connected() {
      return Boolean(firstPad());
    },

    /** Read the pad and return normalised intent for this frame. */
    read(now = performance.now()) {
      const pad = firstPad();
      if (!pad) return null;

      const ax = pad.axes || [];
      const bt = pad.buttons || [];
      const pressed = (i) => Boolean(bt[i]?.pressed);
      const value = (i) => Number(bt[i]?.value) || 0;

      // Left stick + d-pad move. Right stick orbits the camera.
      let mx = applyDeadzone(ax[0]);
      let mz = applyDeadzone(ax[1]);
      if (pressed(14)) mx -= 1;
      if (pressed(15)) mx += 1;
      if (pressed(12)) mz -= 1;
      if (pressed(13)) mz += 1;
      const len = Math.hypot(mx, mz);
      if (len > 1) { mx /= len; mz /= len; }

      // Y is inverted between screen space and world space.
      const lookX = applyDeadzone(ax[2]);
      const lookY = applyDeadzone(ax[3]);

      // B or Y plays an emote. Track each button separately so switching from
      // one to the other without releasing still counts as a fresh press.
      const emoteMask = (pressed(1) ? 1 : 0) | (pressed(3) ? 2 : 0);
      let emote = false;
      if ((emoteMask & ~lastEmoteMask) && now - emoteAt > 600) {
        emote = true;
        emoteAt = now;
      }
      lastEmoteMask = emoteMask;
      if (emote) onEmote?.();

      return {
        id: pad.id,
        mx,
        mz,
        jump: pressed(0) || pressed(7), // A / RT
        up: value(6) > 0.35 ? -1 : 0, // LT descends while flying
        lookX,
        lookY,
      };
    },
  };
}
