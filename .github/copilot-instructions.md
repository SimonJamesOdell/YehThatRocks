# Copilot Instructions — YehThatRocks

## Project overview

YehThatRocks is a rock/metal music video discovery platform. It's a Turborepo monorepo with a single Next.js 16 web app (`apps/web/`) backed by MySQL via Prisma, with shared packages under `packages/`. The database (`yeh`) contains ~140k artists, ~266k YouTube videos, 153 genres, playlists, favourites, chat, and AI-generated tracks.

## Build, lint, and dev commands

```bash
# Dev server (all workspaces via Turbo)
npm run dev

# Dev server (web app only)
npm -w web run dev

# Build
npm run build

# Lint
npm run lint

# Generate Prisma client after schema changes
npm run prisma:generate

# Run ALL regression/invariant verification scripts
npm run verify:invariants

# Run a single verification script
node scripts/verify-core-experience-invariants.js
node scripts/verify-categories-invariants.js
# etc. — each verify:* script in package.json maps to a file in scripts/
```

There are no unit test frameworks (Vitest/Jest) configured. Quality gates are the `verify:*` invariant scripts, which read source files and assert specific strings/patterns exist.

## Architecture

### Monorepo layout

- **`apps/web/`** — Next.js 16 app (App Router, React 19, TypeScript). This is where virtually all application code lives.
- **`packages/config/`** — Shared tsconfig presets (`tsconfig.base.json`, `tsconfig.next.json`).
- **`packages/core/`, `packages/schemas/`, `packages/ui/`, `packages/api-client/`** — Declared in workspaces but currently minimal/empty. Future homes for shared logic.
- **`prisma/`** — Prisma schema and migrations (root-level, shared across the monorepo).
- **`scripts/`** — Node.js maintenance and verification scripts (CommonJS, plain JS).
- **`reference/`** — Legacy assets (old CSS, PHP migration script). Not part of the build.

### Next.js app structure (`apps/web/`)

- **`app/layout.tsx`** — Root layout. Loads two Google Fonts: `Metal Mania` (display/brand, `--font-display`) and `Rajdhani` (body, `--font-body`). Loads the YouTube IFrame API via `<Script>` with `beforeInteractive`.
- **`app/(shell)/`** — Route group wrapping all user-facing pages. The shell layout (`(shell)/layout.tsx`) fetches the initial video and renders `ShellDynamic`, which owns the persistent YouTube player, navigation, chat, and overlay system.
- **`app/(shell)/page.tsx`** — Home route. Returns `null` — the player IS the home page.
- **`app/api/`** — All API routes, organised by domain: `auth/`, `favourites/`, `playlists/`, `search/`, `videos/`, `artists/`, `categories/`, `chat/`, `ai/`, `status/`, `users/`, `current-video/`.
- **`components/`** — Client and server React components. Flat directory, no nesting. Files are kebab-case and descriptive (e.g., `player-experience.tsx`, `shell-dynamic.tsx`).
- **`lib/`** — Server-side utilities and business logic. Flat directory, kebab-case files.

### The shell and overlay pattern

The app uses a persistent player shell. Route pages (categories, artists, top100, playlists, etc.) render as overlays on top of the always-visible video player. The `ShellDynamic` component manages this, and the current video state is maintained across navigation. The URL parameter `?v=<videoId>` drives which video plays.

### Data source fallback

`lib/catalog-data.ts` implements a dual-source pattern: it tries the MySQL database first and falls back to seed data from `lib/catalog.ts` (hardcoded sample records) when `DATABASE_URL` is not configured or the database is unreachable. This allows the app to render without a database connection.

## Key conventions

### API route pattern

Every API route handler follows this sequence:

1. **Auth check** — `requireApiAuth(request)` returns `{ ok, auth }` or `{ ok: false, response }`. Use the discriminated union pattern to bail early.
2. **CSRF** — Mutating endpoints call `verifySameOrigin(request)` and return the error response if non-null.
3. **Body parsing** — `parseRequestJson(request)` returns a discriminated `{ ok, data }` or `{ ok: false, response }`.
4. **Validation** — Zod schema `.safeParse()` on the parsed body. Schemas live in `lib/api-schemas.ts`.
5. **Rate limiting** — Sensitive endpoints (auth) use `rateLimitOrResponse()` which returns a 429 response or null.
6. **Response** — Always `NextResponse.json(...)`.

### Authentication

- Custom JWT auth using the `jose` library (not NextAuth).
- Access tokens (15 min) + refresh tokens (30/90 days) stored in httpOnly cookies (`ytr_access`, `ytr_refresh`).
- Passwords hashed with `bcryptjs`.
- `proxy.ts` acts as middleware: it verifies access tokens on protected API routes and injects `x-auth-user-id` / `x-auth-user-email` headers for downstream handlers.
- Auth events are recorded to `auth_audit_logs` via `recordAuthAudit()`.
- Server components use `getCurrentAuthenticatedUser()` from `lib/server-auth.ts` to check login state.

### Prisma conventions

- Single shared `prisma` instance in `lib/db.ts` with hot-reload safety (`global.__yehPrisma__`).
- Schema uses `@@map()` to map PascalCase models to existing snake_case MySQL table names.
- Model fields use camelCase with `@map()` to snake_case column names where needed.
- Connection pooling is auto-tuned based on worker count in production.

### TypeScript

- Strict mode enabled. Target ES2022.
- Path alias: `@/` maps to `apps/web/` root (e.g., `@/lib/db`, `@/components/player-experience`).
- No `allowJs` — all app code is TypeScript (scripts in `scripts/` are plain JS/CommonJS).

### CSS

- Plain CSS in `app/globals.css` — no Tailwind despite being mentioned in the spec. Class names use camelCase (e.g., `serviceFailureScreen`, `shellOverlayRoute`, `railTabs`).

### Verification / invariant scripts

- Located in `scripts/verify-*.js`. These are CommonJS Node.js scripts that read source files and assert specific strings exist, ensuring critical UI and API patterns aren't accidentally removed.
- Run them after any meaningful change: `npm run verify:invariants` (or individually).
- There are also `verify:*:api` scripts that make HTTP requests against a running dev server.

### Environment variables

Required in `apps/web/.env.local` (see `.env.example` at root):
- `DATABASE_URL` — MySQL connection string (database name: `yeh`)
- `AUTH_JWT_SECRET` — 32+ character random secret
- `APP_URL`, `YOUTUBE_DATA_API_KEY`, `GROQ_API_KEY`, SMTP settings are optional/feature-dependent.

## Important notes

- The YouTube IFrame API script is loaded globally at the root layout level — do not lazy-load or duplicate it.
- The video player must never be unmounted during navigation — the shell/overlay architecture exists specifically for this.
- Database table names are legacy snake_case; always use `@@map()` in Prisma when adding new models.
- Fonts: `Metal Mania` is the brand identity font for headings; `Rajdhani` is the body font. Both are loaded via `next/font/google`.
