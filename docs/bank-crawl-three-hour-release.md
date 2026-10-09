# FX collector three-hour rollout — runtime accepted 9 October 2026

User supplies successful transfer hashes, private source backup, source SHA256
3684d0ab76412d13f3c0fbba7635a16a1a3dbe9ec7dbd09ed745e577c8dc503f,
complete cron image build, offline/source checks, recreated cron/runtime check,
API/DB unchanged guards (final READY), bank API HTTP200 and NEXAHUB HTTP200.
Backup: /var/backups/nexahub-fx-3h-pUQofc/cron.py.before. Buildx/Bake warning
was nonblocking in this supplied run. Schedule rollout accepted; actual scheduled
bank collection/feed timestamp acceptance remains pending, not inferred from
health or source checks. No immediate/manual crawl was requested by helper.

Confirmed VPS: project /opt/mongolbank-rates/docker-compose.yml; service cron,
container mongolian-bank-cron, image mongolbank-rates-cron, UTC. Source
scripts/cron.py:42 is schedule.every().day.at(run_at).do(...). Existing API and
PostgreSQL containers stay untouched. This is NOT a NEXAHUB production release.

scripts/set-bank-crawl-interval.mjs changes only the inspected schedule chain,
preserving callback arguments, UTF-8 content, source owner/mode and other code.
It validates Python AST (without importing or running crawlers), requires exactly
one three-hour registration plus a run_pending loop polling within 60 seconds,
and saves a private original outside Docker build context. Unknown source fails
closed before editing. Re-running is idempotent. If any guard fails, STOP and
inspect the issue; do not bypass guards or reset data.

scripts/deploy-bank-crawl-interval.sh validates existing compose build target,
backs up the old image tag, invokes the source updater, builds only cron,
checks baked source checksum and Python syntax/schedule dependency in a separate
network-disabled container, then recreates only cron with --no-deps --no-build.
It requires running/restart count0 and identical API/DB container IDs afterward,
then reads bank health and portal HTTP status. Does not expose environment or
invoke admin crawl/backfill APIs. Build failures leave the old running cron
untouched; the private source backup and old image tag are retained for recovery.
If post-recreation checks fail, source/image backups exist but automatic rollback
has not been implemented. Never label a failed block READY.

Six targeted safety/transform/Python AST tests and full Node24 suite 295/295
pass locally (optional Python check enabled via bundled runtime). Local Git Bash
syntax-only launch was denied by the Windows sandbox; run bash -n on the VPS
before deployment (user's successful block now confirms it passed). Full
collector source is not present locally; do
not claim a real bank crawl has succeeded based on code/health alone.

Interval starts three hours after registration and reschedules after a job; long
crawls can delay the next run. UTC does not change elapsed-hour intervals. This
does not guarantee a bank publishes a new rate every three hours. New invoices
use the new feed after successful collection/portal cache refresh; frozen invoice
rates remain immutable. No 0.5 spread is applied.

References: [Schedule interval examples](https://schedule.readthedocs.io/en/stable/examples.html#run-a-job-every-x-minute),
[Compose targeted up/no-deps](https://docs.docker.com/reference/cli/docker/compose/up/).
