import { HttpError } from './request-security.mjs';

export const emailStepRequired = () => process.env.AUTH_EMAIL_OTP_REQUIRED === 'true';
export const passwordRotationRequired = () => process.env.AUTH_PASSWORD_ROTATION_REQUIRED === 'true';

// Six calendar months, clamped at month end (not 180 days).
export function passwordDeadline(changedAt) {
  if (typeof changedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(changedAt)) return null;
  const date = new Date(changedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const target = new Date(date);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + 6);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target.getTime();
}
export function passwordDue(profile, now = Date.now()) {
  const changedAt = profile?.passwordSecurity?.password_changed_at;
  const deadline = passwordDeadline(changedAt);
  return deadline === null || new Date(changedAt).getTime() > now || now >= deadline;
}
export const publicLoginProfile = ({ passwordSecurity, ...profile }) => profile;
export const passwordRevision = profile => profile?.passwordSecurity?.revision || null;

// A pending cookie is NEVER a portal session. It authorizes only these methods.
// Dependencies are injected so tests cannot send real mail or change accounts.
export function createLoginSecurity({ pending, sessions, signIn, profileForToken,
  sendCode, verifyCode, changePassword, revoke, assertReady, limit,
  emailRequired = emailStepRequired, rotationRequired = passwordRotationRequired,
  now = Date.now } = {}) {
  const active = () => emailRequired() || rotationRequired();
  const live = req => {
    const value = pending.find(req);
    if (!value) throw new HttpError(401, 'Sign in again to request a new code.');
    return value;
  };
  const discard = async (req, res) => {
    const value = pending.find(req);
    pending.clear(req, res);
    if (value?.access_token) await revoke(value.access_token);
  };
  const state = value => ({ nextStep: value.stage, expiresIn: Math.max(0, Math.floor((value.deadline - now()) / 1000)), resendAfter: Math.max(0, Math.ceil((value.lastSentAt + 60000 - now()) / 1000)) });
  const complete = (req, res, session, profile) => {
    if (rotationRequired() && passwordDue(profile, now())) throw new HttpError(401, 'Password renewal is required. Sign in again.');
    sessions.establish(req, res, { ...session, userId: profile.id, securityRevision: passwordRevision(profile), emailVerified: emailRequired() });
    pending.clear(req, res);
    return { accessToken: 'cookie', refreshToken: 'cookie', expiresIn: session.expires_in, profile: publicLoginProfile(profile) };
  };
  const locked = async (req, value, execute) => {
    if (value.busy) throw new HttpError(409, 'A verification request is already in progress.');
    value.busy = true;
    try { return await execute(); } finally { value.busy = false; }
  };
  const stillLive = (req, value) => {
    if (pending.find(req) !== value) throw new HttpError(401, 'Verification expired. Sign in again.');
  };
  return {
    active,
    async start(req, res, { email, password } = {}) {
      if (!email || typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || !password || password.length > 1024) throw new HttpError(400, 'Email and password are required.');
      if (active()) await assertReady();
      const session = await signIn(email, password);
      let retained = false;
      try {
        const profile = await profileForToken(session.access_token);
        if (session.user?.id !== profile.id) throw new HttpError(401, 'Account verification failed.');
        sessions.clear(req, res);
        await discard(req, res);
        if (!emailRequired() && (!rotationRequired() || !passwordDue(profile, now()))) {
          const result = complete(req, res, session, profile);
          retained = true;
          return result;
        }
        if (emailRequired()) {
          limit(`email-code:${profile.id}`, 5, 900000);
          await sendCode(profile.email);
        }
        pending.establish(req, res, { ...session, userId: profile.id, email: profile.email,
          securityRevision: passwordRevision(profile), stage: emailRequired() ? 'email' : 'password',
          attempts: 0, lastSentAt: now(), busy: false });
        retained = true;
        // Find uses the request cookie, which is still the previous identity.
        return { nextStep: emailRequired() ? 'email' : 'password', expiresIn: 300, resendAfter: 60 };
      } finally { if (!retained) await revoke(session.access_token); }
    },
    async verify(req, res, input) {
      const value = live(req);
      if (value.stage !== 'email' || !emailRequired()) throw new HttpError(400, 'Email verification is not available.');
      return locked(req, value, async () => {
        value.attempts += 1;
        let verified, kept = false;
        try {
          if (value.attempts > 5 || typeof input?.code !== 'string' || !/^\d{6,10}$/.test(input.code)) throw new HttpError(400, 'Enter the verification code from your email.');
          verified = await verifyCode(value.email, input.code);
          if (verified.user?.id !== value.userId) throw new HttpError(401, 'Account verification failed.');
          const profile = await profileForToken(verified.access_token);
          if (profile.id !== value.userId || profile.email?.toLowerCase() !== value.email.toLowerCase() || passwordRevision(profile) !== value.securityRevision) throw new HttpError(401, 'Account changed. Sign in again.');
          stillLive(req, value);
          if (rotationRequired() && passwordDue(profile, now())) {
            await revoke(value.access_token);
            stillLive(req, value);
            Object.assign(value, verified, { stage: 'password' });
            kept = true;
            return state(value);
          }
          const result = complete(req, res, verified, profile);
          kept = true;
          await revoke(value.access_token);
          return result;
        } catch (error) {
          if (value.attempts >= 5 || error.status === 401) await discard(req, res);
          throw error;
        } finally { if (verified?.access_token && !kept) await revoke(verified.access_token); }
      });
    },
    async resend(req, res) {
      const value = live(req);
      if (value.stage !== 'email' || !emailRequired()) throw new HttpError(400, 'Email verification is not available.');
      return locked(req, value, async () => {
        if (now() < value.lastSentAt + 60000) throw new HttpError(429, 'Wait one minute before requesting another code.');
        const profile = await profileForToken(value.access_token);
        if (profile.id !== value.userId || profile.email?.toLowerCase() !== value.email.toLowerCase() || passwordRevision(profile) !== value.securityRevision) throw new HttpError(401, 'Account changed. Sign in again.');
        limit(`email-code:${profile.id}`, 5, 900000);
        value.lastSentAt = now(); // Failed sends do not permit immediate retries.
        await sendCode(value.email);
        stillLive(req, value);
        return state(value); // Absolute deadline and attempt count never reset.
      });
    },
    async rotate(req, res, input) {
      const value = live(req);
      if (value.stage !== 'password' || !rotationRequired()) throw new HttpError(403, 'Complete email verification first.');
      return locked(req, value, async () => {
        const profile = await profileForToken(value.access_token);
        if (profile.id !== value.userId || passwordRevision(profile) !== value.securityRevision) throw new HttpError(401, 'Account changed. Sign in again.');
        limit(`password:${profile.id}`, 5, 900000);
        stillLive(req, value);
        await changePassword(profile, input);
        sessions.invalidateUser(profile.id);
        pending.invalidateUser(profile.id);
        pending.clear(req, res);
        sessions.clear(req, res);
        return { ok: true, signInAgain: true };
      });
    },
    cancel: discard
  };
}
