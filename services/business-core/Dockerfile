FROM node:22-alpine AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY services/business-core/package.json services/business-core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --workspace @wodana/business-core --include-workspace-root \
    && mkdir -p services/business-core/node_modules

FROM dependencies AS builder
WORKDIR /workspace/services/business-core
COPY services/business-core/tsconfig.json ./
COPY services/business-core/src ./src
RUN npm run build

FROM dependencies AS migrator
WORKDIR /workspace/services/business-core
COPY services/business-core/drizzle.config.ts ./
COPY services/business-core/drizzle ./drizzle
COPY services/business-core/src/database ./src/database
COPY services/business-core/scripts/apply-migrations.mjs ./scripts/apply-migrations.mjs
# Applies every migration not yet recorded (by its journal `when`), so late-merged branches still run.
CMD ["node", "scripts/apply-migrations.mjs"]

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --workspace @wodana/business-core --include-workspace-root

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-dependencies /workspace/node_modules /workspace/node_modules
COPY --from=production-dependencies /workspace/services/business-core/node_modules /workspace/services/business-core/node_modules
COPY --from=production-dependencies /workspace/services/business-core/package.json /workspace/services/business-core/package.json
COPY --from=builder /workspace/services/business-core/dist /workspace/services/business-core/dist
COPY packages/contracts /workspace/packages/contracts
# The Palm Living seed (dist/seed/palm-showcase) reads the tenant's documents from /workspace/docs.
COPY docs/fixtures /workspace/docs/fixtures
COPY docs/projects/palm-living/proposal-kit.json /workspace/docs/projects/palm-living/proposal-kit.json
COPY apps/mobile/assets/brand/palm-living-logo.png /workspace/docs/brand/palm-living-logo.png
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 8000
CMD ["node", "/workspace/services/business-core/dist/main.js"]
