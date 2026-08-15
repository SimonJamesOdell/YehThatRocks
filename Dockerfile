FROM node:22-alpine AS base

# --- Builder (deps + build merged to avoid large inter-stage COPY) ---
FROM base AS builder
WORKDIR /app

# Copy package manifests first for layer caching
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
 
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-factor 2 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-timeout 300000 && \
    for attempt in 1 2 3; do \
        echo "[deps] npm ci attempt ${attempt}/3"; \
        npm ci --ignore-scripts --no-audit --no-fund && break; \
        if [ "$attempt" -eq 3 ]; then \
            echo "[deps] npm ci failed after 3 attempts"; \
            exit 1; \
        fi; \
        echo "[deps] transient npm failure, cleaning cache and retrying..."; \
        npm cache clean --force || true; \
        sleep 5; \
    done

COPY . .
RUN npx prisma generate
# Build resource knobs, overridable per target.
# - Local dev box (32 GB / 16 threads): large heap + high concurrency for speed.
# - VPS (2 GB / 1 core): small heap + serial concurrency so the build cannot
#   starve mysqld/nginx or trigger the host OOM killer.
# - CI (GitHub Actions, 16 GB): uses the defaults below unchanged.
ARG NODE_MAX_OLD_SPACE_SIZE=3072
ARG TURBO_CONCURRENCY=1
ENV NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}"
RUN TURBO_CONCURRENCY=${TURBO_CONCURRENCY} npm run build

# --- Runner ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --chown=nextjs:nodejs docker/seed.sql /app/prisma/seed.sql
COPY --chown=nextjs:nodejs docker/migrate-baseline.js /app/docker/migrate-baseline.js

COPY docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "apps/web/server.js"]