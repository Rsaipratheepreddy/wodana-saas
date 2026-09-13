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
CMD ["npm", "run", "db:migrate"]

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
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 8000
CMD ["node", "/workspace/services/business-core/dist/main.js"]
