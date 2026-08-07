(() => {
  const roles = {
    agent: { label: 'Ticketing agent', description: 'Search, book and issue tickets. View only your own bookings.' },
    office: { label: 'Office manager', description: 'View your agency or branch bookings, statistics and wallet balance.' },
    platform: { label: 'Platform admin', description: 'Manage every agency, user, booking and wallet adjustment.' }
  };
  const root = document.querySelector('#auth-root');
  const savedSession = sessionStorage.getItem('flightb2b-demo-session');
  let stored = null;
  try { stored = savedSession ? JSON.parse(savedSession) : null; } catch { sessionStorage.removeItem('flightb2b-demo-session'); }
  const validStoredSession = stored && stored.username === 'Admin' && roles[stored.role];
  if (savedSession && !validStoredSession) sessionStorage.removeItem('flightb2b-demo-session');
  let chosenRole = validStoredSession ? stored.role : 'agent';
  const escape = value => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
  const applyRole = session => {
    root.hidden = true;
    document.body.classList.remove('role-agent','role-office','role-platform');
    document.body.classList.add(`role-${session.role}`);
    const old = document.querySelector('.session-role'); if (old) old.remove();
    const bar = document.createElement('div'); bar.className = 'session-role';
    bar.innerHTML = `<span>${escape(session.username.slice(0,1).toUpperCase())}</span><div><strong>${escape(roles[session.role].label)}</strong><br>${escape(session.username)}</div><button type="button">Sign out</button>`;
    bar.querySelector('button').addEventListener('click', () => { sessionStorage.removeItem('flightb2b-demo-session'); location.reload(); });
    document.body.append(bar);
  };
  const render = () => {
    root.innerHTML = `<section class="auth-card"><div class="auth-intro"><div class="auth-mark">F</div><h1>Flight B2B Portal</h1><p>Secure airline ticketing for agencies, offices and platform operations.</p><div class="auth-permissions"><div><strong>Agent</strong><br>Own bookings only</div><div><strong>Office manager</strong><br>Agency / branch control</div><div><strong>Platform admin</strong><br>All agencies and wallets</div></div></div><form class="auth-form"><h2>Sign in</h2><p>Use your company account to continue.</p><label>Username<input type="text" id="login-username" placeholder="Username" required autocomplete="username" /></label><label>Password<input id="login-password" type="password" placeholder="Password" required autocomplete="current-password" /></label><p class="auth-error" role="alert" hidden>Invalid username or password.</p><div class="role-picker">${Object.entries(roles).map(([key, role]) => `<button type="button" data-role="${key}" class="${key===chosenRole?'selected':''}"><strong>${role.label}</strong>${role.description}</button>`).join('')}</div><button class="primary auth-signin" type="submit">Sign in</button><p class="auth-note">Demo login only. Supabase Auth will replace this screen with secure authentication and server-enforced permissions.</p></form></section>`;
    root.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => { chosenRole = button.dataset.role; render(); }));
    root.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      const username = root.querySelector('#login-username').value.trim();
      const password = root.querySelector('#login-password').value;
      const error = root.querySelector('.auth-error');
      if (username !== 'Admin' || password !== '123456789') { error.hidden = false; return; }
      const session = { username, role: chosenRole };
      sessionStorage.setItem('flightb2b-demo-session', JSON.stringify(session));
      applyRole(session);
    });
  };
  if (validStoredSession) applyRole(stored); else render();
})();
