// On-screen controls for tablets and phones (also works with a mouse, which is
// handy for testing). The play view feeds these values into WorldView.touch,
// which is merged with the keyboard and gamepad intent.

const DEADZONE = 0.12;

function normalise(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) < DEADZONE) return 0;
  const scaled = (Math.abs(n) - DEADZONE) / (1 - DEADZONE);
  return Math.sign(n) * Math.min(1, scaled);
}

export function createTouchControls({ onEmote, onJump } = {}) {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!coarse) return null;

  const root = document.createElement('div');
  root.className = 'touch-ui';
  root.innerHTML = `
    <div class="touch-stick" data-stick aria-label="Movement stick">
      <div class="touch-ring"></div>
      <div class="touch-knob" data-knob></div>
    </div>
    <div class="touch-actions">
      <div class="touch-fly" data-fly-group hidden>
        <button class="touch-btn touch-btn-sm" data-fly-up aria-label="Fly up">▲</button>
        <button class="touch-btn touch-btn-sm" data-fly-down aria-label="Fly down">▼</button>
      </div>
      <button class="touch-btn touch-btn-emote" data-touch-emote aria-label="Play emote">😀</button>
      <button class="touch-btn touch-btn-jump" data-jump aria-label="Jump">Jump</button>
    </div>`;

  const stick = root.querySelector('[data-stick]');
  const knob = root.querySelector('[data-knob]');
  const jumpBtn = root.querySelector('[data-jump]');
  const emoteBtn = root.querySelector('[data-touch-emote]');
  const flyGroup = root.querySelector('[data-fly-group]');
  const flyUp = root.querySelector('[data-fly-up]');
  const flyDown = root.querySelector('[data-fly-down]');

  const state = { mx: 0, mz: 0, jump: false, up: 0 };
  const stickState = { active: false, pointerId: null, cx: 0, cy: 0, radius: 52 };

  function setStick(e) {
    const dx = e.clientX - stickState.cx;
    const dy = e.clientY - stickState.cy;
    const r = stickState.radius;
    const len = Math.hypot(dx, dy);
    const k = len > r ? r / len : 1;
    const x = dx * k;
    const y = dy * k;
    knob.style.transform = `translate(${x}px, ${y}px)`;
    state.mx = normalise(x / r);
    state.mz = normalise(y / r);
  }

  function resetStick() {
    stickState.active = false;
    stickState.pointerId = null;
    knob.style.transform = 'translate(0px, 0px)';
    state.mx = 0;
    state.mz = 0;
  }

  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const rect = stick.getBoundingClientRect();
    stickState.active = true;
    stickState.pointerId = e.pointerId;
    stickState.cx = rect.left + rect.width / 2;
    stickState.cy = rect.top + rect.height / 2;
    stickState.radius = rect.width * 0.46;
    try { stick.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointers */ }
    setStick(e);
  });

  stick.addEventListener('pointermove', (e) => {
    if (!stickState.active || e.pointerId !== stickState.pointerId) return;
    e.preventDefault();
    setStick(e);
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    stick.addEventListener(type, () => resetStick());
  }

  const hold = (el, on, off) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointers */ }
      el.classList.add('is-down');
      on();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      el.addEventListener(type, () => {
        el.classList.remove('is-down');
        off();
      });
    }
  };

  hold(jumpBtn, () => { state.jump = true; onJump?.(); }, () => { state.jump = false; });
  hold(flyUp, () => { state.up = 1; }, () => { state.up = 0; });
  hold(flyDown, () => { state.up = -1; }, () => { state.up = 0; });

  emoteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    emoteBtn.classList.add('is-down');
    setTimeout(() => emoteBtn.classList.remove('is-down'), 160);
    onEmote?.();
  });

  let flyShown = null;
  return {
    root,
    state,
    /** Push joystick/button state into the world and reveal fly buttons. */
    sync(world) {
      if (!world) return;
      world.touch.mx = state.mx;
      world.touch.mz = state.mz;
      world.touch.jump = state.jump;
      world.touch.up = state.up;
      const flying = Boolean(world.self?.state?.fly);
      if (flying !== flyShown) {
        flyShown = flying;
        flyGroup.hidden = !flying;
        if (!flying) state.up = 0;
      }
    },
    destroy() {
      resetStick();
      root.remove();
    },
  };
}
