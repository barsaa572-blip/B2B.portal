(() => {
  let overview = { agencies: [], branches: [], profiles: [], wallets: [], topups: [] };
  let fxRate = null;
  const byId = id => document.querySelector(id);
  const session = () => JSON.parse(sessionStorage.getItem('flightb2b-session') || '{}');
  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const cny = value => `¥ ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const mnt = value => `₮ ${Math.round(Number(value || 0)).toLocaleString('en-US')}`;
  const money = value => globalThis.PortalMoney ? PortalMoney.markupCny(Number(Number(value || 0).toFixed(2)), {rate:fxRate?.effectiveRateMnt}) : fxRate ? mnt(Number(value || 0) * Number(fxRate.effectiveRateMnt || 0)) : '—';
  const moneyWithCny = value => `${money(value)}<small class="currency-secondary">${cny(value)} CNY</small>`;
  const notify = (message, duration = 2800) => { const toast = byId('#toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), duration); };
  const api = async (path, options = {}) => {
    const request = () => { const current = session(); return fetch(path, { ...options, headers: { authorization: `Bearer ${current.accessToken}`, 'content-type': 'application/json', ...(options.headers || {}) } }); };
    let response = await request();
    if (response.status === 401 && await window.refreshPortalSession?.()) response = await request();
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.forcePortalSignOut?.();
      throw new Error('__SESSION_EXPIRED__');
    }
    if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), {code:data.code});
    return data;
  };
  const agency = id => overview.agencies.find(item => item.id === id);
  const branch = id => overview.branches.find(item => item.id === id);
  const wallet = id => overview.wallets.find(item => item.agency_id === id);
  const render = query => {
    const term = String(query || '').trim().toLowerCase();
    const visible = overview.agencies.filter(item => item.name.toLowerCase().includes(term));
    byId('#agency-list').innerHTML = safeHtml(visible.map(item => {
      const offices = overview.branches.filter(entry => entry.agency_id === item.id).length;
      const users = overview.profiles.filter(entry => entry.agency_id === item.id).length;
      return `<tr><td><strong>${escape(item.name)}</strong></td><td>${offices}</td><td>${users}</td><td>${moneyWithCny(wallet(item.id)?.balance_cny)}</td><td><span class="tag ${item.active ? 'ticketed' : 'pending'}">${item.active ? 'Active' : 'Inactive'}</span></td><td class="admin-actions"><div class="admin-action-group"><button class="text-btn agency-open" data-agency-id="${item.id}">Open</button><button class="text-btn agency-edit" data-agency-id="${item.id}">Edit</button><button class="text-btn agency-status" data-agency-id="${item.id}" role="switch" aria-checked="${Boolean(item.active)}">${item.active ? 'Deactivate' : 'Activate'}</button><button class="text-btn agency-delete" data-agency-id="${item.id}">Delete</button></div></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="no-bookings">No agencies found.</td></tr>');
    byId('#user-list').innerHTML = safeHtml(overview.profiles.map(item => {
      const company = agency(item.agency_id)?.name || 'Platform';
      const office = branch(item.branch_id)?.name;
      const role = { agent: 'Ticketing agent', office_manager: 'Office manager', platform_admin: 'Platform administrator' }[item.role] || item.role;
      return `<tr><td><strong>${escape(item.full_name)}</strong></td><td>${escape(item.email || 'Login account')}</td><td>${escape(company)}${office ? ` · ${escape(office)}` : ''}</td><td>${escape(role)}</td><td><span class="tag ${item.active ? 'ticketed' : 'pending'}">${item.active ? 'Active' : 'Inactive'}</span></td><td class="admin-actions"><div class="admin-action-group"><button class="text-btn user-edit" data-user-id="${item.id}">Edit</button>${item.role === 'platform_admin' ? '' : `<button class="text-btn user-invite" data-user-id="${item.id}" title="Resend a pending invitation; unconfirmed accounts only">Resend invite</button>`}<button class="text-btn user-delete" data-user-id="${item.id}">Delete</button></div></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="no-bookings">No users found.</td></tr>');
    const activeAgencies = overview.agencies.filter(item => item.active).length;
    const activeUsers = overview.profiles.filter(item => item.active).length;
    const total = overview.wallets.reduce((sum, item) => sum + Number(item.balance_cny || 0), 0);
    byId('#admin-agency-count').textContent = activeAgencies;
    byId('#admin-user-count').textContent = activeUsers;
    for (const [id, key] of [['admin-total-sales', 'ticketSalesCny'], ['admin-total-topups', 'topupsCny'], ['admin-total-changes', 'changePaymentsCny']]) {
      const target = byId(`#${id}`);
      if (target) target.innerHTML = safeHtml(overview.statistics ? moneyWithCny(overview.statistics[key]) : '—');
    }
    byId('#admin-network-balance').innerHTML = safeHtml(moneyWithCny(total));
    const topupTarget = byId('#admin-topups');
    const expanded = new Set([...topupTarget?.querySelectorAll('details[open]') || []].map(node => node.dataset.topupId));
    if (topupTarget) topupTarget.innerHTML = safeHtml((overview.topups || []).map(item => {
      const company = agency(item.agency_id)?.name || 'Agency';
      const status = String(item.status || 'pending');
      const q = item.pricing_model === 'cny-funding-v1' ? item.funding_quote : null;
      const breakdown = q ? `<tr class="funding-detail-row"><td colspan="6"><details class="funding-breakdown" data-topup-id="${escape(item.id)}" ${expanded.has(item.id) ? 'open' : ''}><summary>Funding breakdown · ${escape(item.invoice_number)}</summary><dl class="funding-detail-grid"><div><dt>Wallet / supplier principal</dt><dd>${cny(q.principalCny)} CNY</dd></div><div><dt>Service fee (3%, non-refundable)</dt><dd>${cny(q.serviceFeeCny)} CNY</dd></div><div><dt>Correspondent fee (OUR)</dt><dd>${cny(q.correspondentFeeCny)} CNY</dd></div><div><dt>Bank fee allowance</dt><dd>${cny(q.bankFeeCny)} CNY <small>Tariff ${mnt(q.bankTariffMnt)}</small></dd></div><div class="funding-detail-total"><dt>Total bank receipt</dt><dd>${cny(q.totalCny)} CNY</dd></div></dl><div class="funding-detail-note"><span>Saved Golomt sell rate: ${escape(q.rateMnt)} · ${escape(q.rateDate)}</span><span>${status === 'approved' ? 'Receipt verified; principal credited.' : 'Quote only; not received income.'}</span></div></details></td></tr>` : '';
      return `<tr class="funding-invoice-row"><td><strong>${escape(item.invoice_number)}</strong></td><td>${escape(company)}</td><td><div class="admin-money-stack"><strong>${mnt(item.amount_mnt)}</strong><small>${cny(item.amount_cny)} CNY wallet credit</small></div></td><td><div class="admin-money-stack"><strong>${mnt(item.total_mnt)}</strong>${q ? `<small>${cny(q.totalCny)} CNY to transfer</small>` : ''}</div></td><td><span class="tag ${status === 'approved' ? 'ticketed' : status === 'cancelled' ? 'cancelled' : 'pending'}">${escape(status)}</span></td><td class="admin-actions"><div class="admin-action-group">${status === 'pending' ? `<button class="primary topup-approve" data-topup-id="${escape(item.id)}">Approve</button><button class="secondary topup-delete" data-topup-id="${escape(item.id)}">Delete</button>` : ''}</div></td></tr>${breakdown}`;
    }).join('') || '<tr><td colspan="6" class="no-bookings">No top-up invoices yet.</td></tr>');
  };
  const modal = () => {
    let element = byId('#admin-modal');
    if (!element) { element = document.createElement('dialog'); element.id = 'admin-modal'; document.body.append(element); }
    element.oncancel = null;
    element.removeAttribute('aria-labelledby');
    return element;
  };
  const closeModal = element => element.close();
  const openTopupApproval = invoice => {
    if (byId('#admin-modal')?.open) return;
    const isCny = invoice.pricing_model === 'cny-funding-v1';
    const total = invoice.funding_quote?.totalCny;
    if (isCny && (!Number.isFinite(total) || total <= 0)) { notify('Нэхэмжлэлийн баталгаат нийт дүн олдсонгүй. Жагсаалтыг шинэчилнэ үү.', 7000); return; }
    const actorId = session().profile?.id;
    const element = modal();
    element.setAttribute('aria-labelledby', 'topup-approval-title');
    element.innerHTML = safeHtml(`<form class="admin-form topup-approval-form"><button type="button" class="close" aria-label="Close">×</button><p class="eyebrow">BANK RECEIPT</p><h2 id="topup-approval-title">Approve top-up</h2><p>${escape(invoice.invoice_number)} · ${escape(agency(invoice.agency_id)?.name || 'Agency')}</p><dl class="approval-summary"><div><dt>Wallet-д орох үндсэн дүн</dt><dd>${cny(invoice.amount_cny)} CNY</dd></div>${isCny ? `<div><dt>Банканд орсон байх нийт дүн</dt><dd>${cny(total)} CNY</dd></div>` : ''}</dl>${isCny ? `<label>Банкны гүйлгээний дугаар<input name="bankReference" required minlength="5" maxlength="200" autocomplete="off" placeholder="Бодит орлогын гүйлгээний дугаар" /></label><label>Банканд бодитоор орсон NET дүн (CNY)<input name="receivedCny" required inputmode="decimal" autocomplete="off" placeholder="${escape(cny(total).slice(2))}" /></label>` : ''}<p class="approval-attestation">Батлахдаа банкны орлогыг тулгасан гэдгээ зөвшөөрнө. Зөвхөн үндсэн дүн wallet-д орно.</p><p class="admin-form-error" role="alert" hidden></p><div class="approval-actions"><button type="button" class="secondary approval-cancel">Cancel</button><button type="submit" class="primary">Confirm approval</button></div></form>`);
    const form = element.querySelector('form'), error = form.querySelector('.admin-form-error');
    let busy = false;
    const cancel = () => { if (!busy) element.close(); };
    element.querySelector('.close').onclick = cancel;
    element.querySelector('.approval-cancel').onclick = cancel;
    element.oncancel = event => { if (busy) event.preventDefault(); };
    const amount = form.querySelector('[name="receivedCny"]');
    amount?.addEventListener('input', () => {
      const formatted = PortalMoney.formatCnyInput(amount.value, amount.selectionStart ?? amount.value.length);
      amount.value = formatted.value;
      amount.setSelectionRange(formatted.caret, formatted.caret);
    });
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      error.hidden = true;
      let receipt = {};
      try {
        if (!isPlatformAdmin() || session().profile?.id !== actorId) throw new Error('Дахин нэвтэрч банкны орлогыг шалгана уу.');
        if (isCny) {
          const values = new FormData(form), reference = String(values.get('bankReference') || '').trim();
          if (reference.length < 5 || reference.length > 200 || /[<>\u0000-\u001f\u007f]/.test(reference)) throw new Error('Банкны гүйлгээний дугаар 5–200 тэмдэгттэй байх ёстой.');
          receipt = {confirmed:true, bankReference:reference, receivedCny:PortalMoney.normalizeCnyInput(values.get('receivedCny'))};
          if (PortalMoney.integer(receipt.receivedCny, 2, 'receipt') !== PortalMoney.integer(total, 2, 'invoice total')) throw new Error(`Орсон дүн нэхэмжлэлийн нийт ${cny(total)} CNY-тэй таарахгүй байна. Банкны орлогыг тулгана уу; wallet үндсэн дүнг оруулахгүй.`);
        }
        busy = true;
        form.querySelectorAll('button,input').forEach(control => control.disabled = true);
        await api(`/api/admin/topups/${encodeURIComponent(invoice.id)}/approve`, {method:'POST', body:JSON.stringify(receipt)});
        element.close();
        await load(); notify('Invoice approved and wallet credited.');
      } catch (issue) {
        error.textContent = issue.message + (/^TOPUP_[A-Z_]+$/.test(issue.code || '') ? ` (${issue.code})` : '');
        error.hidden = false;
      } finally {
        busy = false;
        form.querySelectorAll('button,input').forEach(control => control.disabled = false);
      }
    };
    element.showModal();
  };
  const openAgency = () => {
    const element = modal();
    element.innerHTML = safeHtml(`<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">NEW AGENCY</p><h2>Create agency account</h2><p>Creates an isolated wallet and booking workspace.</p><label>Agency name<input name="agencyName" required /></label><label>Registration number<input name="registrationNumber" required /></label><label>Email address<input name="email" type="email" required /></label><label>Contact phone<input name="phone" type="tel" required /></label><label>Office address<input name="address" required /></label><label>Opening balance (MNT)<input name="initialBalanceMnt" type="number" step="1" min="0" value="0" /></label><p class="admin-form-error" hidden></p><button class="primary full">Create agency</button></form>`);
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const { agencyName, ...values } = Object.fromEntries(new FormData(event.currentTarget)); const submit = event.currentTarget.querySelector('.primary'); const error = event.currentTarget.querySelector('.admin-form-error'); submit.disabled = true; try { await api('/api/admin/agencies', { method: 'POST', body: JSON.stringify({ ...values, name: agencyName }) }); closeModal(element); await load(); notify('Agency created.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; submit.disabled = false; } };
  };
  const openUser = () => {
    const element = modal();
    const options = overview.agencies.map(item => `<option value="${item.id}">${escape(item.name)}</option>`).join('');
    element.innerHTML = safeHtml(`<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">NEW OFFICE MANAGER</p><h2>Create manager access</h2><p>The manager can sign in and create ticketing agents for their own agency.</p><label>Full name (surname and given name)<input name="fullName" required /></label><label>Phone number<input name="phone" type="tel" required /></label><label>Email address<input name="email" type="email" required /></label><label>Agency<select name="agencyId" required><option value="">Select agency</option>${options}</select></label><input name="accountRole" type="hidden" value="office_manager" /><p class="admin-form-error" hidden></p><button class="primary full">Create office manager</button></form>`);
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const { accountRole, ...values } = Object.fromEntries(new FormData(event.currentTarget)); const submit = event.currentTarget.querySelector('.primary'); const error = event.currentTarget.querySelector('.admin-form-error'); submit.disabled = true; try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ ...values, role: accountRole }) }); closeModal(element); await load(); notify('Invitation sent. The user must confirm their email and create a password.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; submit.disabled = false; } };
  };
  const openAdjustment = agencyId => {
    const target = agency(agencyId); const element = modal();
    element.innerHTML = safeHtml(`<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">WALLET ADJUSTMENT</p><h2>${escape(target?.name || 'Agency')}</h2><p>Use a positive amount to credit, negative amount to debit. This creates an immutable ledger record.</p><label>Amount (CNY)<input name="amount" type="number" step="0.01" required placeholder="e.g. 5000 or -500" /></label><label>Reason<input name="reason" required placeholder="e.g. Bank transfer received" /></label><p class="admin-form-error" hidden></p><button class="primary full">Save adjustment</button></form>`);
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const submit = event.currentTarget.querySelector('.primary'); const error = event.currentTarget.querySelector('.admin-form-error'); submit.disabled = true; try { await api('/api/admin/wallet-adjustments', { method: 'POST', body: JSON.stringify({ ...values, agencyId }) }); closeModal(element); await load(); notify('Wallet adjustment recorded.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; submit.disabled = false; } };
  };
  const openEditAgency = agencyId => {
    const item = agency(agencyId); const element = modal();
    element.innerHTML = safeHtml(`<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">EDIT AGENCY</p><h2>${escape(item.name)}</h2><label>Agency name<input name="agencyName" required value="${escape(item.name)}" /></label><label>Registration number<input name="registrationNumber" required value="${escape(item.registration_number || '')}" /></label><label>Email address<input name="email" type="email" required value="${escape(item.email || '')}" /></label><label>Contact phone<input name="phone" type="tel" required value="${escape(item.phone || '')}" /></label><label>Office address<input name="address" required value="${escape(item.address || '')}" /></label><label class="check-label"><input name="active" type="checkbox" ${item.active ? 'checked' : ''} /> Agency is active and can issue tickets</label><p class="admin-form-error" hidden></p><button class="primary full">Save changes</button></form>`);
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; const error = form.querySelector('.admin-form-error'); const values = new FormData(form); try { await api(`/api/admin/agencies/${agencyId}`, { method: 'PATCH', body: JSON.stringify({ name: values.get('agencyName'), registrationNumber: values.get('registrationNumber'), email: values.get('email'), phone: values.get('phone'), address: values.get('address'), active: form.elements.active.checked }) }); closeModal(element); await load(); notify('Agency updated.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; } };
  };
  const openAgencyAccess = agencyId => {
    const item = agency(agencyId); const element = modal();
    const users = overview.profiles.filter(profile => profile.agency_id === agencyId);
    const offices = overview.branches.filter(branch => branch.agency_id === agencyId);
    const officeName = id => offices.find(office => office.id === id)?.name || 'Main office';
    element.innerHTML = safeHtml(`<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">AGENCY ACCESS</p><h2>${escape(item?.name || 'Agency')}</h2><p>${users.length} user account(s). Office managers create ticketing agents within this agency.</p><div class="agency-access-list">${users.map(user => `<div><strong>${escape(user.full_name)}</strong><span>${user.role === 'office_manager' ? 'Office manager' : user.role === 'agent' ? 'Ticketing agent' : 'Platform administrator'} · ${escape(officeName(user.branch_id))}</span><b class="tag ${user.active ? 'ticketed' : 'pending'}">${user.active ? 'Active' : 'Inactive'}</b></div>`).join('') || '<p>No users have been assigned yet.</p>'}</div><button type="button" class="secondary full close-agency-access">Close</button></form>`);
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element); element.querySelector('.close-agency-access').onclick = () => closeModal(element);
  };
  const resendInvite = async button => {
    if (!confirm('Resend the email invitation? This works only for unconfirmed accounts.')) return;
    button.disabled = true;
    try { await api(`/api/admin/users/${button.dataset.userId}/invite`, { method: 'POST', body: '{}' }); notify('Invitation sent. Use the newest email link.'); }
    catch (error) { notify(error.message); } finally { button.disabled = false; }
  };
  const openEditUser = userId => {
    const item = overview.profiles.find(entry => entry.id === userId); const element = modal();
    const agencyOptions = overview.agencies.map(entry => `<option value="${entry.id}" ${entry.id === item.agency_id ? 'selected' : ''}>${escape(entry.name)}</option>`).join('');
    element.innerHTML = safeHtml(`<form class="admin-form"><button type="button" class="close">×</button><p class="eyebrow">EDIT USER</p><h2>${escape(item.full_name)}</h2><label>Full name<input name="fullName" required value="${escape(item.full_name)}" /></label><label>Email address<input type="email" value="${escape(item.email)}" readonly /></label><label>Phone number<input name="phone" type="tel" value="${escape(item.phone)}" required /></label><label>Agency<select name="agencyId"><option value="">Platform / no agency</option>${agencyOptions}</select></label><label>Role<select name="accountRole"><option value="agent" ${item.role === 'agent' ? 'selected' : ''}>Ticketing agent</option><option value="office_manager" ${item.role === 'office_manager' ? 'selected' : ''}>Office manager</option><option value="platform_admin" ${item.role === 'platform_admin' ? 'selected' : ''}>Platform administrator</option></select></label><label class="check-label"><input name="active" type="checkbox" ${item.active ? 'checked' : ''} /> Account is active</label><p class="admin-form-error" hidden></p><button class="primary full">Save changes</button></form>`);
    element.showModal(); element.querySelector('.close').onclick = () => closeModal(element);
    element.querySelector('form').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; const error = form.querySelector('.admin-form-error'); try { await api(`/api/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ fullName: new FormData(form).get('fullName'), phone: new FormData(form).get('phone'), agencyId: new FormData(form).get('agencyId'), role: new FormData(form).get('accountRole'), active: form.elements.active.checked }) }); closeModal(element); await load(); notify('User updated.'); } catch (issue) { error.textContent = issue.message; error.hidden = false; } };
  };
  const remove = async (type, id) => {
    const name = type === 'agencies' ? agency(id)?.name : overview.profiles.find(item => item.id === id)?.full_name;
    if (!confirm(`Delete ${name}? If it has booking or financial history, the system will require deactivation instead.`)) return;
    try { await api(`/api/admin/${type}/${id}`, { method: 'DELETE' }); await load(); notify(`${type === 'agencies' ? 'Agency' : 'User'} deleted.`); } catch (issue) { notify(issue.message); }
  };
  const isPlatformAdmin = () => {
    const current = session();
    return Boolean(current.accessToken && current.profile?.role === 'platform_admin');
  };
  const settlementAuditMarkup = (entries, pendingOnly = true) => {
    const visible = entries.map((entry, index) => ({entry, index})).filter(({entry}) => !pendingOnly || (entry.action === 'refund' && entry.state === 'awaiting_settlement'));
    if (!visible.length) return `<div class="settlement-empty"><strong>${pendingOnly ? 'Батлах буцаалт одоогоор алга' : 'Төлбөрийн бүртгэл одоогоор алга'}</strong><p>${pendingOnly ? 'Буцаалтын хүсэлт амжилттай илгээгдэж, орлого тулгах шатанд ороход энд гарна. Бүх тооцоог харах бол “Бүх бүртгэл”-ийг сонгоно уу.' : 'Тийз, өөрчлөлт эсвэл буцаалтын тооцоо үүсэхэд энд харагдана.'}</p></div>`;
    const actions = {issue:'Тийз гаргалт',change:'Өөрчлөлтийн төлбөр',refund:'Тийзний буцаалт'};
    return visible.map(({entry, index}) => {
      const refund = entry.action === 'refund', awaiting = refund && entry.state === 'awaiting_settlement';
      const state = entry.state === 'prepared' ? 'Үнийн тооцоо' : entry.state === 'settled' ? (refund ? 'Wallet-д буцаасан' : 'Төлбөр бүртгэгдсэн') : awaiting ? 'Орлого тулгах хүлээлттэй' : String(entry.state || 'Төлөв тодорхойгүй');
      const snapshot = entry.snapshot || {};
      const company = agency(entry.bookings?.agency_id)?.name || 'Агентлаг тодорхойгүй';
      return `<article class="settlement-record"><div class="settlement-record-head"><div><strong>${escape(entry.bookings?.pnr || entry.booking_id)}</strong><p>${escape(company)} · ${escape(actions[entry.action] || entry.action)}</p></div><span class="settlement-state ${awaiting ? 'is-pending' : entry.state === 'settled' ? 'is-settled' : ''}">${escape(state)}</span></div><dl class="settlement-amounts"><div><dt>${refund ? 'Агентын wallet-д буцаах дүн' : 'Агентын wallet-ээс төлөх дүн'}</dt><dd>${cny(snapshot.walletCny)} CNY</dd><small>MNT харуулах дүн: ${mnt(snapshot.amountMnt)}</small></div><div><dt>${refund ? 'Нийлүүлэгчээс буцаж орсон байх дүн' : 'Нийлүүлэгчийн төлбөр'}</dt><dd>${cny(snapshot.supplierCny)} CNY</dd><small>${refund ? 'Бодит орлогыг гүйлгээний баримттай тулгана.' : 'Энэ мөр нь нийлүүлэгчийн CNY дүн.'}</small></div></dl><details class="settlement-extra"><summary>Нэмэлт тооцоо</summary><p>Бүртгэлийн зөрүү: ${cny(snapshot.marginCny)} CNY · Лавлагаа: ${escape(entry.reference)}</p></details><div class="settlement-record-foot">${awaiting ? `<span>Мөнгө бодитоор буцаж орсон үед л батална.</span><button type="button" class="primary" data-settle-refund="${index}">Орлого тулгаж, wallet-д буцаах</button>` : `<span>${entry.state === 'prepared' ? 'Энэ нь зөвхөн тооцоо; мөнгө орсон эсвэл төлөгдсөн баталгаа биш.' : refund && entry.state === 'settled' ? 'Буцаалт бүртгэгдсэн. Дахин батлах шаардлагагүй.' : 'Энэ мөрөөс wallet-д мөнгө нэмэх үйлдэл хийхгүй.'}</span>`}</div></article>`;
    }).join('');
  };
  let loading = false;
  const load = async () => {
    if (!isPlatformAdmin() || loading) return;
    const token = session().accessToken;
    loading = true;
    try {
      const [nextOverview, rateResponse] = await Promise.all([api('/api/admin/overview'), fetch('/api/fx/cny-mnt')]);
      const nextRate = rateResponse.ok ? await rateResponse.json() : fxRate;
      if (!isPlatformAdmin() || session().accessToken !== token) return;
      overview = nextOverview;
      fxRate = nextRate;
      render(byId('#agency-filter')?.value);
    } catch (error) {
      if (isPlatformAdmin() && session().accessToken === token && error.message !== '__SESSION_EXPIRED__') notify(error.message);
    } finally { loading = false; }
  };
  const setup = () => {
    const accounting = document.createElement('button');
    accounting.type = 'button'; accounting.className = 'secondary admin-audit-button';
    accounting.textContent = 'Буцаалт ба төлбөрийн бүртгэл';
    byId('#administration')?.append(accounting);
    accounting.addEventListener('click', async () => {
      if (!isPlatformAdmin()) return;
      accounting.disabled = true;
      try {
        const data = await api('/api/admin/retail-pricing');
        if (!isPlatformAdmin() || byId('#admin-modal')?.open) return;
        const element = modal();
        element.setAttribute('aria-labelledby', 'settlement-audit-title');
        const entries = Array.isArray(data.entries) ? data.entries : [];
        const pending = entries.filter(entry => entry.action === 'refund' && entry.state === 'awaiting_settlement');
        const pendingAmount = pending.reduce((sum, entry) => sum + Number(entry.snapshot?.walletCny || 0), 0);
        element.innerHTML = safeHtml(`<section class="admin-form settlement-audit"><button class="close" type="button" aria-label="Close">×</button><p class="eyebrow">АДМИНЫ САНХҮҮГИЙН БҮРТГЭЛ</p><h2 id="settlement-audit-title">Буцаалт ба төлбөрийн бүртгэл</h2><p class="settlement-intro">Энд агентын wallet-д буцаалт оруулах болон төлбөрийн тооцоог хянана. Буцаалтыг нийлүүлэгчээс мөнгө бодитоор орсныг шалгасны дараа батална.</p><div class="settlement-summary"><div><span>Батлах буцаалт</span><strong data-audit-pending-count>${pending.length}</strong></div><div><span>Хүлээгдэж буй wallet буцаалт</span><strong data-audit-pending-amount>${cny(pendingAmount)} CNY</strong><small>Одоогоор wallet-д ороогүй дүн</small></div></div><div class="settlement-filters" role="group" aria-label="Бүртгэл шүүх"><button type="button" data-settlement-filter="pending" aria-pressed="true">Буцаалт батлах (${pending.length})</button><button type="button" data-settlement-filter="all" aria-pressed="false">Бүх бүртгэл (${entries.length})</button></div><div class="settlement-records"></div><p class="settlement-limit">Сүүлийн 500 хүртэлх бүртгэл. Үнийн тооцоо нь бодит орлого гэсэн үг биш.</p></section>`);
        const records = element.querySelector('.settlement-records');
        let selectedPendingOnly = true;
        const renderAudit = pendingOnly => {
          selectedPendingOnly = pendingOnly;
          const remaining = entries.filter(entry => entry.action === 'refund' && entry.state === 'awaiting_settlement');
          element.querySelector('[data-audit-pending-count]').textContent = remaining.length;
          element.querySelector('[data-audit-pending-amount]').textContent = `${cny(remaining.reduce((sum, entry) => sum + Number(entry.snapshot?.walletCny || 0), 0))} CNY`;
          element.querySelector('[data-settlement-filter="pending"]').textContent = `Буцаалт батлах (${remaining.length})`;
          records.innerHTML = safeHtml(settlementAuditMarkup(entries, pendingOnly));
          element.querySelectorAll('[data-settlement-filter]').forEach(button => button.setAttribute('aria-pressed', String((button.dataset.settlementFilter === 'pending') === pendingOnly)));
        };
        element.querySelectorAll('[data-settlement-filter]').forEach(button => button.addEventListener('click', () => renderAudit(button.dataset.settlementFilter === 'pending')));
        renderAudit(true);
        element.querySelector('.close').onclick = () => closeModal(element);
        records.addEventListener('click', async event => {
          const button = event.target.closest('[data-settle-refund]');
          if (!button || button.disabled) return;
          const entry = entries[Number(button.dataset.settleRefund)];
          if (!entry || entry.action !== 'refund' || entry.state !== 'awaiting_settlement') return;
          const amount = window.prompt('Нийлүүлэгчээс бодитоор буцаж орсон CNY дүнг оруулна уу. Эхлээд гүйлгээний баримтыг тулгана.');
          if (amount === null || !amount.trim()) return;
          const reference = window.prompt('Буцаалтын гүйлгээний баталгаат дугаар (5-аас доошгүй тэмдэгт):');
          if (!reference) return;
          if (!window.confirm(`Нийлүүлэгчээс буцаалт орсныг тулгасан уу? Тухайн агентын wallet-д ${cny(entry.snapshot.walletCny)} CNY нэмнэ (${mnt(entry.snapshot.amountMnt)}).`)) return;
          button.disabled = true;
          element.querySelectorAll('[data-settlement-filter]').forEach(filter => filter.disabled = true);
          try {
            await api('/api/admin/refund-settlement', { method: 'POST', body: JSON.stringify({ bookingId: entry.booking_id, reference: entry.reference, supplierReceived: Number(amount), settlementReference: reference, confirmed: true }) });
            entry.state = 'settled';
            renderAudit(selectedPendingOnly); notify('Буцаалт агентын wallet-д бүртгэгдлээ.'); await load();
          } catch (error) { button.disabled = false; notify(error.message); }
          finally { element.querySelectorAll('[data-settlement-filter]').forEach(filter => filter.disabled = false); }
        });
        element.showModal();
      } catch (error) { notify(error.message); }
      finally { accounting.disabled = false; }
    });
    byId('#agency-list')?.addEventListener('click', async event => {
      const button = event.target.closest('.agency-status');
      if (!button) return;
      const item = agency(button.dataset.agencyId);
      if (!item) return;
      button.disabled = true;
      try {
        await api(`/api/admin/agencies/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ active: !item.active }) });
        await load();
        notify('Agency status updated.');
      } catch (issue) { notify(issue.message); } finally { button.disabled = false; }
    });
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
    byId('#admin-topups')?.addEventListener('click', async event => {
      const approve = event.target.closest('.topup-approve'), remove = event.target.closest('.topup-delete'), button = approve || remove;
      if (!button) return;
      const deleting = Boolean(remove), invoice = overview.topups.find(item => item.id === button.dataset.topupId);
      if (!deleting && (!invoice || !['legacy', 'cny-funding-v1'].includes(invoice.pricing_model))) {
        notify('Нэхэмжлэлийн үнийн загвар дутуу байна. Жагсаалтыг шинэчилнэ үү; банкны орлогыг батлахгүй.', 7000); return;
      }
      if (!deleting) { openTopupApproval(invoice); return; }
      if (!confirm('Delete this pending invoice? This cannot be undone.')) return;
      button.disabled = true;
      try {
        await api(`/api/topups/${button.dataset.topupId}`, {method:'DELETE'});
        await load(); notify(deleting ? 'Pending invoice deleted.' : 'Invoice approved and wallet credited.');
      } catch (issue) { button.disabled = false; notify(issue.message + (/^TOPUP_[A-Z_]+$/.test(issue.code || '') ? ` (${issue.code})` : ''), 7000); }
    });
    byId('#user-list')?.addEventListener('click', event => { const button = event.target.closest('[data-user-id]'); if (!button) return; if (button.classList.contains('user-edit')) openEditUser(button.dataset.userId); if (button.classList.contains('user-invite')) resendInvite(button); if (button.classList.contains('user-delete')) remove('users', button.dataset.userId); });
    load();
    setInterval(() => { if (document.visibilityState === 'visible' && isPlatformAdmin()) load(); }, 5000);
  };
  window.loadAdministration = load;
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', setup) : setup();
})();
