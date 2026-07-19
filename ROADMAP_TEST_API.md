# Roadmap: `npm run test:api`

## Goal

One command that starts the Next.js production server, runs the full API smoke
suite against it, and reports pass/fail. Reliable because it's simple — no
Docker introspection, no MySQL ping, no pool warmup, no instrumentation hooks.

## Deliverable

A single PowerShell script: `scripts/test-api.ps1`

## Script behaviour

### Phase 1 — Build (skippable)

If `-SkipBuild` is not set and no standalone server exists at
`apps/web/.next/standalone/apps/web/server.js`, run:

```
npm run build
```

### Phase 2 — Start server

1. Read `DATABASE_URL` and `AUTH_JWT_SECRET` from the current environment.
   If either is missing, read it from `apps/web/.env.local` (dotenv-format:
   `KEY=value`). Fail immediately if either is still missing.
2. Start the standalone server as a background process:

```
node apps/web/.next/standalone/apps/web/server.js
```

   With these environment variables set in the child process:
   - `NODE_ENV=production`
   - `HOSTNAME=127.0.0.1`
   - `PORT=<port>` (default 3100)
   - `DATABASE_URL=<resolved>`
   - `AUTH_JWT_SECRET=<resolved>`
   - `NEXT_PUBLIC_DISABLE_DESKTOP_INTRO=1` (avoids intro overlay in test)

   Capture the process ID so it can be killed later.

### Phase 3 — Wait for readiness

Poll `GET http://127.0.0.1:<port>/api/status` every 500ms.
- If the server returns 2xx, proceed.
- If the server hasn't started within the timeout (default 30s), fail with the
  last error.
- Use `Invoke-WebRequest -UseBasicParsing -TimeoutSec 2` for each poll.
  Catch and retry on any error (connection refused, timeout, non-2xx).

### Phase 4 — Run API tests

Run these scripts in order, passing `--base-url=http://127.0.0.1:<port>`:

1. `node scripts/verify-core-experience-api-smoke.js --base-url=...`
2. `node scripts/verify-new-videos-api-smoke.js --base-url=...`
3. `node scripts/verify-playlists-api-smoke.js --base-url=...`
4. `node scripts/verify-auth-api-smoke.js --base-url=...`
5. `node scripts/verify-categories-invariants.js --check-api --base-url=...`

Each script already exits 0 on pass and 1 on failure.

By default, stop on the first failure (`-StopOnFirstFailure`). Optional flag
`-RunAll` runs every test and reports a summary at the end.

### Phase 5 — Stop server and report

1. Kill the server process (`Stop-Process -Id <pid> -Force`).
2. Print summary: each test name and pass/fail.
3. Exit 0 if all passed, 1 if any failed.

## Parameters

| Parameter | Default | Description |
|---|---|---|
| `-Port` | `3100` | Port for the test server |
| `-SkipBuild` | `$false` | Skip `npm run build`, use existing standalone |
| `-RunAll` | `$false` | Run all tests even after a failure |
| `-TimeoutSeconds` | `30` | Server readiness timeout |

## npm script (add to root `package.json`)

```json
"test:api": "pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/test-api.ps1"
```

## Integration into ship

### Root `package.json`

Add `test:api` to `prepare:ship:full` so it runs before the audit step.
The updated script should read:

```json
"prepare:ship:full": "npm run maintain:deps && npm run verify:invariants && npm run verify:invariants:api && npm run test:api && npm audit --audit-level=high"
```

### `ship.cmd`

No changes needed — `ship.cmd` already calls `prepare:ship:full` through
`npm run ship:full`. The regular-mode block in `ship.cmd` was already
simplified in the previous cleanup and only runs `npm audit` as a pre-check.

### `deploy/ship-local.ps1`

Already calls `npm run prepare:ship:full` — no changes needed.

## What this does NOT do

- Does not check if MySQL is running. If the database is unreachable, the
  server will fail to start and the readiness poll will time out with a clear
  error message.
- Does not warm the Prisma pool. The first request does that naturally,
  and if it fails, the API test reports the failure.
- Does not inspect Docker containers or run `mysqladmin`.
- Does not have an instrumentation.ts file.
- Does not manage stale processes or port conflicts. If port 3100 is in use,
  the script fails immediately with a clear message telling the user what to
  kill.

## Verification

After building, test with:

```
npm run test:api
```

Expected output in the happy path:

```
[build] starting
[build] done
[start:test-server] starting
Server PID: 12345
Waiting for http://127.0.0.1:3100 ...
API ready after 4.2s
[start:test-server] done
[test:core-experience-api] starting
[test:core-experience-api] done
[test:new-videos-api] starting
[test:new-videos-api] done
[test:playlists-api] starting
[test:playlists-api] done
[test:auth-api] starting
[test:auth-api] done
[test:categories-api] starting
[test:categories-api] done
[stop:test-server] Server process 12345 stopped.
=== Results ===
  Pass: verify-core-experience-api-smoke.js
  Pass: verify-new-videos-api-smoke.js
  Pass: verify-playlists-api-smoke.js
  Pass: verify-auth-api-smoke.js
  Pass: verify-categories-invariants.js
All 5 tests passed.
```

## Estimated size

~80 lines of PowerShell. The old system was ~1,200 lines across 8 files.
