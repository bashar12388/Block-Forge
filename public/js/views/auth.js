import { api, setSession, state, navigate } from '../store.js';
import { el, esc, qs, toast } from '../ui.js';

const DEMO = [
  { user: 'forge', pass: 'forge12345', label: 'Owner', note: 'full permissions' },
  { user: 'admin', pass: 'admin12345', label: 'Admin', note: 'kick / ban / give' },
  { user: 'mod', pass: 'mod12345', label: 'Moderator', note: 'fly / freeze / bring' },
  { user: 'player', pass: 'player12345', label: 'Player', note: 'no commands' },
];

export function renderAuth(root, { mode = 'login' } = {}) {
  let current = mode;

  const mount = () => {
    const isLogin = current === 'login';
    root.innerHTML = `<div class="auth-wrap"><div class="auth-card">
      <h1>${isLogin ? 'Welcome back' : 'Create your account'}</h1>
      <p class="sub">${isLogin ? 'Sign in to play, build, and moderate your worlds.' : 'Free to join. 750 Sparks included.'}</p>
      ${state.offline || !navigator.onLine ? `<div class="auth-offline">
        <b>No connection right now</b>
        Signing in needs the server. If someone already signed in on this device, their saved worlds still play offline.
        <a class="btn btn-ghost btn-sm" href="#/offline">Open saved worlds</a>
      </div>` : ''}
      <form data-form autocomplete="on">
        <div class="field">
          <label for="username">Username</label>
          <input class="input" id="username" name="username" autocomplete="username" required minlength="3" maxlength="20" placeholder="buildername" />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input class="input" id="password" name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required minlength="8" placeholder="at least 8 characters" />
        </div>
        <p class="hint" data-error style="color:#fca5a5;min-height:18px"></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit">${isLogin ? 'Sign in' : 'Create account'}</button>
      </form>
      <div class="auth-switch">
        ${isLogin ? 'New here?' : 'Already have an account?'}
        <button type="button" data-switch>${isLogin ? 'Create an account' : 'Sign in'}</button>
      </div>
      <div class="demo-accounts">
        <h4>Demo accounts (password shown)</h4>
        <div class="demo-grid">
          ${DEMO.map((d) => `<button class="demo-btn" data-demo="${d.user}">
            <b>${d.user}</b><span>${d.label} · ${d.pass}</span>
          </button>`).join('')}
        </div>
      </div>
    </div></div>`;

    const form = qs(root, '[data-form]');
    const error = qs(root, '[data-error]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      error.textContent = '';
      const data = new FormData(form);
      try {
        const payload = await api(`/api/auth/${isLogin ? 'login' : 'register'}`, {
          method: 'POST',
          body: { username: String(data.get('username') || ''), password: String(data.get('password') || '') },
        });
        setSession(payload);
        toast(`Welcome${isLogin ? ' back' : ''}, ${payload.user.username}.`, 'good');
        navigate(sessionStorage.getItem('returnTo') || 'home');
        sessionStorage.removeItem('returnTo');
      } catch (err) {
        error.textContent = err.message;
        button.disabled = false;
      }
    });

    qs(root, '[data-switch]').addEventListener('click', () => {
      current = isLogin ? 'register' : 'login';
      mount();
    });

    root.querySelectorAll('[data-demo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const demo = DEMO.find((d) => d.user === btn.dataset.demo);
        qs(root, '#username').value = demo.user;
        qs(root, '#password').value = demo.pass;
        form.requestSubmit();
      });
    });

    qs(root, '#username').focus();
  };

  mount();

  return {
    title: mode === 'login' ? 'Sign in' : 'Join',
    destroy() {},
  };
}

export function requireAuth() {
  if (state.user) return true;
  sessionStorage.setItem('returnTo', location.hash.replace(/^#\/?/, '') || 'home');
  navigate('login');
  toast('Sign in to continue.', 'warn');
  return false;
}
