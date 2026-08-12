(() => {
  let overview = { agencies: [], branches: [], profiles: [], wallets: [] };
  const byId = id => document.querySelector(id);
  const session = () => JSON.parse(sessionStorage.getItem('flightb2b-session') || '{}');
  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const money = value => `¥ ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const notify = message => { const toast = byId('#toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); };
  const api = async (path, options = {}) => {
    const current = session();
    const response = await fetch(path, { ...options, headers: { authorization: `Bearer ${current.accessToken}`, 'content-type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
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
      return `<tr><td><strong>${escape(item.name)}</strong></td><td>${offices}</td><td>${users}</td><td><strong>${money(wallet(item.id)?.balance_cny)}</strong></td><td><span class="tag ${item.active ? 'ticketed' : 'pending'}">${item.active ? 'Active' : 'Inactive'}</span></td><td><button class="text-btn wallet-adjust" data-agency-id="${item.id}">Adjust balance</button></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="no-bookings">No agencies found.</td></tr>';
    byId('#user-list').innerHTML = overview.profiles.map(item => {
      const company = agency(item.agency_id)?.name || 'Platform';
      const office = branch(item.branch_id)?.name;
      const role = { agent: 'Ticketing agent', office_manager: 'Office manager', platform_admin: 'Platform administrator' }[item.role] || item.role;
      return `<tr><td><strong>${escape(item.full_name)}</strong></td><td>${escape(item.email || 'Login account')}</td><td>${escape(company)}${office ? ` · ${escape(office)}` : ''}</td><td>${role}</td><td><span class="tag ${item.active ? 'ticketed' : 'pending'}">${item.active ? 'Active' : 'Inactive'}</span></td><td></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="no-bookings">No users found.</td></tr>';
    const activeAgencies = overview.agencies.filter(item => item.active).length;
    const activeUsers = overview.profiles.filter(item => item.active).length;
    const total = overview.wallets.reduce((sum, item) => sum + Number(item.balance_cny || 0), 0);
    byId('#admin-agency-count').textContent = activeAgencies;
    byId('#admin-user-count').textContent = activeUsers;
    byId('#admin-network-balance').textContent = money(total);
  };
  const modal = () => {
    let element = byId('#admin-modal');
    if (!element) { element = document.createElement('dialog'); element.id = 'admin-modal'; document.body.append(element); }
    return element;
  };
  const closeModal = element => element.close();
  const openAgency = () => {
    const element = modal();
    element.innerHTML = `<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">NEW AGENCY</p><h2>Create agency account</h2><p>Creates an isolated wallet and booking workspace.</p><label>Agency name<input name="name" required placeholder="e.g. Airmarket Travel" /></label><label>Main office / branch<input name="branchName" placeholder="e.g. Main office" /></label><label>Opening balance (CNY)<input name="initialBalance" type="number" step="0.01" min="0" value="0" /></label><p class="admin-form-error" hidden></p><button class="primary full">Create agency</button></form>`;
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const submit = event.currentTarget.querySelector('.primary'); const error = event.currentTarget.querySelector('.admin-form-error'); submit.disabled = true; try { await api('/api/admin/agencies', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) }); closeModal(element); await load(); notify('Agency created.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; submit.disabled = false; } };
  };
  const openUser = () => {
    const element = modal();
    const options = overview.agencies.map(item => `<option value="${item.id}">${escape(item.name)}</option>`).join('');
    element.innerHTML = `<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">NEW USER</p><h2>Create user access</h2><p>The user can sign in immediately with this email and password.</p><label>Full name<input name="fullName" required /></label><label>Email address<input name="email" type="email" required /></label><label>Temporary password<input name="password" type="password" minlength="8" required /></label><label>Agency<select name="agencyId" required><option value="">Select agency</option>${options}</select></label><label>Role<select name="role" required><option value="agent">Ticketing agent</option><option value="office_manager">Office manager</option></select></label><p class="admin-form-error" hidden></p><button class="primary full">Create user</button></form>`;
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const submit = event.currentTarget.querySelector('.primary'); const error = event.currentTarget.querySelector('.admin-form-error'); submit.disabled = true; try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify(values) }); closeModal(element); await load(); notify('User account created. Share the temporary password securely.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; submit.disabled = false; } };
  };
  const openAdjustment = agencyId => {
    const target = agency(agencyId); const element = modal();
    element.innerHTML = `<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">WALLET ADJUSTMENT</p><h2>${escape(target?.name || 'Agency')}</h2><p>Use a positive amount to credit, negative amount to debit. This creates an immutable ledger record.</p><label>Amount (CNY)<input name="amount" type="number" step="0.01" required placeholder="e.g. 5000 or -500" /></label><label>Reason<input name="reason" required placeholder="e.g. Bank transfer received" /></label><p class="admin-form-error" hidden></p><button class="primary full">Save adjustment</button></form>`;
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const submit = event.currentTarget.querySelector('.primary'); const error = event.currentTarget.querySelector('.admin-form-error'); submit.disabled = true; try { await api('/api/admin/wallet-adjustments', { method: 'POST', body: JSON.stringify({ ...values, agencyId }) }); closeModal(element); await load(); notify('Wallet adjustment recorded.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; submit.disabled = false; } };
  };
  const load = async () => { try { overview = await api('/api/admin/overview'); render(byId('#agency-filter')?.value); } catch (error) { notify(error.message); } };
  const setup = () => {
    byId('#agency-filter')?.addEventListener('input', event => render(event.target.value));
    byId('#add-agency')?.addEventListener('click', openAgency);
    byId('#add-user')?.addEventListener('click', openUser);
    byId('#agency-list')?.addEventListener('click', event => { const button = event.target.closest('.wallet-adjust'); if (button) openAdjustment(button.dataset.agencyId); });
    load();
  };
  window.loadAdministration = load;
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', setup) : setup();
})();
