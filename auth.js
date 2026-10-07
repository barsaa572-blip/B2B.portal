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
    profile: result.profile || previous.profile,
    idleExpiresAt: result.idleExpiresAt ?? previous.idleExpiresAt,
    sessionExpiresAt: result.sessionExpiresAt ?? previous.sessionExpiresAt
  });
  const signOut = () => {
    activity.stop();
    void fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
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
  const activity = createPortalActivity({
    send: async () => {
      const current = session();
      if (Number(current?.expiresAt || 0) - Date.now() < 120000 && !await refreshPortalSession()) {
        throw Object.assign(new Error('Session expired.'), { status: 401 });
      }
      const response = await fetch('/api/auth/activity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!response.ok) throw Object.assign(new Error('Session check failed.'), { status: response.status });
      return response.json();
    },
    expired: message => { signOut(); showNotice(message); },
    changed: bounds => { const current = session(); if (valid(current)) save({ ...current, ...bounds }); }
  });
  window.forcePortalSignOut = () => { signOut(); showNotice('Your session expired. Sign in again.'); };
  const scheduleRefresh = value => {
    stopRefresh();
    if (!value?.refreshToken || !Number.isFinite(Number(value.expiresAt))) return;
    refreshTimer = setTimeout(async () => { if (!await refreshPortalSession()) signOut(); }, Math.max(10000, Number(value.expiresAt) - Date.now() - 120000));
  };
  let refreshRequest = null;
  const refreshPortalSession = async () => {
    if (refreshRequest) return refreshRequest;
    refreshRequest = performRefresh();
    try { return await refreshRequest; } finally { refreshRequest = null; }
  };
  const performRefresh = async () => {
    const previous = session();
    if (!previous?.refreshToken) return null;
    try {
      const response = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: previous.refreshToken }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.accessToken) return null;
      if (session()?.profile?.id !== previous.profile?.id) return null; // Logout wins over an in-flight refresh.
      const next = makeSession(result, previous); save(next); activity.update(next); scheduleRefresh(next); return next;
    } catch { return null; }
  };
  window.refreshPortalSession = refreshPortalSession;
  const openPasswordDialog = () => {
    if (document.querySelector('#password-dialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'password-dialog'; dialog.className = 'password-dialog';
    dialog.setAttribute('aria-labelledby', 'password-title');
    dialog.innerHTML = safeHtml(`<form><h2 id="password-title">Change password</h2>
      <p id="password-help">Use 8–128 characters including a letter, a number and a special character. Sign in again after changing your password.</p>
      <label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="1024"></label>
      <label>New password<input name="newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128" aria-describedby="password-help"></label>
      <label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label>
      <p class="password-error" role="alert" hidden></p>
      <div class="password-actions"><button type="button" class="secondary password-cancel">Cancel</button><button type="submit" class="primary">Change password</button></div></form>`);
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
    if (!activity.start(value)) return;
    window.placeThemeToggle?.(true);
    root.hidden = true; document.body.classList.remove('role-agent', 'role-office', 'role-platform');
    const role = roleKey(value.profile.role); document.body.classList.add(`role-${role}`);
    window.applyBookingScope?.(role); if (role === 'platform') window.loadAdministration?.(); if (role === 'office') window.loadTeamAccess?.();
    window.loadTopupInvoices?.(); window.loadWallet?.(); window.loadBookings?.(); window.loadDashboard?.(); bindSidebarAccount(value); scheduleRefresh(value);
  };
  const finishLogin = result => {
    const next = makeSession(result);
    save(next); sessionStorage.removeItem('flightb2b-demo-session'); applyRole(next);
  };
  const renderLoginStep = result => {
    const emailStep = result.nextStep === 'email';
    if (!emailStep && result.nextStep !== 'password') throw new Error('Sign in could not be completed.');
    sessionStorage.removeItem(storageKey); stopRefresh();
    root.hidden = false;
    root.innerHTML = safeHtml(`<section class="auth-card"><div class="auth-intro"><img class="nexahub-auth-logo" src="/nexahub-logo.png" alt="NEXAHUB by Air Sales"></div><form class="auth-form"><h2>${emailStep ? 'Check your email' : 'Renew your password'}</h2><p>${emailStep ? 'Enter the one-time code sent to your company email. This sign-in expires in five minutes. This browser remembers successful email verification for 24 hours; your password is still required after signing out.' : 'Passwords must be renewed every six months. For an existing account, the first renewal starts this period. Sign in again after saving.'}</p>
      ${emailStep ? '<label>Verification code<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" minlength="6" maxlength="10" required></label>' : '<label>Current password<input name="currentPassword" type="password" autocomplete="current-password" maxlength="1024" required></label><label>New password<input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><label>Confirm password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><p class="auth-note">Use a letter, number and special character. Choose a different password.</p>'}
      <p class="auth-error" role="alert" hidden></p><p class="auth-note" role="status" data-login-status></p><button class="primary auth-signin" type="submit">${emailStep ? 'Verify code' : 'Renew password'}</button>
      ${emailStep ? '<button type="button" class="text-btn" data-login-resend>Send another code</button>' : ''}<button type="button" class="text-btn" data-login-cancel>Back to sign in</button></form></section>`);
    const form = root.querySelector('form'), submit = form.querySelector('[type="submit"]'), error = form.querySelector('.auth-error'), resend = form.querySelector('[data-login-resend]'), cancel = form.querySelector('[data-login-cancel]'), status = form.querySelector('[data-login-status]');
    let busy = false, timer;
    const expiresAt = Date.now() + Number(result.expiresIn ?? 300) * 1000;
    let resendAt = Date.now() + Number(result.resendAfter ?? 60) * 1000;
    const stop = () => clearInterval(timer);
    const update = () => {
      if (!form.isConnected) { stop(); return; }
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      if (resend) { const wait = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)); resend.disabled = busy || wait > 0 || !remaining; resend.textContent = wait ? `Send another code (${wait}s)` : 'Send another code'; }
      submit.disabled = busy || !remaining;
      if (!remaining) status.textContent = 'This sign-in expired. Go back and sign in again.';
    };
    timer = setInterval(update, 1000); update();
    cancel.onclick = async () => {
      if (busy) return;
      busy = true; update();
      try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch {}
      stop(); render();
    };
    const request = async (path, body) => {
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || 'Verification failed. Try again.');
      return value;
    };
    if (resend) resend.onclick = async () => {
      if (busy) return;
      busy = true; error.hidden = true; update();
      try { const next = await request('/api/auth/resend-code', {}); resendAt = Date.now() + next.resendAfter * 1000; status.textContent = 'A new code was sent. Use the most recent email.'; }
      catch (issue) { error.textContent = issue.message; error.hidden = false; resendAt = Date.now() + 60000; }
      finally { busy = false; update(); }
    };
    form.onsubmit = async event => {
      event.preventDefault(); if (busy || Date.now() >= expiresAt) return;
      busy = true; error.hidden = true; update();
      try {
        const values = Object.fromEntries(new FormData(form));
        const next = await request(emailStep ? '/api/auth/verify-email' : '/api/auth/renew-password', values);
        form.reset(); stop();
        if (next.accessToken === 'cookie') finishLogin(next);
        else if (next.signInAgain) showNotice('Password renewed. Sign in with your new password.');
        else renderLoginStep(next);
      } catch (issue) { error.textContent = issue.message; error.hidden = false; }
      finally { busy = false; update(); }
    };
  };
  const render = () => {
    root.innerHTML = safeHtml(`<section class="auth-card"><div class="auth-intro"><img class="nexahub-auth-logo" src="/nexahub-logo.png?v=flightmark-20260921" alt="NEXAHUB by Air Sales" width="2172" height="724"></div><form class="auth-form"><h2>Sign in</h2><p>Use your company email and password to continue.</p><label>Email address<input type="email" id="login-email" placeholder="name@company.mn" required autocomplete="email" /></label><label>Password<input id="login-password" type="password" placeholder="Password" required autocomplete="current-password" /></label><p class="auth-error" role="alert" hidden></p><button class="primary auth-signin" type="submit">Sign in</button></form></section>`);
    root.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); const email = root.querySelector('#login-email').value.trim(), password = root.querySelector('#login-password').value;
      const error = root.querySelector('.auth-error'), submit = root.querySelector('.auth-signin'); error.hidden = true; submit.disabled = true; submit.textContent = 'Signing in…';
      try {
        const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Sign in failed.');
        root.querySelector('#login-password').value = '';
        if (result.nextStep) renderLoginStep(result); else finishLogin(result);
      } catch (err) { error.textContent = err.message; error.hidden = false; submit.disabled = false; submit.textContent = 'Sign in'; }
    });
  };
  const showNotice = notice => { render(); const target = root.querySelector('.auth-error'); target.textContent = notice; target.hidden = false; };
  const renderInvite = tokenHash => {
    root.hidden = false;
    root.innerHTML = safeHtml(`<section class="auth-card"><div class="auth-intro"><img class="nexahub-auth-logo" src="/nexahub-logo.png" alt="NEXAHUB by Air Sales"></div><form class="auth-form"><h2>Accept your invitation</h2><p>Create your password using 8–128 characters, including a letter, number and special character.</p><label>New password<input name="newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label><label>Confirm password<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label><p class="auth-error" role="alert" hidden></p><button class="primary auth-signin" type="submit">Confirm email and create password</button><button class="text-btn" type="button" data-invite-cancel>Back to sign in</button></form></section>`);
    root.querySelector('[data-invite-cancel]').onclick = () => { tokenHash = ''; render(); };
    root.querySelector('form').onsubmit = async event => {
      event.preventDefault(); const form = event.currentTarget, submit = form.querySelector('[type="submit"]'), error = form.querySelector('.auth-error');
      if (submit.disabled) return;
      const values = new FormData(form);
      if (values.get('newPassword') !== values.get('confirmPassword')) { error.textContent = 'New passwords do not match.'; error.hidden = false; return; }
      submit.disabled = true; error.hidden = true;
      try {
        const response = await fetch('/api/auth/accept-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tokenHash, newPassword: values.get('newPassword'), confirmPassword: values.get('confirmPassword') }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Invitation could not be completed. Contact your administrator.');
        tokenHash = ''; form.reset(); showNotice('Your email is confirmed and password is ready. Sign in with your company email and new password.');
      } catch (issue) { error.textContent = issue.message; error.hidden = false; submit.disabled = false; }
    };
  };
  // Keep invitation secrets only in this page's memory; remove them from history.
  // Legacy bearer fragments are discarded, never imported as a login session.
  const invitation = (() => {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!['invite_token', 'access_token', 'refresh_token', 'error'].some(key => params.has(key))) return null;
    const tokenHash = params.get('invite_token');
    history.replaceState(null, '', location.pathname + location.search);
    return { tokenHash, invalid: !tokenHash || !/^[a-f0-9]{32,128}$/i.test(tokenHash) };
  })();
  if (invitation) {
    if (invitation.invalid) showNotice('This email link is invalid, already used or outdated. Ask your administrator for a new invitation.');
    else renderInvite(invitation.tokenHash);
    return;
  }
  let existing = session();
  // Retire legacy browser-stored bearer tokens on upgrade.
  if (existing?.accessToken && existing.accessToken !== 'cookie') { sessionStorage.removeItem(storageKey); existing = null; }
  if (!valid(existing)) { if (existing) sessionStorage.removeItem(storageKey); render(); return; }
  if (existing.refreshToken && Number(existing.expiresAt || 0) - Date.now() < 120000) refreshPortalSession().then(value => value ? applyRole(value) : signOut());
  else applyRole(existing);
})();
