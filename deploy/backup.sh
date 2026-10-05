#!/usr/bin/env bash
# watERPax nightly backup — pg_dump from waterpax-postgres-1
# Installed for deploy user cron: 0 2 * * *
set -euo pipefail

BACKUP_DIR="/home/deploy/waterpax/backups"
RETENTION_DAYS=14
CONTAINER="waterpax-postgres-1"
DB_USER="waterpax"
DB_NAME="waterpax"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/waterpax_${STAMP}.sql.gz"
TMP="$OUT.part"

# Dump + compress atomically; verify gzip integrity before renaming
docker exec "$CONTAINER" pg_dump -U "$DB_USER" --no-owner "$DB_NAME" | gzip > "$TMP"
gzip -t "$TMP"
[ -s "$TMP" ]
mv "$TMP" "$OUT"

echo "$(date '+%Y-%m-%d %H:%M:%S') OK $OUT ($(du -h "$OUT" | cut -f1))"

# Retention: delete dumps older than RETENTION_DAYS
find "$BACKUP_DIR" -name 'waterpax_*.sql.gz' -mtime +$RETENTION_DAYS -delete
