#!/usr/bin/env bash
# Existing FX collector only. Never dump compose/env, restart API/DB or call crawl APIs.
set -euo pipefail
test "$(id -u)" = 0
test "$(realpath /opt/mongolbank-rates)" = /opt/mongolbank-rates
cd /opt/mongolbank-rates
TASK_FX_COMPOSE=/opt/mongolbank-rates/docker-compose.yml
TASK_FX_NODE=/opt/nexahub-node/bin/node
test -f "$TASK_FX_COMPOSE"
test -x "$TASK_FX_NODE"
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' mongolian-bank-cron)" = cron
TASK_FX_PROJECT=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' mongolian-bank-cron)
[[ "$TASK_FX_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]]
TASK_FX_API_ID=$(docker inspect --format '{{.Id}}' mongolian-bank-api)
TASK_FX_DB_ID=$(docker inspect --format '{{.Id}}' mongolian-bank-db)
TASK_FX_OLD_IMAGE=$(docker inspect --format '{{.Image}}' mongolian-bank-cron)
TASK_FX_IMAGE=$(docker inspect --format '{{.Config.Image}}' mongolian-bank-cron)
[[ "$TASK_FX_IMAGE" = mongolbank-rates-cron || "$TASK_FX_IMAGE" = mongolbank-rates-cron:latest ]]

# Inspect only selected build metadata, never print resolved secret environment.
docker compose -p "$TASK_FX_PROJECT" -f "$TASK_FX_COMPOSE" config --format json |
"$TASK_FX_NODE" --input-type=module -e '
import path from "node:path";
let text="";for await(const chunk of process.stdin) text+=chunk;
const service=JSON.parse(text).services?.cron;
if(!service || service.container_name!=="mongolian-bank-cron" ||
 !service.build?.context || path.resolve(service.build.context)!=="/opt/mongolbank-rates") {
 console.error("STOP: Unexpected cron build context/container. No scheduler edit performed.");process.exit(1);
}
console.log("PASS: Existing cron compose/build target confirmed; environment not printed.");
'

docker image tag "$TASK_FX_OLD_IMAGE" "mongolbank-rates-cron:before-3h-$(date -u +%Y%m%dT%H%M%SZ)"
"$TASK_FX_NODE" /tmp/set-bank-crawl-interval.mjs
TASK_FX_SHA=$(sha256sum /opt/mongolbank-rates/scripts/cron.py | awk '{print $1}')
docker compose -p "$TASK_FX_PROJECT" -f "$TASK_FX_COMPOSE" build cron

# Verify baked source in an isolated process with network disabled. Do NOT import cron.py.
TASK_FX_CHECK='from pathlib import Path
import ast,hashlib,sys
import schedule
roots={Path.cwd(),Path("/app"),Path("/usr/src/app")}
files={p.resolve() for r in roots for p in (r/"scripts/cron.py",r/"cron.py") if p.is_file()}
assert files,"Scheduler not found at expected image paths; stop before replacing running cron"
for p in files:
 data=p.read_bytes()
 assert hashlib.sha256(data).hexdigest()==sys.argv[1],"Image contains old/different scheduler; stop"
 ast.parse(data)
job=schedule.every(3).hours.do(lambda:None)
assert job.interval==3 and job.unit=="hours","Scheduler library interval check failed"
print("PASS: Three-hour scheduler source/syntax matches; no crawl function executed.")'
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --entrypoint python "$TASK_FX_IMAGE" -c "$TASK_FX_CHECK" "$TASK_FX_SHA"

docker compose -p "$TASK_FX_PROJECT" -f "$TASK_FX_COMPOSE" up -d --no-deps --no-build --force-recreate cron
sleep 8
test "$(docker inspect --format '{{.State.Running}}' mongolian-bank-cron)" = true
test "$(docker inspect --format '{{.RestartCount}}' mongolian-bank-cron)" = 0
docker exec mongolian-bank-cron python -c "$TASK_FX_CHECK" "$TASK_FX_SHA"
test "$(docker inspect --format '{{.Id}}' mongolian-bank-api)" = "$TASK_FX_API_ID"
test "$(docker inspect --format '{{.Id}}' mongolian-bank-db)" = "$TASK_FX_DB_ID"
curl -fsS --max-time 15 -o /dev/null -w 'Bank API HTTP: %{http_code}\n' http://127.0.0.1:8000/api/health
curl -fsS --max-time 15 -o /dev/null -w 'NEXAHUB HTTP: %{http_code}\n' https://nexahub.airsales.ub.mn/
printf '%s\n' 'READY: Ханш татагч 3 цагийн хуваарьтай аслаа. API/database контейнерүүд өөрчлөгдөөгүй.'
