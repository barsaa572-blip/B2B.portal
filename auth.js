(() => {
  const roles = {
    agent: { label: 'Ticketing agent' },
    office: { label: 'Office manager' },
    platform: { label: 'Platform admin' }
  };
  const storageKey = 'flightb2b-session';
  const root = document.querySelector('#auth-root');
  let refreshTimer = null;
  const roleKey = role => ({ office_manager: 'office', platform_admin: 'platform' }[role] || role);
  const session = () => { try { return JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { return null; } };
  const valid = value => value?.accessToken && value?.profile && roles[roleKey(value.profile.role)];
  const save = value => sessionStorage.setItem(storageKey, JSON.stringify(value));
  const stopRefresh = () => { if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = null; };
  const makeSession = (result, previous = {}) => ({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken || previous.refreshToken || null,
    expiresAt: Date.now() + Math.max(60, Number(result.expiresIn || 3600)) * 1000,
    profile: result.profile || previous.profile
  });
  const signOut = () => {
    stopRefresh(); sessionStorage.removeItem(storageKey); sessionStorage.removeItem('flightb2b-demo-session');
    document.body.classList.remove('role-agent', 'role-office', 'role-platform'); root.hidden = false; render();
  };
  window.forcePortalSignOut = signOut;
  const scheduleRefresh = value => {
    stopRefresh();
    if (!value?.refreshToken || !Number.isFinite(Number(value.expiresAt))) return;
    refreshTimer = setTimeout(async () => { if (!await refreshPortalSession()) signOut(); }, Math.max(10000, Number(value.expiresAt) - Date.now() - 120000));
  };
  const refreshPortalSession = async () => {
    const previous = session();
    if (!previous?.refreshToken) return null;
    try {
      const response = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: previous.refreshToken }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.accessToken) return null;
      const next = makeSession(result, previous); save(next); scheduleRefresh(next); return next;
    } catch { return null; }
  };
  window.refreshPortalSession = refreshPortalSession;
  const bindSidebarAccount = value => {
    const avatar = document.querySelector('#sidebar-avatar'), role = document.querySelector('#sidebar-role'), username = document.querySelector('#sidebar-username');
    const more = document.querySelector('.sidebar-foot .more'), menu = document.querySelector('.sidebar-account-menu'), signout = document.querySelector('.sidebar-signout');
    if (!avatar || !role || !username || !more || !menu || !signout) return;
    avatar.textContent = value.profile.full_name.slice(0, 1).toUpperCase(); role.textContent = roles[roleKey(value.profile.role)].label; username.textContent = value.profile.full_name;
    if (more.dataset.bound) return;
    more.dataset.bound = 'true';
    more.addEventListener('click', event => { event.stopPropagation(); menu.hidden = !menu.hidden; more.setAttribute('aria-expanded', String(!menu.hidden)); });
    signout.addEventListener('click', signOut);
    document.addEventListener('click', event => { if (!event.target.closest('.sidebar-foot')) { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); } });
  };
  const applyRole = value => {
    root.hidden = true; document.body.classList.remove('role-agent', 'role-office', 'role-platform');
    const role = roleKey(value.profile.role); document.body.classList.add(`role-${role}`);
    window.applyBookingScope?.(role); if (role === 'platform') window.loadAdministration?.(); if (role === 'office') window.loadTeamAccess?.();
    window.loadTopupInvoices?.(); window.loadWallet?.(); window.loadBookings?.(); bindSidebarAccount(value); scheduleRefresh(value);
  };
  const render = () => {
    root.innerHTML = `<section class="auth-card"><div class="auth-intro"><div class="auth-mark">F</div><h1>Flight B2B Portal</h1><p>Secure airline ticketing for agencies and office operations.</p><div class="auth-permissions"><div><strong>Agent</strong><br>Own bookings only</div><div><strong>Office manager</strong><br>Agency / branch control</div></div></div><form class="auth-form"><h2>Sign in</h2><p>Use your company email and password to continue.</p><label>Email address<input type="email" id="login-email" placeholder="name@company.mn" required autocomplete="email" /></label><label>Password<input id="login-password" type="password" placeholder="Password" required autocomplete="current-password" /></label><p class="auth-error" role="alert" hidden></p><button class="primary auth-signin" type="submit">Sign in</button><p class="auth-note">Your access level is assigned by the platform administrator.</p></form></section>`;
    root.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); const email = root.querySelector('#login-email').value.trim(), password = root.querySelector('#login-password').value;
      const error = root.querySelector('.auth-error'), submit = root.querySelector('.auth-signin'); error.hidden = true; submit.disabled = true; submit.textContent = 'Signing in…';
      try {
        const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Sign in failed.');
        const next = makeSession(result); save(next); sessionStorage.removeItem('flightb2b-demo-session'); applyRole(next);
      } catch (err) { error.textContent = err.message; error.hidden = false; submit.disabled = false; submit.textContent = 'Sign in'; }
    });
  };
  const existing = session();
  if (!valid(existing)) { if (existing) sessionStorage.removeItem(storageKey); render(); return; }
  if (existing.refreshToken && Number(existing.expiresAt || 0) - Date.now() < 120000) refreshPortalSession().then(value => value ? applyRole(value) : signOut());
  else applyRole(existing);
})();
