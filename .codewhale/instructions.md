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

## Ship gate (cross-reference)

The full release preparation gate is defined in `.github/copilot-instructions.md`
under "Release preparation". The user runs the `ship` command themselves.
The agent may assist with preparation steps (invariants, dependency maintenance,
audit) but must never execute the final commit, push, or deploy.
