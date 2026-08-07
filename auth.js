(() => {
  const roles = {
    agent: { label: 'Ticketing agent', description: 'Search, book and issue tickets. View only your own bookings.' },
    office: { label: 'Office manager', description: 'View your agency or branch bookings, statistics and wallet balance.' },
    platform: { label: 'Platform admin', description: 'Manage every agency, user, booking and wallet adjustment.' }
  };
  const root = document.querySelector('#auth-root');
  const stored = sessionStorage.getItem('flightb2b-demo-session');
  let chosenRole = stored ? JSON.parse(stored).role : 'agent';
  const escape = value => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
  const applyRole = session => {
    root.hidden = true;
    document.body.classList.remove('role-agent','role-office','role-platform');
    document.body.classList.add(`role-${session.role}`);
    const old = document.querySelector('.session-role'); if (old) old.remove();
    const bar = document.createElement('div'); bar.className = 'session-role';
    bar.innerHTML = `<span>${escape(session.email.slice(0,1).toUpperCase())}</span><div><strong>${escape(roles[session.role].label)}</strong><br>${escape(session.email)}</div><button type="button">Sign out</button>`;
    bar.querySelector('button').addEventListener('click', () => { sessionStorage.removeItem('flightb2b-demo-session'); location.reload(); });
    document.body.append(bar);
  };
  const render = () => {
    root.innerHTML = `<section class="auth-card"><div class="auth-intro"><div class="auth-mark">F</div><h1>Flight B2B Portal</h1><p>Secure airline ticketing for agencies, offices and platform operations.</p><div class="auth-permissions"><div><strong>Agent</strong><br>Own bookings only</div><div><strong>Office manager</strong><br>Agency / branch control</div><div><strong>Platform admin</strong><br>All agencies and wallets</div></div></div><form class="auth-form"><h2>Sign in</h2><p>Use your company account to continue.</p><label>Email address<input type="email" id="login-email" placeholder="name@company.mn" required /></label><label>Password<input type="password" placeholder="Password" minlength="8" required /></label><div class="role-picker">${Object.entries(roles).map(([key, role]) => `<button type="button" data-role="${key}" class="${key===chosenRole?'selected':''}"><strong>${role.label}</strong>${role.description}</button>`).join('')}</div><button class="primary auth-signin" type="submit">Sign in</button><p class="auth-note">Demo login only. Supabase Auth will replace this screen with secure authentication and server-enforced permissions.</p></form></section>`;
    root.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => { chosenRole = button.dataset.role; render(); }));
    root.querySelector('form').addEventListener('submit', event => { event.preventDefault(); const email = root.querySelector('#login-email').value.trim(); const session = { email, role: chosenRole }; sessionStorage.setItem('flightb2b-demo-session', JSON.stringify(session)); applyRole(session); });
  };
  if (stored) applyRole(JSON.parse(stored)); else render();
})();
