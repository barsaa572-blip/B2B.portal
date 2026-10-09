#!/usr/bin/env bash
# Code-only follow-up: no SQL, env edits, supplier calls, cron rollout or npm reinstall.
set -euo pipefail
test "$(id -u)" = 0
test "$(realpath /opt/flightb2b)" = /opt/flightb2b
cd /opt/flightb2b
task_git() { git -c safe.directory=/opt/flightb2b "$@"; }
TASK_RELEASE=${RELEASE_COMMIT:?Run the provided VPS block first}
[[ "$TASK_RELEASE" =~ ^[0-9a-f]{40}$ ]]
test "$(task_git branch --show-current)" = main
test "$(task_git rev-parse origin/main)" = "$TASK_RELEASE"
test -z "$(task_git status --porcelain --untracked-files=no)"
TASK_BEFORE=$(task_git rev-parse HEAD)
task_git merge-base --is-ancestor "$TASK_BEFORE" "$TASK_RELEASE"
task_git diff --quiet "$TASK_BEFORE" "$TASK_RELEASE" -- package.json package-lock.json supabase .env.example
TASK_NODE=/opt/nexahub-node/bin/node
test -x "$TASK_NODE"
test "$("$TASK_NODE" --version | cut -d. -f1)" = v24
TASK_USER=$(systemctl show flightb2b -p User --value)
test "$TASK_USER" = flightb2b
TASK_GROUP=$(id -gn "$TASK_USER")
systemctl is-active --quiet flightb2b
# Check existing financial settings without changing them, before downtime.
"$TASK_NODE" scripts/cny-funding-preflight.mjs

umask 077
TASK_BACKUP=$(mktemp -d /var/backups/nexahub-topup-ui.XXXXXX)
cp -p /etc/flightb2b/flightb2b.env "$TASK_BACKUP/flightb2b.env"
printf '%s\n' "$TASK_BEFORE" > "$TASK_BACKUP/previous-commit.txt"
tar --exclude=.git --exclude=node_modules --exclude=tmp --exclude=logs --exclude=.tmp-retail-db --exclude=output -czf "$TASK_BACKUP/code.tar.gz" .
tar -tzf "$TASK_BACKUP/code.tar.gz" >/dev/null
printf 'Private backup: %s\n' "$TASK_BACKUP"
# Do not create unreadable code with the private backup's restrictive umask.
umask 022
TASK_STOPPED=0
trap 'if (( TASK_STOPPED )); then echo "STOP: Release failed. Service state is not certified; private backup: $TASK_BACKUP. Do not reset wallets or SQL." >&2; fi' EXIT
systemctl stop flightb2b
TASK_STOPPED=1
task_git merge --ff-only "$TASK_RELEASE"
test "$(task_git rev-parse HEAD)" = "$TASK_RELEASE"
# Service-group read only for runtime/public files; never .env, .git or backups.
task_git ls-files -z -- server.mjs '*.js' '*.html' '*.css' 'backend/*.mjs' package.json nexahub-logo.png nexahub-favicon.png 'assets/invoice/*' |
  xargs -0 -r chgrp "$TASK_GROUP" --
task_git ls-files -z -- server.mjs '*.js' '*.html' '*.css' 'backend/*.mjs' package.json nexahub-logo.png nexahub-favicon.png 'assets/invoice/*' |
  xargs -0 -r chmod g+r --
runuser -u "$TASK_USER" -- "$TASK_NODE" --check server.mjs
runuser -u "$TASK_USER" -- "$TASK_NODE" --input-type=module -e "await import('./backend/cny-approval.mjs'); await import('./backend/cny-funding.mjs'); await import('./backend/topup-invoice.mjs'); console.log('PASS: service-user runtime imports');"
mapfile -t TASK_TESTS < <(task_git ls-files -- 'tests/*.test.*')
test "${#TASK_TESTS[@]}" -gt 0
"$TASK_NODE" --test "${TASK_TESTS[@]}"
"$TASK_NODE" scripts/cny-funding-preflight.mjs
systemctl reset-failed flightb2b
systemctl start flightb2b
for task_attempt in {1..30}; do
  if curl -fsS --max-time 3 http://127.0.0.1:4173/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS --max-time 3 -w '\n' http://127.0.0.1:4173/api/health
systemctl is-active flightb2b
test "$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' https://nexahub.airsales.ub.mn/)" = 200
echo 'Website HTTP: 200'
TASK_STOPPED=0
echo 'READY: Production UI/booking diagnostics deployed. No SQL activation or manual wallet update.'
