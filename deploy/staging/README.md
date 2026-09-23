# NEXAHUB test environment (manual rollout)

Production stays at `/opt/flightb2b`, port 4173, service `flightb2b`, branch `main`.
Test uses `/opt/flightb2b-test`, port 4174, service/user `flightb2b-test`, branch
`develop`, and `https://test.nexahub.airsales.ub.mn`.

These files are prepared locally, not installed on the VPS. Run each phase only
after the preceding phase succeeds. Never copy the production env to staging.
Never run the test service via `node server.mjs` directly: use its guarded entrypoint.
The origin/key checks catch accidental reuse; they are not an OS/network sandbox
and cannot prove that a supplier account is a test account. Confirm with Spring.

## 1. Empty test database only

Open the **new test project** in Supabase SQL Editor, verify its project reference,
and run `empty-test-schema.sql`. It installs the repository's existing schema and
function migrations in dependency order, with `security-hardening.sql` last.
The transaction refuses projects that already have public tables or auth users.
It contains no live business data and does not execute wallet-reset functions.
It has been checked structurally, not executed against your remote database.
Do not use this file to upgrade production or a populated test database.
To regenerate after editing migrations: `node deploy/staging/build-schema.mjs`.

Next, create one test admin through Supabase Authentication > Users (choose a
new test-only password yourself), then insert that auth user's UUID into
`public.profiles` with `role='platform_admin'`, `active=true`, and a display name.
No production users, passenger details, PNRs or wallets should be imported.
Review test signup settings and disable public signup when accounts are admin-created.
If the live DB has changes not represented in Git, reconcile schema differences
before declaring parity. Do not overwrite either database with the other.

## 2. Publish the test branch from the local PC

From the repository directory (current branch is `main`, no `develop` exists yet):

```powershell
git switch -c develop
git add server.mjs backend/environment-page.mjs staging.css deploy/staging tests/staging.test.mjs
git commit -m "Prepare isolated NEXAHUB staging deployment"
git -c http.sslBackend=openssl push -u origin develop
```

If `develop` already exists, stop and inspect it; do not force-reset it.
Do not push these changes to main as a way to update the test site.

## 3. Create a separate VPS checkout and secret file

The VPS currently uses Node 18.19.1 at `/usr/bin/node` for production. Keep that
binary unchanged during staging setup. Install the official Node 24.21.0 LTS Linux
distribution separately at `/opt/nexahub-node`, verifying its official SHA256 first.
Do not change PATH, package-manager Node, system symlinks or the production service.
Use `/opt/nexahub-node/bin/node --version` to verify the separate runtime before
running this phase. Execute as root in the existing SSH session:

```bash
(
  set -eu
  test ! -e /opt/flightb2b-test
  test ! -e /etc/flightb2b-test
  getent passwd flightb2b-test >/dev/null || useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin flightb2b-test
  STAGING_REPO_URL=$(git -c safe.directory=/opt/flightb2b -C /opt/flightb2b remote get-url origin)
  git clone --single-branch --branch develop "$STAGING_REPO_URL" /opt/flightb2b-test
  unset STAGING_REPO_URL
  chmod 700 /opt/flightb2b-test/.git
  install -d -m 750 -o root -g flightb2b-test /etc/flightb2b-test
  install -m 600 /opt/flightb2b-test/deploy/staging/staging.env.example /etc/flightb2b-test/flightb2b-test.env
  /opt/nexahub-node/bin/node --env-file=/etc/flightb2b/flightb2b.env /opt/flightb2b-test/deploy/staging/snapshot-production.mjs
  chown root:flightb2b-test /etc/flightb2b-test/production-reference.json
  chmod 640 /etc/flightb2b-test/production-reference.json
)
sudo nano /etc/flightb2b-test/flightb2b-test.env
```

Fill the test Supabase URL/keys and all Spring test URLs/credentials privately.
`STAGING_SPRING_ALLOWED_ORIGINS` is a comma-separated list of confirmed test
scheme+host+port values, without API paths. The supplied blank values are deliberate.
Use full endpoints from the supplier; don't guess SOAP paths from HTTP paths.
Keep all three booking/payment/transaction flags false during initial setup.
Quote secret values containing spaces or `#` using the environment-file format.
Do not print the env file, put it in shell history, share it in chat, or commit it.
Use fake passenger/contact data only, especially if the test supplier uses HTTP.
Confirm Spring has authorized VPS IP 202.131.1.50 for the test account as well.

The reference has origins and credential fingerprints only, not production secrets.
If production endpoints/credentials later change, regenerate the reference under
admin control (preserve the previous file first); do not disable the checks to proceed.
Shared production/test supplier hosts or credentials intentionally fail closed and
require a reviewed supplier-specific isolation strategy, not removal of the guard.

Validate without starting the app or making API calls:

```bash
sudo /opt/nexahub-node/bin/node --env-file=/etc/flightb2b-test/flightb2b-test.env /opt/flightb2b-test/deploy/staging/start.mjs --check
```

## 4. Start only the test service, after schema and test admin are ready

```bash
(
  set -eu
  test ! -e /etc/systemd/system/flightb2b-test.service
  install -m 644 /opt/flightb2b-test/deploy/staging/flightb2b-test.service /etc/systemd/system/flightb2b-test.service
  systemd-analyze verify /etc/systemd/system/flightb2b-test.service
  systemctl daemon-reload
  systemctl enable --now flightb2b-test
)
sudo systemctl status flightb2b-test --no-pager -l
curl -fsS http://127.0.0.1:4174/api/health
```

The service has a different Linux user, read-only filesystem view, inaccessible
production directories, 768 MB memory ceiling and 50% of one CPU time ceiling.
Both services still share the VPS, kernel, disk and network; this is not full VM isolation.

## 5. Separate Nginx site and HTTPS (no production restart)

Only after test backend checks pass:

```bash
(
  set -eu
  test ! -e /etc/nginx/sites-available/flightb2b-test
  test ! -e /etc/nginx/sites-enabled/flightb2b-test
  install -d -m 755 /var/www/nexahub-test-acme
  install -m 644 /opt/flightb2b-test/deploy/staging/nginx-http.conf /etc/nginx/sites-available/flightb2b-test
  ln -s /etc/nginx/sites-available/flightb2b-test /etc/nginx/sites-enabled/flightb2b-test
  nginx -t
  systemctl reload nginx
)
sudo certbot certonly --webroot -w /var/www/nexahub-test-acme \
  --cert-name test.nexahub.airsales.ub.mn -d test.nexahub.airsales.ub.mn \
  --deploy-hook 'nginx -t && systemctl reload nginx'
```

Read and accept any certificate-provider terms yourself. Bootstrap HTTP serves only
ACME challenges and 503, never the login form. If Certbot fails, stop here.
After it reports success:

```bash
(
  set -eu
  test -f /etc/letsencrypt/live/test.nexahub.airsales.ub.mn/fullchain.pem
  install -m 644 /opt/flightb2b-test/deploy/staging/nginx-https.conf /etc/nginx/sites-available/flightb2b-test
  nginx -t
  systemctl reload nginx
)
curl -fsS https://test.nexahub.airsales.ub.mn/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://test.nexahub.airsales.ub.mn/api/wallet
curl -sS -o /dev/null -w '%{http_code}\n' https://test.nexahub.airsales.ub.mn/deploy/staging/staging.env.example
sudo systemctl is-active flightb2b
```

Expect health OK, anonymous wallet 401, private deployment file 404, production
service active. Sign into the test domain using **test** credentials; verify the
yellow TEST banner and [TEST] browser title. Noindex is not access control: the
login page is public and application APIs require authentication. Add a reviewed
IP/VPN gate if private staging access is required. Do not put HTTP Basic auth over
Bearer-token API routes without handling the Authorization-header conflict.

Only after verifying schema, account permissions, all HTTP/SOAP supplier targets,
test account and fake balances should authorized testers enable transaction flags.
No real ticket, payment, change or refund is a deployment health check.

## 6. Daily updates and production promotion

Commit/push local work to develop as often as needed. Deploy test only:

```bash
cd /opt/flightb2b-test &&
git pull --ff-only origin develop &&
/opt/nexahub-node/bin/node --test tests/*.test.* &&
systemctl restart flightb2b-test
```

Do not update production during development. Before a release, record the tested
develop commit SHA, ensure main has no untested changes, review the diff and any
schema migrations, take a production DB backup and confirm restore/rollback access.
Merge the tested release into main, run the tests, and explicitly deploy main to
`/opt/flightb2b`. If main diverged, retest the merge result on staging first.
Use only the required forward DB migrations, not `empty-test-schema.sql`.
Code, reviewed migrations and assets move forward; test env, users, orders, wallet
balances and secret files do not. Code rollback alone cannot undo DB/supplier actions.
Production restart can briefly interrupt requests; zero-downtime release needs a
separate rolling/blue-green deployment design and handling of in-flight transactions.

References:
- https://supabase.com/docs/guides/deployment/managing-environments
- https://eff-certbot.readthedocs.io/en/stable/using.html#webroot
- https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html
- https://nodejs.org/en/blog/release/v24.21.0

Production Node 18 is end-of-life. Schedule its supported-LTS migration separately
after running the app and supplier integration tests on staging; this rollout does
not upgrade production automatically.
