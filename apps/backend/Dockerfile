# watERPax backend image.
# Build context is the REPO ROOT (needs packages/types for the workspace build):
#   docker build -f apps/backend/Dockerfile .

# ---- build stage ----
FROM node:20-bookworm-slim AS build

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace manifests first for layer-cached installs
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/types/package.json packages/types/
RUN npm ci

# types must build before any tsc (workspaces discovery order, not topological)
COPY packages/types packages/types
RUN npm run build --workspace @waterpax/types

COPY apps/backend apps/backend
RUN cd apps/backend \
    && npx prisma generate \
    && npm run build

# ---- runtime stage ----
FROM node:20-bookworm-slim AS runtime

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app/apps/backend

# Hoisted node_modules carries the Prisma query engine + generated client,
# plus the prisma CLI and tsx needed by migrate deploy / db seed.
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages/types/package.json /app/packages/types/package.json
COPY --from=build /app/packages/types/dist /app/packages/types/dist
COPY --from=build /app/apps/backend/package.json package.json
COPY --from=build /app/apps/backend/dist dist
COPY --from=build /app/apps/backend/prisma prisma

COPY apps/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["docker-entrypoint.sh"]
