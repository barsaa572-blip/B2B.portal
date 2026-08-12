(() => {
  const roles = {
    agent: { label: 'Ticketing agent', description: 'Search, book and issue tickets. View only your own bookings.' },
    office: { label: 'Office manager', description: 'View your agency or branch bookings, statistics and wallet balance.' },
    platform: { label: 'Platform admin', description: 'Manage every agency, user, booking and wallet adjustment.' }
  };
  const roleKey = role => ({ office_manager: 'office', platform_admin: 'platform' }[role] || role);
  const root = document.querySelector('#auth-root');
  const savedSession = sessionStorage.getItem('flightb2b-session');
  let stored = null;
  try { stored = savedSession ? JSON.parse(savedSession) : null; } catch { sessionStorage.removeItem('flightb2b-session'); }
  const validStoredSession = stored && stored.accessToken && stored.profile && roles[roleKey(stored.profile.role)];
  if (savedSession && !validStoredSession) sessionStorage.removeItem('flightb2b-session');
  const escape = value => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
  const signOut = () => { sessionStorage.removeItem('flightb2b-session'); sessionStorage.removeItem('flightb2b-demo-session'); location.reload(); };
  const bindSidebarAccount = session => {
    const avatar = document.querySelector('#sidebar-avatar');
    const role = document.querySelector('#sidebar-role');
    const username = document.querySelector('#sidebar-username');
    const more = document.querySelector('.sidebar-foot .more');
    const menu = document.querySelector('.sidebar-account-menu');
    const signout = document.querySelector('.sidebar-signout');
    if (!avatar || !role || !username || !more || !menu || !signout) return;
    avatar.textContent = session.profile.full_name.slice(0, 1).toUpperCase();
    role.textContent = roles[roleKey(session.profile.role)].label;
    username.textContent = session.profile.full_name;
    if (more.dataset.bound) return;
    more.dataset.bound = 'true';
    more.addEventListener('click', event => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      more.setAttribute('aria-expanded', String(!menu.hidden));
    });
    signout.addEventListener('click', signOut);
    document.addEventListener('click', event => {
      if (!event.target.closest('.sidebar-foot')) { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); }
    });
  };
  const applyRole = session => {
    root.hidden = true;
    document.body.classList.remove('role-agent','role-office','role-platform');
    const currentRole = roleKey(session.profile.role);
    document.body.classList.add(`role-${currentRole}`);
    window.applyBookingScope?.(currentRole);
    if (currentRole === 'platform') window.loadAdministration?.();
    window.loadTopupInvoices?.();
    bindSidebarAccount(session);
  };
  const render = () => {
    root.innerHTML = `<section class="auth-card"><div class="auth-intro"><div class="auth-mark">F</div><h1>Flight B2B Portal</h1><p>Secure airline ticketing for agencies and office operations.</p><div class="auth-permissions"><div><strong>Agent</strong><br>Own bookings only</div><div><strong>Office manager</strong><br>Agency / branch control</div></div></div><form class="auth-form"><h2>Sign in</h2><p>Use your company email and password to continue.</p><label>Email address<input type="email" id="login-email" placeholder="name@company.mn" required autocomplete="email" /></label><label>Password<input id="login-password" type="password" placeholder="Password" required autocomplete="current-password" /></label><p class="auth-error" role="alert" hidden></p><button class="primary auth-signin" type="submit">Sign in</button><p class="auth-note">Your access level is assigned by the platform administrator.</p></form></section>`;
    root.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const email = root.querySelector('#login-email').value.trim();
      const password = root.querySelector('#login-password').value;
      const error = root.querySelector('.auth-error');
      const submit = root.querySelector('.auth-signin');
      error.hidden = true; submit.disabled = true; submit.textContent = 'Signing in…';
      try {
        const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Sign in failed.');
        const session = { accessToken: result.accessToken, profile: result.profile };
        sessionStorage.setItem('flightb2b-session', JSON.stringify(session));
        sessionStorage.removeItem('flightb2b-demo-session');
        applyRole(session);
      } catch (requestError) { error.textContent = requestError.message; error.hidden = false; submit.disabled = false; submit.textContent = 'Sign in'; }
    });
  };
  if (validStoredSession) applyRole(stored); else render();
})();
