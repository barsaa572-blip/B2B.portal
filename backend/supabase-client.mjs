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
