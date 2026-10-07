# Email sign-in and six-month password renewal

Prepared 2026-10-06. Local mocks only; not activated or certified on production.

Latest requested behavior and gated activation are documented in
[security-fixes-2026-10-06.md](security-fixes-2026-10-06.md): 20-minute human-activity
idle timeout, fixed 24-hour same-browser email receipt, persistent private
AUTH_DEVICE_SECRET, and one-year host-only HSTS. Production activation is pending.

## Controls

- `AUTH_EMAIL_OTP_REQUIRED=true`: password first, company-email code second.
  Pending identity is an opaque HttpOnly cookie with five-minute absolute expiry,
  five attempts, one-minute resend cooldown and per-account/IP rate limits.
  Neither a pending cookie nor a raw Supabase bearer token authorizes portal APIs.
- `AUTH_PASSWORD_ROTATION_REQUIRED=true`: six **calendar** months from a trusted
  server-recorded password change, clamped at month end. Existing accounts without
  a recorded date must renew once; dates are not invented from account creation.
  Email verification precedes renewal, then a fresh password+code login is needed.
- Both flags default false for a controlled rollout. This is a **portal email
  second-step**, not Supabase-native MFA/AAL2. Email alone cannot prevent a user
  deliberately sharing their mailbox, password and code.
- Password changes invalidate local user sessions and revoke provider refresh
  sessions globally. The service-only database revision also denies old portal
  cookies after a password change. Existing provider JWTs can remain valid until
  expiry, so backend-only table/RPC privileges are a mandatory rollout gate.
- Supabase tokens, passwords and OTPs never enter browser storage. Code, password,
  sender credentials and token values must not be logged.
- Successful email verification sets a signed HttpOnly, Secure host-only browser
  receipt valid for 24 hours. Ordinary logout/idle expiry keeps this receipt but
  still requires the password at the next login. It is never an API credential.
  Password/email/revision changes, another browser and expiry require fresh OTP.
  `AUTH_DEVICE_SECRET` must be a private persistent 64–128 hex-character random
  key before enabling email checks; the VPS helper generates it without printing.

## Rollout order (keep flags false until step 4)

1. Deploy the matching code after tests. Restarting signs current users out.
2. Apply `supabase/portal-auth-security.sql` in the correct Supabase SQL editor.
   It revokes direct browser table privileges, keeps RLS enabled and introduces
   service-only renewal tracking. Backend requests continue using service_role.
   `select public.portal_auth_security_ready();` must return **true**. Do not
   automatically revoke unrelated custom RPCs to force a false result to true;
   inspect their purpose and grants first. The gate also detects readable public
   views and known-table column grants; it does not silently remove them. Custom
   roles/schemas/external integrations still require a separate access review.
3. In Supabase Authentication → Emails → Templates → **Magic Link**, use
   `supabase/templates/login-code.html` (subject: NEXAHUB sign-in code).
   Do **not** replace Invite User with this template. Keep the working invitation
   template. Custom SMTP is already reported working by the user; verify delivery
   with a designated test account, and review hourly email quota before launch.
4. Set both flags true in `/etc/flightb2b/flightb2b.env`, restart `flightb2b`, then
   perform acceptance using a designated low-privilege account. Do not share codes
   or passwords in chat. No ticket/payment/refund action is needed for acceptance.

Do not globally reduce Supabase Email OTP expiration just for this feature:
that setting also affects invitation/recovery links. The portal imposes its own
five-minute pending-session deadline.

## Acceptance / rollback

- Password-only pending cookie, raw password bearer and raw OTP bearer: API401.
- Correct code + current password date: login succeeds; storage has cookie markers
  only. Wrong/used code, five failed attempts, expiry or inactive agency: denied.
- Existing account: after OTP, renewal form appears; wallet/booking remains denied.
  New password saves, user signs in again. Both current and other old cookies fail.
- Manager/admin tenant scope, invoice preview, invitation setup and logout still
  work; verify with at least two agency accounts without creating business data.
- SMTP failure never falls back to password-only login. If activation causes a
  problem, turn flags false and restart to restore the previous login flow while
  diagnosing. This is an explicit rollback of added protection: record the reason
  and keep it brief. Do not re-grant direct browser financial access.

Session/challenge storage and app rate limits are in-process. This deployment is
single-process; add shared stores/atomic locks before multiple workers or hosts.
Self-service forgotten-password recovery and audit/alert retention remain separate
work; administrators must not bypass email verification to change another user's
password. Keep recovery tokens restricted to a dedicated flow.

References: [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[native MFA](https://supabase.com/docs/guides/auth/auth-mfa).
