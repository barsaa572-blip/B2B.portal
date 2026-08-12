const trimSlash = value => String(value || '').replace(/\/+$/, '');

function config() {
  const url = trimSlash(process.env.SUPABASE_URL);
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return { url, publishableKey, secretKey, configured: Boolean(url && publishableKey && secretKey) };
}

async function request(path, { method = 'GET', headers = {}, body } = {}) {
  const { url } = config();
  return fetch(`${url}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function secretRequest(path, options = {}) {
  const { secretKey, configured } = config();
  if (!configured) throw new Error('Database is not configured on this server.');
  const response = await request(path, { ...options, headers: { apikey: secretKey, authorization: `Bearer ${secretKey}`, prefer: 'return=representation', ...(options.headers || {}) } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.msg || 'Database request failed.');
  return data;
}

export function getSupabaseStatus() {
  const { configured } = config();
  return { configured };
}

export async function signInWithPassword(email, password) {
  const { publishableKey, configured } = config();
  if (!configured) throw new Error('Authentication is not configured on this server.');
  const response = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: publishableKey },
    body: { email, password }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error('Invalid email or password.');
  return data;
}

export async function profileForAccessToken(accessToken) {
  const { publishableKey, secretKey, configured } = config();
  if (!configured) throw new Error('Authentication is not configured on this server.');

  const userResponse = await request('/auth/v1/user', {
    headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}` }
  });
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || !user.id) throw new Error('Your login session is invalid.');

  const profileResponse = await request(`/rest/v1/profiles?select=id,role,full_name,agency_id,branch_id,active&id=eq.${encodeURIComponent(user.id)}`, {
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` }
  });
  const profiles = await profileResponse.json().catch(() => []);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile || !profile.active) throw new Error('Your account is not active or has not been assigned to an agency.');
  return { id: user.id, email: user.email, ...profile };
}

export async function requirePlatformAdmin(accessToken) {
  const profile = await profileForAccessToken(accessToken);
  if (profile.role !== 'platform_admin') throw new Error('Platform administrator access is required.');
  return profile;
}

export async function getAdminOverview() {
  const [agencies, branches, profiles, wallets] = await Promise.all([
    secretRequest('/rest/v1/agencies?select=id,name,active,created_at&order=name.asc'),
    secretRequest('/rest/v1/branches?select=id,agency_id,name&order=name.asc'),
    secretRequest('/rest/v1/profiles?select=id,agency_id,branch_id,role,full_name,active,created_at&order=full_name.asc'),
    secretRequest('/rest/v1/wallets?select=agency_id,balance_cny,updated_at')
  ]);
  return { agencies, branches, profiles, wallets };
}

export async function createAgency({ name, branchName, initialBalance = 0 }) {
  const created = await secretRequest('/rest/v1/agencies', { method: 'POST', body: { name, active: true } });
  const agency = created[0];
  await secretRequest('/rest/v1/wallets', { method: 'POST', body: { agency_id: agency.id, balance_cny: Number(initialBalance) || 0 } });
  if (branchName?.trim()) await secretRequest('/rest/v1/branches', { method: 'POST', body: { agency_id: agency.id, name: branchName.trim() } });
  return agency;
}

export async function createUser({ email, password, fullName, agencyId, branchId, role }) {
  const { secretKey, configured } = config();
  if (!configured) throw new Error('Database is not configured on this server.');
  const response = await request('/auth/v1/admin/users', { method: 'POST', headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` }, body: { email, password, email_confirm: true } });
  const authUser = await response.json().catch(() => ({}));
  if (!response.ok || !authUser.id) throw new Error(authUser.msg || authUser.message || 'Unable to create the login account.');
  try {
    await secretRequest('/rest/v1/profiles', { method: 'POST', body: { id: authUser.id, agency_id: agencyId || null, branch_id: branchId || null, role, full_name: fullName, active: true } });
  } catch (error) {
    await request(`/auth/v1/admin/users/${authUser.id}`, { method: 'DELETE', headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` } });
    throw error;
  }
  return { id: authUser.id, email: authUser.email };
}

export async function adjustWallet({ agencyId, amount, reason, createdBy }) {
  return secretRequest('/rest/v1/rpc/platform_adjust_wallet', { method: 'POST', body: { p_agency_id: agencyId, p_amount: Number(amount), p_reason: reason, p_created_by: createdBy } });
}

export async function updateAgency(id, { name, active }) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (active !== undefined) body.active = active;
  const updated = await secretRequest(`/rest/v1/agencies?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body });
  return updated[0];
}

export async function deleteAgency(id) {
  const [profiles, bookings, transactions] = await Promise.all([
    secretRequest(`/rest/v1/profiles?select=id&id=not.is.null&agency_id=eq.${encodeURIComponent(id)}&limit=1`),
    secretRequest(`/rest/v1/bookings?select=id&agency_id=eq.${encodeURIComponent(id)}&limit=1`),
    secretRequest(`/rest/v1/wallet_transactions?select=id&agency_id=eq.${encodeURIComponent(id)}&limit=1`)
  ]);
  if (profiles.length || bookings.length || transactions.length) throw new Error('This agency has users, bookings, or wallet history. Deactivate it instead to preserve its audit trail.');
  await secretRequest(`/rest/v1/agencies?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function updateUser(id, { fullName, agencyId, branchId, role, active }) {
  const updated = await secretRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { full_name: fullName, agency_id: agencyId || null, branch_id: branchId || null, role, active } });
  return updated[0];
}

export async function deleteUser(id) {
  const bookings = await secretRequest(`/rest/v1/bookings?select=id&created_by=eq.${encodeURIComponent(id)}&limit=1`);
  if (bookings.length) throw new Error('This user has booking history. Deactivate the account instead to preserve the audit trail.');
  const { secretKey } = config();
  const response = await request(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` } });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.message || 'Unable to delete user.'); }
}

export async function createTopupRequest({ profile, amount, paymentReference, note }) {
  if (!profile.agency_id) throw new Error('Your account is not assigned to an agency.');
  const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const created = await secretRequest('/rest/v1/topup_requests', { method: 'POST', body: { invoice_number: invoiceNumber, agency_id: profile.agency_id, requested_by: profile.id, amount_cny: Number(amount), payment_reference: paymentReference, note: note || null } });
  return created[0];
}

export async function getTopupRequests(profile) {
  let filter = profile.role === 'platform_admin' ? '' : profile.role === 'office_manager' ? `&agency_id=eq.${profile.agency_id}` : `&requested_by=eq.${profile.id}`;
  return secretRequest(`/rest/v1/topup_requests?select=*&order=created_at.desc${filter}`);
}

export async function getTopupInvoice(profile, id) {
  const rows = await secretRequest(`/rest/v1/topup_requests?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  const request = rows[0];
  if (!request) throw new Error('Invoice not found.');
  const allowed = profile.role === 'platform_admin' || request.requested_by === profile.id || (profile.role === 'office_manager' && request.agency_id === profile.agency_id);
  if (!allowed) throw new Error('You do not have access to this invoice.');
  const agencies = await secretRequest(`/rest/v1/agencies?select=name&id=eq.${encodeURIComponent(request.agency_id)}&limit=1`);
  return { ...request, agencyName: agencies[0]?.name || 'Agency' };
}

export async function approveTopupRequest(id, approvedBy) {
  return secretRequest('/rest/v1/rpc/approve_topup_request', { method: 'POST', body: { p_topup_id: id, p_approved_by: approvedBy } });
}
