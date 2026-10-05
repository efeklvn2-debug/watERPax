#!/bin/sh
set -e

echo "[entrypoint] applying migrations..."
npx prisma migrate deploy

echo "[entrypoint] seeding (idempotent upserts)..."
npx prisma db seed

echo "[entrypoint] starting waterpax-backend on port ${PORT:-3001}..."
exec node dist/index.js
