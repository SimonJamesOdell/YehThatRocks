# Internal Trust Defense Plan — replacing Cloudflare bot-fight mode

**Goal:** Unseen (cold) clients are challenged before they can act; clients with
high accumulated evidence of being human are never challenged. Collected trust
data is persisted so reputation survives restarts and redeploys. Cloudflare
bot-fight mode is turned off once this is live and observed; the Cloudflare proxy
stays for DNS/TLS and network-layer absorption.

**Status:** Plan — finalized, awaiting implementation.

---

## Locked decisions

1. **Keep the Cloudflare proxy** (disable only the bot-fight feature). No grey-cloud.
   Phase 5 nginx hardening is therefore recommended-but-not-blocking; it still
   hardens against the case where CF is bypassed or headers are absent.
2. **Visible interstitial** — a simple, elegant on-brand modal for action-level
   challenges, plus a full-page `/challenge` route for attack mode. Both reuse the
   existing design tokens (dark `#080808` background, blood-red `#b31214` accent,
   `Segoe UI`, pill-shaped action chips, `--ui-modal-*` tokens).
3. **Sensitive endpoints** — decided from a full scan of the API surface (below).
4. **Retention: 180 days** for reputation rows.

---

## Current state (verified in code)

- `apps/web/lib/trust.ts` — `assessHumanTrust()` evidence channels: authenticated,
  proof-of-work cookie `ytr_botok`, warm IP activity. The gate is enforced on exactly
  one endpoint today (`/api/videos/unavailable`); three others only record benign
  activity (`/api/videos/top`, `/api/categories/top-level-cards`,
  `/api/magazine/latest`).
- `/api/bot-challenge` — SHA-256 proof-of-work (18 leading zero bits), 7-day
  `ytr_botok` httpOnly cookie. `bot-challenge-solver.tsx` silently solves for every
  visitor on page load. The player already has a reactive bot-block flow for the
  `videos/unavailable` gate.
- `lib/rate-limit.ts` — in-memory per-IP + shared buckets. `getClientIp()` prefers
  `CF-Connecting-IP`, then first hop of `X-Forwarded-For`.
- `lib/crawler-guard.ts` + `lib/cf-headers.ts` — UA blocklists and CF score
  extraction (scores only arrive on paid CF plans; bot-fight forwards nothing).
- Prisma `User` has `emailVerifiedAt`, `createdAt`, `isAnonymous`. No
  client-reputation table exists.

### Scan result: the mutating surface is already auth-gated

Every `POST/PATCH/DELETE` route was enumerated. With the exception of
`auth/register` and `auth/anonymous`, every mutating endpoint requires an
authenticated session via `getCurrentAuthenticatedUserAuthState` / `requireApiAuth`:

- Forum create thread / reply / vote — authenticated
- Chat send — authenticated
- Magazine comments — authenticated (+ moderation)
- Video flags, search flags, video suggest — authenticated
- Favourites, playlists (create/import), hidden-videos, watch-history, all
  `*-preferences` — authenticated
- Admin surface — authenticated + admin role

**Open (anonymous-reachable) mutating endpoints:**
- `POST /api/auth/register` — create an email account
- `POST /api/auth/anonymous` — create an anonymous account
- `POST /api/auth/login` — credential check (already rate-limited per email)

Consequence: the bot-fight replacement's primary job at action level is
**account creation**, not the whole spam surface — spam endpoints already demand
a session. The trust model therefore has two jobs: (1) make obtaining a session
cost something, and (2) keep auto-registered sessions low-confidence so they can
never become the "trusted humans" who skip checks.

---

## Trust tiers

- **TIER 3 — trusted human (never challenged):** authenticated session AND
  (`emailVerifiedAt != null` OR account age ≥ 7 days) AND not flagged. Normal rate
  limits only; no PoW, no interstitial. Guaranteed by short-circuiting before any
  challenge check.
- **TIER 2 — evidenced client (no challenge needed):** valid `ytr_botok` cookie OR
  warm IP activity (≥ 2 benign requests spanning ≥ 2 minutes, within 30 minutes).
  Authenticated but *fresh/unverified* accounts are also tier 2 — a session alone
  is not enough to skip checks.
- **TIER 1 — cold client (challenged before acting):** no evidence. Public reads
  are served freely (that is how evidence accrues); account creation requires the
  PoW interstitial.
- **TIER 0 — blocked/flagged:** obvious bot UA, persistent denials, or admin flag.
  Account creation rejected outright; heavy rate limits.

The change from today: **`authenticated` no longer implies tier 3.** It implies
"has a session" only; the session owner earns tier 3 via verified email or age.
This closes the "bot registers a throwaway account and is then instantly trusted"
hole without touching legitimate returning users.

---

## Phase 1 — Persist trust data

New Prisma model, created via `prisma migrate dev` + `npx prisma generate`:

```prisma
model ClientReputation {
  id            Int      @id @default(autoincrement())
  ipHash        String   @unique @db.VarChar(64)   // sha256(ip), reusing hashClientIp
  firstSeenAt   DateTime @default(now()) @map("first_seen_at")
  lastSeenAt    DateTime @default(now()) @map("last_seen_at")
  benignHits    Int      @default(0) @map("benign_hits")
  warmAt        DateTime? @map("warm_at")
  powSolvedAt   DateTime? @map("pow_solved_at")
  powSolves     Int      @default(0) @map("pow_solves")
  deniedCount   Int      @default(0) @map("denied_count")
  lastDeniedAt  DateTime? @map("last_denied_at")
  flagged       Boolean  @default(false)
  flagReason    String?  @db.VarChar(255) @map("flag_reason")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@map("client_reputations")
}
```

Rules:

- Keyed by IP hash (pseudonymous, stable across restarts, never exposed to clients).
- **Transition-only, batched writes.** Persist `firstSeenAt`, `warmAt` crossing,
  `powSolvedAt`, and denials — not every benign hit. The in-memory `BoundedMap` in
  `trust.ts` stays the synchronous read source and is hydrated lazily per IP.
- **Prune:** rows older than 180 days, following the existing `/api/cron` pattern.
- Migration safety: `prisma migrate dev` only; never hand-edit generated SQL
  (repo has a documented P3018 history).

## Phase 2 — Tier computation + gate helper

- `lib/trust-tier.ts` — `computeAccountTier(auth, user)` → 3/2/1/0 using
  `emailVerifiedAt`, `createdAt`, `isAnonymous`, and `ClientReputation.flagged`.
  Callers that already load the user pass the fields; no extra query on the hot path.
- Extend `assessHumanTrust()` to return a tier (keep the existing three-reason API
  for backward compatibility) and consult persisted reputation for warm + flagged.
- `lib/require-human-trust.ts` — one helper for every protected endpoint:

```ts
export function requireHumanTrustOrResponse(
  request: NextRequest,
  auth: AuthContext | null,
  options: { minimumTier: 1 | 2 | 3 }
): NextResponse | null
// returns 403 { code: "TRUST_REQUIRED", minimumTier } or null
```

## Phase 3 — Gate account creation + the visible interstitial

**Server:**
- `POST /api/auth/register` → `requireHumanTrustOrResponse(..., { minimumTier: 2 })`
- `POST /api/auth/anonymous` → same.
- `POST /api/auth/login` stays rate-limited per email (no interstitial — login users
  are, by definition, not yet evidenced, and per-email throttle already caps
  credential stuffing; flag this for owner veto).
- All other mutating endpoints stay authenticated + rate-limited; no interstitial,
  because the session gate already precedes them.

**Client — the interstitial (on-brand, simple):**
- `components/trust-challenge-interstitial.tsx` — a modal overlay reusing
  `--ui-modal-*` tokens: dark radial-gradient panel, blood-red pill button, a single
  line of copy ("One quick check to prove you're human"), a subtle progress state.
  On `403 { code: "TRUST_REQUIRED" }` from a gated fetch, it solves the PoW
  (existing `solveNonce` logic extracted for reuse), posts to `/api/bot-challenge`,
  and retries the original action once.
- The existing `bot-challenge-solver.tsx` is retained for warming/background solves
  but stops solving for clients that are already authenticated (tier 3 pays nothing).
- Full-page `/challenge` route using the same visual language, reserved for attack
  mode (Phase 4).

## Phase 4 — Attack mode + adaptive difficulty

- `ATTACK_MODE` env flag. When ON, `proxy.ts` redirects cold clients (tier 1, no
  cookie, no warm record) to `/challenge` before serving any page; tier 2/3 pass
  through. This is the internal "I'm under attack" lever, flipped only during an
  active swarm.
- Adaptive difficulty: `/api/bot-challenge` returns the required difficulty in its
  response and the solver honours it. Default 18 bits; raise to 20–22 when deny
  rate spikes (observable from persisted `deniedCount`).

## Phase 5 — IP hardening (recommended, not blocking while CF proxy stays)

- nginx (`DEPLOY_VPS.md`): overwrite `X-Forwarded-For` with `$remote_addr` instead
  of appending — nginx is the sole ingress, and appending lets a direct attacker
  spoof XFF values to rotate past per-IP limits. Update the doc.
- `getClientIp()` precedence: `CF-Connecting-IP` → `X-Real-IP` → `X-Forwarded-For`.

## Phase 6 — Verification & observability

- Unit tests (vitest): `trust-tier.test.ts`, `reputation-persistence.test.ts`,
  `require-human-trust.test.ts`.
- Route tests: cold client → 403 `TRUST_REQUIRED` on register/anonymous; warm/PoW
  cookie and tier-3 auth → pass.
- Invariant script `scripts/verify-trust-gate-invariants.js` asserting the gate is
  wired into the account-creation endpoints, added to the `verify:*` chain in
  `package.json`. Run `npm run verify:light` and `npm run verify:auth` before ship.
- Observability: trust decisions persist as data (`deniedCount`, `powSolves`,
  `warmAt`). Minimum: structured log lines for denials (reason + endpoint); a
  small admin-dashboard trust-stats panel as follow-up.

## Rollout order (safe turn-off of bot-fight)

1. Land Phases 1–3 while bot-fight is ON. The gate is additive: worst case a cold
   human pays ~1s PoW once, then is never challenged again.
2. Observe denial stats for a week; confirm no false-positive reports.
3. Disable bot-fight in the Cloudflare dashboard; keep the proxy. Monitor 403/429
   rates and error spikes.
4. Flip `ATTACK_MODE` only if a swarm appears.
5. Rollback lever: re-enable bot-fight, or set `TRUST_GATE_DISABLED=1`.

## Honest limits

Global IP reputation, datacenter/proxy ASN detection, TLS/JA3 fingerprinting, and
network-layer flood absorption are edge properties and not reproducible in app
code. Keeping the Cloudflare proxy (bot-fight feature off) retains those, while the
internal trust model owns who gets challenged — the intended division of labour.

## Final decisions (locked)

- **Login stays interstitial-free** — per-email rate limit only.
- **Account-creation interstitial triggers on registration-flow start** — when an
  anonymous visitor opens the register flow (not only on the 403 response). The
  client pre-solves PoW as the flow opens so the actual submit never fails.
