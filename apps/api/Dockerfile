FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS dependencies

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace=apps/api --include-workspace-root

FROM dependencies AS builder
COPY apps/api ./apps/api
WORKDIR /workspace/apps/api
RUN DATABASE_URL=postgresql://127.0.0.1:5432/nexus npm exec -- prisma generate --schema prisma/schema.prisma
RUN npm run build

FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS production-dependencies

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --omit=dev --workspace=apps/api --include-workspace-root

FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS runner

ENV NODE_ENV=production \
    PORT=4000
WORKDIR /workspace
COPY --from=production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=node:node /workspace/apps/api/dist ./apps/api/dist
WORKDIR /workspace/apps/api
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]