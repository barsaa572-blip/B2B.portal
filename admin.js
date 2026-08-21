(() => {
  let overview = { agencies: [], branches: [], profiles: [], wallets: [], topups: [] };
  let fxRate = null;
  const byId = id => document.querySelector(id);
  const session = () => JSON.parse(sessionStorage.getItem('flightb2b-session') || '{}');
  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const cny = value => `¥ ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const mnt = value => `₮ ${Math.round(Number(value || 0)).toLocaleString('en-US')}`;
  const money = value => fxRate ? mnt(Number(value || 0) * Number(fxRate.effectiveRateMnt || 0)) : '—';
  const moneyWithCny = value => `${money(value)}<small class="currency-secondary">${cny(value)} CNY</small>`;
  const notify = message => { const toast = byId('#toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); };
  const api = async (path, options = {}) => {
    const request = () => { const current = session(); return fetch(path, { ...options, headers: { authorization: `Bearer ${current.accessToken}`, 'content-type': 'application/json', ...(options.headers || {}) } }); };
    let response = await request();
    if ((response.status === 401 || response.status === 403) && await window.refreshPortalSession?.()) response = await request();
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      window.forcePortalSignOut?.();
      throw new Error('__SESSION_EXPIRED__');
    }
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  };
  const agency = id => overview.agencies.find(item => item.id === id);
  const branch = id => overview.branches.find(item => item.id === id);
  const wallet = id => overview.wallets.find(item => item.agency_id === id);
  const render = query => {
    const term = String(query || '').trim().toLowerCase();
    const visible = overview.agencies.filter(item => item.name.toLowerCase().includes(term));
    byId('#agency-list').innerHTML = visible.map(item => {
      const offices = overview.branches.filter(entry => entry.agency_id === item.id).length;
      const users = overview.profiles.filter(entry => entry.agency_id === item.id).length;
      return `<tr><td><strong>${escape(item.name)}</strong></td><td>${offices}</td><td>${users}</td><td>${moneyWithCny(wallet(item.id)?.balance_cny)}</td><td><span class="tag ${item.active ? 'ticketed' : 'pending'}">${item.active ? 'Active' : 'Inactive'}</span></td><td class="admin-actions"><button class="text-btn agency-open" data-agency-id="${item.id}">Open</button><button class="text-btn agency-edit" data-agency-id="${item.id}">Edit</button><button class="text-btn agency-delete" data-agency-id="${item.id}">Delete</button></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="no-bookings">No agencies found.</td></tr>';
    byId('#user-list').innerHTML = overview.profiles.map(item => {
      const company = agency(item.agency_id)?.name || 'Platform';
      const office = branch(item.branch_id)?.name;
      const role = { agent: 'Ticketing agent', office_manager: 'Office manager', platform_admin: 'Platform administrator' }[item.role] || item.role;
      return `<tr><td><strong>${escape(item.full_name)}</strong></td><td>${escape(item.email || 'Login account')}</td><td>${escape(company)}${office ? ` · ${escape(office)}` : ''}</td><td>${role}</td><td><span class="tag ${item.active ? 'ticketed' : 'pending'}">${item.active ? 'Active' : 'Inactive'}</span></td><td class="admin-actions"><button class="text-btn user-edit" data-user-id="${item.id}">Edit</button><button class="text-btn user-delete" data-user-id="${item.id}">Delete</button></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="no-bookings">No users found.</td></tr>';
    const activeAgencies = overview.agencies.filter(item => item.active).length;
    const activeUsers = overview.profiles.filter(item => item.active).length;
    const total = overview.wallets.reduce((sum, item) => sum + Number(item.balance_cny || 0), 0);
    byId('#admin-agency-count').textContent = activeAgencies;
    byId('#admin-user-count').textContent = activeUsers;
    byId('#admin-network-balance').innerHTML = moneyWithCny(total);
    const topupTarget = byId('#admin-topups');
    if (topupTarget) topupTarget.innerHTML = (overview.topups || []).map(item => {
      const company = agency(item.agency_id)?.name || 'Agency';
      const status = String(item.status || 'pending');
      return `<tr><td><strong>${escape(item.invoice_number)}</strong></td><td>${escape(company)}</td><td><strong>${mnt(item.amount_mnt)}</strong><small class="currency-secondary">${cny(item.amount_cny)} CNY wallet credit</small></td><td><strong>${mnt(item.total_mnt)}</strong></td><td><span class="tag ${status === 'approved' ? 'ticketed' : status === 'cancelled' ? 'cancelled' : 'pending'}">${escape(status)}</span></td><td>${status === 'pending' ? `<button class="primary topup-approve" data-topup-id="${item.id}">Approve</button>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="no-bookings">No top-up invoices yet.</td></tr>';
    topupTarget.querySelectorAll('.topup-approve').forEach(button => button.insertAdjacentHTML('afterend', `<button class="secondary topup-delete" data-topup-id="${button.dataset.topupId}">Delete</button>`));
  };
  const modal = () => {
    let element = byId('#admin-modal');
    if (!element) { element = document.createElement('dialog'); element.id = 'admin-modal'; document.body.append(element); }
    return element;
  };
  const closeModal = element => element.close();
  const openAgency = () => {
    const element = modal();
    element.innerHTML = `<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">NEW AGENCY</p><h2>Create agency account</h2><p>Creates an isolated wallet and booking workspace.</p><label>Agency name<input name="name" required placeholder="e.g. Airmarket Travel" /></label><label>Main office / branch<input name="branchName" placeholder="e.g. Main office" /></label><label>Opening balance (MNT)<input name="initialBalanceMnt" type="number" step="1" min="0" value="0" /></label><p class="admin-form-error" hidden></p><button class="primary full">Create agency</button></form>`;
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const submit = event.currentTarget.querySelector('.primary'); const error = event.currentTarget.querySelector('.admin-form-error'); submit.disabled = true; try { await api('/api/admin/agencies', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }); closeModal(element); await load(); notify('Agency created.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; submit.disabled = false; } };
  };
  const openUser = () => {
    const element = modal();
    const options = overview.agencies.map(item => `<option value="${item.id}">${escape(item.name)}</option>`).join('');
    element.innerHTML = `<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">NEW OFFICE MANAGER</p><h2>Create manager access</h2><p>The manager can sign in and create ticketing agents for their own agency.</p><label>Full name<input name="fullName" required /></label><label>Email address<input name="email" type="email" required /></label><label>Temporary password<input name="password" type="password" minlength="8" required /></label><label>Agency<select name="agencyId" required><option value="">Select agency</option>${options}</select></label><input name="role" type="hidden" value="office_manager" /><p class="admin-form-error" hidden></p><button class="primary full">Create office manager</button></form>`;
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const submit = event.currentTarget.querySelector('.primary'); const error = event.currentTarget.querySelector('.admin-form-error'); submit.disabled = true; try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify(values) }); closeModal(element); await load(); notify('User account created. Share the temporary password securely.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; submit.disabled = false; } };
  };
  const openAdjustment = agencyId => {
    const target = agency(agencyId); const element = modal();
    element.innerHTML = `<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">WALLET ADJUSTMENT</p><h2>${escape(target?.name || 'Agency')}</h2><p>Use a positive amount to credit, negative amount to debit. This creates an immutable ledger record.</p><label>Amount (CNY)<input name="amount" type="number" step="0.01" required placeholder="e.g. 5000 or -500" /></label><label>Reason<input name="reason" required placeholder="e.g. Bank transfer received" /></label><p class="admin-form-error" hidden></p><button class="primary full">Save adjustment</button></form>`;
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const submit = event.currentTarget.querySelector('.primary'); const error = event.currentTarget.querySelector('.admin-form-error'); submit.disabled = true; try { await api('/api/admin/wallet-adjustments', { method: 'POST', body: JSON.stringify({ ...values, agencyId }) }); closeModal(element); await load(); notify('Wallet adjustment recorded.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; submit.disabled = false; } };
  };
  const openEditAgency = agencyId => {
    const item = agency(agencyId); const element = modal();
    element.innerHTML = `<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">EDIT AGENCY</p><h2>${escape(item.name)}</h2><label>Agency name<input name="name" required value="${escape(item.name)}" /></label><label class="check-label"><input name="active" type="checkbox" ${item.active ? 'checked' : ''} /> Agency is active and can issue tickets</label><p class="admin-form-error" hidden></p><button class="primary full">Save changes</button></form>`;
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; const error = form.querySelector('.admin-form-error'); try { await api(`/api/admin/agencies/${agencyId}`, { method: 'PATCH', body: JSON.stringify({ name: new FormData(form).get('name'), active: form.elements.active.checked }) }); closeModal(element); await load(); notify('Agency updated.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; } };
  };
  const openAgencyAccess = agencyId => {
    const item = agency(agencyId); const element = modal();
    const users = overview.profiles.filter(profile => profile.agency_id === agencyId);
    const offices = overview.branches.filter(branch => branch.agency_id === agencyId);
    const officeName = id => offices.find(office => office.id === id)?.name || 'Main office';
    element.innerHTML = `<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">AGENCY ACCESS</p><h2>${escape(item?.name || 'Agency')}</h2><p>${users.length} user account(s). Office managers create ticketing agents within this agency.</p><div class="agency-access-list">${users.map(user => `<div><strong>${escape(user.full_name)}</strong><span>${user.role === 'office_manager' ? 'Office manager' : user.role === 'agent' ? 'Ticketing agent' : 'Platform administrator'} · ${escape(officeName(user.branch_id))}</span><b class="tag ${user.active ? 'ticketed' : 'pending'}">${user.active ? 'Active' : 'Inactive'}</b></div>`).join('') || '<p>No users have been assigned yet.</p>'}</div><button type="button" class="secondary full close-agency-access">Close</button></form>`;
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element); element.querySelector('.close-agency-access').onclick = () => closeModal(element);
  };
  const openEditUser = userId => {
    const item = overview.profiles.find(entry => entry.id === userId); const element = modal();
    const agencyOptions = overview.agencies.map(entry => `<option value="${entry.id}" ${entry.id === item.agency_id ? 'selected' : ''}>${escape(entry.name)}</option>`).join('');
    element.innerHTML = `<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">EDIT USER</p><h2>${escape(item.full_name)}</h2><label>Full name<input name="fullName" required value="${escape(item.full_name)}" /></label><label>Agency<select name="agencyId"><option value="">Platform / no agency</option>${agencyOptions}</select></label><label>Role<select name="role"><option value="agent" ${item.role === 'agent' ? 'selected' : ''}>Ticketing agent</option><option value="office_manager" ${item.role === 'office_manager' ? 'selected' : ''}>Office manager</option><option value="platform_admin" ${item.role === 'platform_admin' ? 'selected' : ''}>Platform administrator</option></select></label><label class="check-label"><input name="active" type="checkbox" ${item.active ? 'checked' : ''} /> Account is active</label><p class="admin-form-error" hidden></p><button class="primary full">Save changes</button></form>`;
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; const error = form.querySelector('.admin-form-error'); try { await api(`/api/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ fullName: new FormData(form).get('fullName'), agencyId: new FormData(form).get('agencyId'), role: new FormData(form).get('role'), active: form.elements.active.checked }) }); closeModal(element); await load(); notify('User updated.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; } };
  };
  const remove = async (type, id) => {
    const name = type === 'agencies' ? agency(id)?.name : overview.profiles.find(item => item.id === id)?.full_name;
    if (!confirm(`Delete ${name}? If it has booking or financial history, the system will require deactivation instead.`)) return;
    try { await api(`/api/admin/${type}/${id}`, { method: 'DELETE' }); await load(); notify(`${type === 'agencies' ? 'Agency' : 'User'} deleted.`); } catch (issue) { notify(issue.message); }
  };
  const load = async () => { try { const [nextOverview, rateResponse] = await Promise.all([api('/api/admin/overview'), fetch('/api/fx/cny-mnt')]); overview = nextOverview; if (rateResponse.ok) fxRate = await rateResponse.json(); render(byId('#agency-filter')?.value); } catch (error) { notify(error.message); } };
  const setup = () => {
    byId('#agency-filter')?.addEventListener('input', event => render(event.target.value));
    byId('#add-agency')?.addEventListener('click', openAgency);
    byId('#clear-wallets')?.addEventListener('click', async event => {
      const confirmation = window.prompt('This will set every agency wallet balance to 0 and permanently delete all wallet ledger history. Type RESET WALLETS to continue.');
      if (confirmation === null) return;
      if (confirmation !== 'RESET WALLETS') return notify('Wallet reset cancelled: confirmation text did not match.');
      event.currentTarget.disabled = true;
      try {
        await api('/api/admin/wallet-reset', { method: 'POST', body: JSON.stringify({ confirmation }) });
        await load();
        notify('All wallet balances and wallet ledger history have been cleared.');
      } catch (issue) {
        notify(issue.message || 'Unable to clear wallet data.');
      } finally {
        event.currentTarget.disabled = false;
      }
    });
    byId('#add-user')?.addEventListener('click', openUser);
    byId('#agency-list')?.addEventListener('click', event => { const button = event.target.closest('[data-agency-id]'); if (!button) return; if (button.classList.contains('agency-open')) openAgencyAccess(button.dataset.agencyId); if (button.classList.contains('wallet-adjust')) openAdjustment(button.dataset.agencyId); if (button.classList.contains('agency-edit')) openEditAgency(button.dataset.agencyId); if (button.classList.contains('agency-delete')) remove('agencies', button.dataset.agencyId); });
    byId('#admin-topups')?.addEventListener('click', async event => { const approve = event.target.closest('.topup-approve'); const remove = event.target.closest('.topup-delete'); const button = approve || remove; if (!button) return; const deleting = Boolean(remove); if (!confirm(deleting ? 'Delete this pending invoice? This cannot be undone.' : 'Approve this invoice and credit the agency wallet?')) return; button.disabled = true; try { if (deleting) await api(`/api/topups/${button.dataset.topupId}`, { method: 'DELETE' }); else await api(`/api/admin/topups/${button.dataset.topupId}/approve`, { method: 'POST' }); await load(); notify(deleting ? 'Pending invoice deleted.' : 'Invoice approved and wallet credited.'); } catch (issue) { button.disabled = false; notify(issue.message); } });
    byId('#user-list')?.addEventListener('click', event => { const button = event.target.closest('[data-user-id]'); if (!button) return; if (button.classList.contains('user-edit')) openEditUser(button.dataset.userId); if (button.classList.contains('user-delete')) remove('users', button.dataset.userId); });
    load();
    setInterval(() => { if (document.visibilityState === 'visible' && session().accessToken) load(); }, 5000);
  };
  window.loadAdministration = load;
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', setup) : setup();
})();
