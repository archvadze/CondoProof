# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS manifests
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

FROM manifests AS build
RUN npm ci
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN npm run db:generate --workspace apps/api
RUN npm run shared:build
RUN npm run api:build
RUN npm test --workspace apps/api
RUN npm run lint --workspace apps/web
RUN node --experimental-strip-types --test apps/web/scripts/backend-proxy.test.mjs apps/web/scripts/deployment-proxy.test.mjs
RUN npm run web:build

FROM manifests AS api
ENV NODE_ENV=production
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true
RUN npm ci --omit=dev --omit=optional --workspace apps/api --include-workspace-root=false
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
USER node
EXPOSE 3011
CMD ["node", "apps/api/dist/main.js"]

FROM manifests AS web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm ci --omit=dev --workspace apps/web --include-workspace-root=false
COPY --from=build --chown=node:node /app/apps/web/.next ./apps/web/.next
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3010
CMD ["npm", "run", "start", "--workspace", "apps/web", "--", "--hostname", "0.0.0.0", "--port", "3010"]

FROM build AS migrate
ENV NODE_ENV=production
WORKDIR /app/apps/api
USER node
CMD ["npx", "--no-install", "prisma", "migrate", "deploy", "--config", "prisma7.config.ts"]
