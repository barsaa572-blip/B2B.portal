(() => {
  const agencies = [
    { name: 'AirSales', offices: 1, users: 2, balance: '¥ 12,480.00', status: 'Active' },
    { name: 'Bayar Agency', offices: 2, users: 6, balance: '¥ 36,920.00', status: 'Active' },
    { name: 'Airmarket Travel', offices: 1, users: 4, balance: '¥ 19,050.00', status: 'Active' }
  ];
  const users = [
    { name: 'Barsbold', email: 'barsbold@airsales.mn', place: 'AirSales · Head office', role: 'Platform administrator', status: 'Active' },
    { name: 'Bayar', email: 'booking@bayaragency.mn', place: 'Bayar Agency · Main', role: 'Office manager', status: 'Active' },
    { name: 'Enkhtaivan', email: 'agent1@bayaragency.mn', place: 'Bayar Agency · Main', role: 'Ticketing agent', status: 'Active' },
    { name: 'Sarуул', email: 'agent@airmarket.mn', place: 'Airmarket Travel · Main', role: 'Ticketing agent', status: 'Active' }
  ];
  const listAgencies = query => {
    const target = document.querySelector('#agency-list'); if (!target) return;
    const rows = agencies.filter(item => item.name.toLowerCase().includes(query.toLowerCase()));
    target.innerHTML = rows.map(item => `<tr><td><strong>${item.name}</strong></td><td>${item.offices}</td><td>${item.users}</td><td><strong>${item.balance}</strong></td><td><span class="tag ticketed">${item.status}</span></td><td><button class="text-btn admin-coming">Manage</button></td></tr>`).join('') || '<tr><td colspan="6" class="no-bookings">No agencies found.</td></tr>';
  };
  const listUsers = () => {
    const target = document.querySelector('#user-list'); if (!target) return;
    target.innerHTML = users.map(item => `<tr><td><strong>${item.name}</strong></td><td>${item.email}</td><td>${item.place}</td><td>${item.role}</td><td><span class="tag ticketed">${item.status}</span></td><td><button class="text-btn admin-coming">Manage</button></td></tr>`).join('');
  };
  const notify = message => { const toast = document.querySelector('#toast'); if (!toast) return; toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); };
  const setup = () => {
    listAgencies(''); listUsers();
    document.querySelector('#agency-filter')?.addEventListener('input', event => listAgencies(event.target.value));
    document.querySelector('#add-agency')?.addEventListener('click', () => notify('Agency creation will be connected to Supabase next.'));
    document.querySelector('#add-user')?.addEventListener('click', () => notify('User creation will be connected to Supabase next.'));
    document.querySelector('#administration')?.addEventListener('click', event => { if (event.target.closest('.admin-coming')) notify('Agency management will be connected to Supabase next.'); });
  };
  document.addEventListener('DOMContentLoaded', setup);
  if (document.readyState !== 'loading') setup();
})();
