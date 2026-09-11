# CodeWhale Instructions — YehThatRocks

## Deployment boundary (non-negotiable)

Deployment is a **manual, local-only process**. The agent must never modify,
automate, or trigger any part of the deployment flow. This includes but is
not limited to:

- All files under `deploy/`
- `.github/workflows/publish-web-image.yml`
- `.github/workflows/auto-update-deps.yml`
- `docker-compose.prod.yml`
- `Dockerfile`
- `docker/entrypoint.sh`
- `deploy/systemd/`

**Rules:**

1. Never add, remove, or modify CI/CD triggers (push, schedule, workflow_dispatch) in any workflow file.
2. Never add build steps, verification jobs, or automation to the publish workflow.
3. Never run `npm run build` or `npm run ship:*` — the user invokes those locally.
4. Never run `deploy/deploy-prod-hot-swap.sh` or any script under `deploy/`.
5. Never suggest re-enabling auto-build or auto-deploy. The user has explicitly
   disabled these and wants builds triggered only at their terminal.
6. If the user asks about deployment reliability, investigate the code being
   deployed (build errors, type errors, chunk instability) — not the pipeline.
   The pipeline is deliberately manual.

## Commit and push (allowed)

The agent may commit and push verified changes when the user asks it to. This
permission is scoped to `git commit` and `git push` of work that is complete and
has passed the relevant verification (invariant scripts / type checks). It does
not extend the deployment boundary above: builds (`npm run build`), ship scripts
(`npm run ship:*`), CI/CD, and deploy scripts remain manual and user-triggered.

- Only commit after the requested change is complete and verified.
- Use a clear, conventional commit message.
- Push to the configured `origin` remote.

## Live database restore

When the user asks to download the live database and set it up locally,
run the existing script — do NOT manually dump/download/import:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File run_live_restore_diag.ps1
```

On Linux (no pwsh), use the bash port instead:

```bash
./run_live_restore_diag.sh
```

This script handles the full workflow: SSH dump with `--skip-triggers` (avoids
DELIMITER issues), scp download, `docker cp` into the container, drop/recreate
`yeh` database, import via `SOURCE`, and verification diagnostics.

Key lessons encoded in this script:
- Use `--skip-triggers` on `mysqldump` — trigger `DELIMITER ;;` blocks cannot
  be piped through non-interactive `mysql` clients.
- Use `docker cp` + `SOURCE` instead of piping (`type | docker exec -i`) —
  long INSERT lines get silently truncated through pipes on Windows.
- `--single-transaction` can silently skip certain InnoDB tables; the script
  verifies counts afterward (videos, site_videos).

## Production server access (SSH)

The production server can be reached over SSH:

```bash
ssh root@206.189.122.114
```

**Only use this when the user explicitly grants permission** for the specific
task at hand — e.g. inspecting live logs, running read-only diagnostic SQL
against the production database, or checking the dashboard-cache maintenance
schedule. Do not treat this note as standing permission to SSH in; confirm
permission each session before connecting.

Useful production context once connected:
- Admin dashboard traffic data is computed by `scripts/maintain-admin-dashboard-cache.mjs`,
  which must be running as a scheduled job on the server (cron or a systemd
  timer). Check `crontab -l` and systemd timers to see how it is scheduled.
- The production database is MySQL/MariaDB (the app uses the
  `@prisma/adapter-mariadb` adapter). Prefer read-only queries unless the user
  explicitly authorizes writes.
- Live analytics tables: `analytics_events`, `auth_audit_logs`,
  `magazine_article_external_landings`; rollups: `admin_dashboard_analytics_daily`,
  `admin_dashboard_analytics_hourly`, `admin_dashboard_auth_hourly`; cache:
  `admin_dashboard_cache`.

## Prisma and dev workflow

- After importing a live database or changing `prisma/schema.prisma`, run
  `npx prisma generate` to regenerate the Prisma client.
- Start the dev server with `npm -w web run dev` (or `npm run dev` for all
  workspaces). The Docker MySQL container must be running first:
  `docker compose up -d db`.
- The `.env.local` at `apps/web/.env.local` needs `DATABASE_URL` pointing at
  the local Docker MySQL (default: `mysql://yeh:yehthatrocks@localhost:3307/yeh`).
- Stale manual dumps (`yeh_live_import.sql`, `yeh_live_import_clean.sql` in the
  repo root) are snapshots and may be out of date. Always use
  `run_live_restore_diag.ps1` to pull the current live database.

## Invariant verification

After any meaningful code change, run the invariant verification suite:

```bash
npm run verify:invariants
```

These are CommonJS scripts in `scripts/verify-*.js` that assert critical UI and
API patterns haven't been accidentally removed. There are no unit test
frameworks (Vitest/Jest) configured — the invariant scripts are the quality
gate. Run them before calling any task complete.

## Prisma migration safety

The project has a three-layer migration validation system to prevent P3018
"Duplicate key name" deployment failures. See `DEPLOYMENT_ROBUSTNESS_COMPLETE.md`
for the full design.

When working with Prisma migrations:
- Never manually edit migration SQL files that were auto-generated by Prisma
  without also updating the corresponding `schema.prisma`.
- If a migration fails locally with a duplicate key error, it will also fail
  in production. Fix the underlying schema issue rather than force-applying.
- `prisma migrate dev` creates a new migration; `prisma migrate deploy`
  applies pending migrations. The agent should never run `prisma migrate deploy`
  — that's a production-only operation.

## Ship gate (cross-reference)

The full release preparation gate is defined in `.github/copilot-instructions.md`
under "Release preparation". The user runs the `ship` command themselves.
The agent may assist with preparation steps (invariants, dependency maintenance,
audit) and may commit and push verified changes when asked to (see
"Commit and push (allowed)" above). The agent must never run the build, ship,
CI/CD, or deploy steps itself — those remain user-triggered.
