(() => {
  const byId = id => document.querySelector(id);
  const session = () => JSON.parse(sessionStorage.getItem('flightb2b-session') || '{}');
  const isOfficeManager = () => session().profile?.role === 'office_manager';
  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const toast = message => { const element = byId('#toast'); element.textContent = message; element.classList.add('show'); setTimeout(() => element.classList.remove('show'), 2800); };
  const api = async (path, options = {}) => {
    const response = await fetch(path, { ...options, headers: { authorization: `Bearer ${session().accessToken}`, 'content-type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  };
  let access = { agency: null, branches: [], profiles: [] };
  const branchName = id => access.branches.find(branch => branch.id === id)?.name || 'Main office';
  const modal = () => { let element = byId('#team-modal'); if (!element) { element = document.createElement('dialog'); element.id = 'team-modal'; document.body.append(element); } return element; };
  const branchOptions = selected => `<option value="">Main office</option>${access.branches.map(branch => `<option value="${branch.id}" ${branch.id === selected ? 'selected' : ''}>${escape(branch.name)}</option>`).join('')}`;
  const render = () => {
    if (!byId('#team-user-list')) return;
    byId('#team-agency-name').textContent = access.agency ? `${access.agency.name} · only this agency is visible to you.` : 'Agency access unavailable.';
    byId('#team-user-list').innerHTML = access.profiles.map(user => `<tr><td><strong>${escape(user.full_name)}</strong></td><td>${user.role === 'office_manager' ? 'Office manager' : 'Ticketing agent'}</td><td>${escape(branchName(user.branch_id))}</td><td><span class="tag ${user.active ? 'ticketed' : 'pending'}">${user.active ? 'Active' : 'Inactive'}</span></td><td>${user.role === 'agent' ? `<button class="text-btn team-edit" data-user-id="${user.id}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="no-bookings">No users found.</td></tr>';
  };
  const load = async () => { if (!isOfficeManager()) return; try { access = await api('/api/office/users'); render(); } catch (error) { toast(error.message); } };
  const openCreate = () => {
    const element = modal();
    element.innerHTML = `<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">NEW TICKETING AGENT</p><h2>Create agent access</h2><p>This account is automatically assigned to ${escape(access.agency?.name || 'your agency')}.</p><label>Full name<input name="fullName" required /></label><label>Email address<input name="email" type="email" required /></label><label>Temporary password<input name="password" type="password" minlength="8" required /></label><label>Office<select name="branchId">${branchOptions()}</select></label><p class="admin-form-error" hidden></p><button class="primary full">Create ticketing agent</button></form>`;
    element.showModal(); element.querySelector('.close').onclick = () => element.close();
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; const error = form.querySelector('.admin-form-error'); const submit = form.querySelector('.primary'); submit.disabled = true; try { await api('/api/office/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); element.close(); await load(); toast('Ticketing agent created. Share the temporary password securely.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; submit.disabled = false; } };
  };
  const openEdit = id => {
    const user = access.profiles.find(item => item.id === id); if (!user) return;
    const element = modal();
    element.innerHTML = `<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">EDIT TICKETING AGENT</p><h2>${escape(user.full_name)}</h2><label>Full name<input name="fullName" value="${escape(user.full_name)}" required /></label><label>Office<select name="branchId">${branchOptions(user.branch_id)}</select></label><label class="check-label"><input name="active" type="checkbox" ${user.active ? 'checked' : ''} /> Account is active</label><p class="admin-form-error" hidden></p><button class="primary full">Save changes</button></form>`;
    element.showModal(); element.querySelector('.close').onclick = () => element.close();
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; const error = form.querySelector('.admin-form-error'); try { await api(`/api/office/users/${id}`, { method: 'PATCH', body: JSON.stringify({ fullName: new FormData(form).get('fullName'), branchId: new FormData(form).get('branchId'), active: form.elements.active.checked }) }); element.close(); await load(); toast('Ticketing agent updated.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; } };
  };
  const setup = () => { byId('#add-team-agent')?.addEventListener('click', openCreate); byId('#team-user-list')?.addEventListener('click', event => { const button = event.target.closest('.team-edit'); if (button) openEdit(button.dataset.userId); }); window.loadTeamAccess = load; load(); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', setup) : setup();
})();
