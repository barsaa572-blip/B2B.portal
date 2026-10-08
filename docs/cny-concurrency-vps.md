# Isolated CNY concurrency acceptance — 8 October 2026

User confirms Docker 29.1.3 on the VPS. No psql is installed on the host;
installation is unnecessary for this runner because it uses the container's psql.
On 8 October the user supplied all four independent-session PASS results and
final concurrency PASS from the SHA256-verified archive on this VPS. The runner
removed only its own disposable mock container/data. Browser desktop/mobile
checks also passed. This is test-only, not production deployment or SQL activation.

Prepared archive: tmp/security/nexahub-cny-check-20261008-v1.tar.gz
SHA256: 7edfc3aaec22ee741ce9f6c25f169b44688ae578fc00882e6b8f9fb225f79e2a
It contains exactly the runner, five required source modules/builders and sixteen
SQL source files. No .env, auth keys, node_modules or customer records are included.
It does not need Git push, npm install or access to the production checkout.

## Ordinary Windows PowerShell — copy only this test archive

```powershell
scp 'C:\Users\barsa\Documents\Codex\2026-08-05\za\outputs\B2B.portal\tmp\security\nexahub-cny-check-20261008-v1.tar.gz' root@202.131.1.50:/tmp/nexahub-cny-check-20261008-v1.tar.gz
```

Use the existing SSH credentials locally; do not paste them into chat. Stop if
transfer fails. Do not disable host-key checking. An unexpected SSH host-key
change must be resolved before transferring.

## VPS Bash — stop on errors, keep production unchanged

```bash
(
  set -euo pipefail
  test -x /opt/nexahub-node/bin/node
  # Leave headroom for production: no test on a memory/disk-constrained VPS.
  awk '/^MemAvailable:/ { exit ($2 < 786432) }' /proc/meminfo || { echo 'STOP: insufficient free memory for an isolated test.'; exit 1; }
  DOCKER_DATA_DIR=$(docker info --format '{{.DockerRootDir}}')
  test -d "$DOCKER_DATA_DIR"
  test "$(df --output=avail -k "$DOCKER_DATA_DIR" | tail -n 1 | tr -d ' ')" -ge 1048576 || { echo 'STOP: insufficient Docker disk space.'; exit 1; }
  printf '%s  %s\n' '7edfc3aaec22ee741ce9f6c25f169b44688ae578fc00882e6b8f9fb225f79e2a' '/tmp/nexahub-cny-check-20261008-v1.tar.gz' | sha256sum -c -
  CNY_CHECK_DIR=$(mktemp -d /tmp/nexahub-cny-check.XXXXXX)
  tar -xzf /tmp/nexahub-cny-check-20261008-v1.tar.gz -C "$CNY_CHECK_DIR"
  docker pull postgres:16-bookworm
  cd "$CNY_CHECK_DIR"
  /opt/nexahub-node/bin/node scripts/check-cny-concurrency.mjs
)
```

The database has no external network, published ports or host mounts. Mock-only
data is temporary; the exact verified own test container is removed automatically.
This runner never reads production env/DB URL, restarts services, modifies the
production checkout, calls Spring/banks, or changes real Supabase data. The image
and archive/extracted scripts remain for repeat runs; no broad cleanup is issued.

Expected: four independent-session PASS lines and final concurrency PASS. A
missing tool, resource guard, timeout, SQL exception or inability to observe a
real lock is STOP, not financial acceptance. Send output (no credentials). Do
not activate the funding model merely because HTTP health or other tests pass.
