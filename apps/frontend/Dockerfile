# watERPax frontend image.
# Build context is the REPO ROOT (needs packages/types for the workspace build):
#   docker build -f apps/frontend/Dockerfile .

# ---- build stage ----
FROM node:20-bookworm-slim AS build

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

COPY apps/frontend apps/frontend
# No VITE_API_URL set on purpose: the app calls relative /api,
# which the nginx runtime below proxies to the backend container.
RUN npm run build --workspace @waterpax/frontend

# ---- runtime stage: static SPA + /api reverse proxy ----
FROM nginx:1.27-alpine

COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

EXPOSE 80
