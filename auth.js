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
    window.placeThemeToggle?.(false);
    const menu = document.querySelector('.sidebar-account-menu');
    if (menu) menu.hidden = true;
    document.querySelector('.sidebar-foot .more')?.setAttribute('aria-expanded', 'false');
    stopRefresh(); sessionStorage.removeItem(storageKey); sessionStorage.removeItem('flightb2b-demo-session');
    window.resetDashboard?.();
    // A session can expire while an invoice or ticket dialog is open. Close every
    // native dialog before revealing the sign-in screen so stale forms never sit
    // above it or display the internal session-expiry marker.
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
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
  const openPasswordDialog = () => {
    if (document.querySelector('#password-dialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'password-dialog'; dialog.className = 'password-dialog';
    dialog.setAttribute('aria-labelledby', 'password-title');
    dialog.innerHTML = `<form><h2 id="password-title">Change password</h2>
      <p id="password-help">Use 8–128 characters including a letter, a number and a special character. Sign in again after changing your password.</p>
      <label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="1024"></label>
      <label>New password<input name="newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128" aria-describedby="password-help"></label>
      <label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label>
      <p class="password-error" role="alert" hidden></p>
      <div class="password-actions"><button type="button" class="secondary password-cancel">Cancel</button><button type="submit" class="primary">Change password</button></div></form>`;
    document.body.append(dialog);
    const form = dialog.querySelector('form'), submit = dialog.querySelector('[type="submit"]'), error = dialog.querySelector('.password-error');
    let busy = false;
    dialog.querySelector('.password-cancel').addEventListener('click', () => { if (!busy) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => { form.reset(); dialog.remove(); document.querySelector('.sidebar-foot .more')?.focus(); });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      error.hidden = true;
      const input = Object.fromEntries(new FormData(form));
      if (!/\p{L}/u.test(input.newPassword) || !/\p{N}/u.test(input.newPassword) || !/[^\p{L}\p{N}\s]/u.test(input.newPassword)) { error.textContent = 'Include a letter, a number and a special character.'; error.hidden = false; return; }
      if (input.newPassword !== input.confirmPassword) { error.textContent = 'New passwords do not match.'; error.hidden = false; return; }
      if (input.newPassword === input.currentPassword) { error.textContent = 'Choose a password different from your current password.'; error.hidden = false; return; }
      busy = true; submit.disabled = true; submit.textContent = 'Changing…';
      dialog.querySelector('.password-cancel').disabled = true;
      try {
        let current = session();
        if (current?.refreshToken && Number(current.expiresAt || 0) - Date.now() < 120000) current = await refreshPortalSession();
        if (!current?.accessToken) { signOut(); return; }
        const response = await fetch('/api/auth/password', { method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${current.accessToken}` }, body:JSON.stringify(input) });
        const result = await response.json().catch(() => ({}));
        if (response.status === 401) { signOut(); return; }
        if (!response.ok) throw new Error(result.error || 'Password could not be changed.');
        dialog.close(); signOut();
        const notice = document.createElement('p'); notice.className = 'password-success'; notice.setAttribute('role','status');
        notice.textContent = 'Password changed. Sign in with your new password.';
        root.querySelector('.auth-form h2').after(notice);
      } catch (err) { error.textContent = err.message; error.hidden = false; }
      finally { busy = false; submit.disabled = false; submit.textContent = 'Change password'; dialog.querySelector('.password-cancel').disabled = false; }
    });
    dialog.showModal();
  };
  const bindSidebarAccount = value => {
    const avatar = document.querySelector('#sidebar-avatar'), role = document.querySelector('#sidebar-role'), username = document.querySelector('#sidebar-username');
    const more = document.querySelector('.sidebar-foot .more'), menu = document.querySelector('.sidebar-account-menu'), signout = document.querySelector('.sidebar-signout');
    if (!avatar || !role || !username || !more || !menu || !signout) return;
    avatar.textContent = value.profile.full_name.slice(0, 1).toUpperCase(); role.textContent = roles[roleKey(value.profile.role)].label; username.textContent = value.profile.full_name;
    if (more.dataset.bound) return;
    more.dataset.bound = 'true';
    more.addEventListener('click', event => { event.stopPropagation(); menu.hidden = !menu.hidden; more.setAttribute('aria-expanded', String(!menu.hidden)); });
    signout.addEventListener('click', signOut);
    document.querySelector('.sidebar-password')?.addEventListener('click', () => { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); openPasswordDialog(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); more.focus(); } });
    document.addEventListener('click', event => { if (!event.target.closest('.sidebar-foot')) { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); } });
  };
  const applyRole = value => {
    window.placeThemeToggle?.(true);
    root.hidden = true; document.body.classList.remove('role-agent', 'role-office', 'role-platform');
    const role = roleKey(value.profile.role); document.body.classList.add(`role-${role}`);
    window.applyBookingScope?.(role); if (role === 'platform') window.loadAdministration?.(); if (role === 'office') window.loadTeamAccess?.();
    window.loadTopupInvoices?.(); window.loadWallet?.(); window.loadBookings?.(); window.loadDashboard?.(); bindSidebarAccount(value); scheduleRefresh(value);
  };
  const render = () => {
    root.innerHTML = `<section class="auth-card"><div class="auth-intro"><img class="nexahub-auth-logo" src="/nexahub-logo.png?v=flightmark-20260921" alt="NEXAHUB by Air Sales" width="2172" height="724"></div><form class="auth-form"><h2>Sign in</h2><p>Use your company email and password to continue.</p><label>Email address<input type="email" id="login-email" placeholder="name@company.mn" required autocomplete="email" /></label><label>Password<input id="login-password" type="password" placeholder="Password" required autocomplete="current-password" /></label><p class="auth-error" role="alert" hidden></p><button class="primary auth-signin" type="submit">Sign in</button></form></section>`;
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
