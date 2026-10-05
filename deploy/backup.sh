#!/usr/bin/env bash
# watERPax nightly backup — pg_dump from waterpax-postgres-1
# Local dump always runs; encrypted copy uploaded to Cloudflare R2 when configured.
# Cron (deploy user): 0 2 * * *
set -euo pipefail

BACKUP_DIR="/home/deploy/waterpax/backups"
RETENTION_DAYS=14
CONTAINER="waterpax-postgres-1"
DB_USER="waterpax"
DB_NAME="waterpax"
KEYFILE="/home/deploy/waterpax/.backup_key"
R2_BUCKET="waterpax"

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

# Retention: delete local dumps older than RETENTION_DAYS
find "$BACKUP_DIR" -name 'waterpax_*.sql.gz' -mtime +$RETENTION_DAYS -delete

# Offsite: encrypt and upload to R2; failure keeps the local dump and exits nonzero
if [ ! -s "$KEYFILE" ] || [ ! -f "$HOME/.config/rclone/rclone.conf" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') WARN: offsite not configured (missing key/rclone config) - local only"
elif ! rclone lsd "r2:$R2_BUCKET" >/dev/null 2>&1; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: R2 bucket r2:$R2_BUCKET unreachable - offsite backup failed"
  exit 1
else
  ENC="$OUT.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -pass file:"$KEYFILE" -in "$OUT" -out "$ENC"
  if rclone copy "$ENC" "r2:$R2_BUCKET/" >> "$BACKUP_DIR/backup.log" 2>&1 \
     && rclone ls "r2:$R2_BUCKET/$(basename "$ENC")" >/dev/null 2>&1; then
    rm -f "$ENC"
    rclone delete "r2:$R2_BUCKET" --min-age 30d --quiet >> "$BACKUP_DIR/backup.log" 2>&1 || true
    echo "$(date '+%Y-%m-%d %H:%M:%S') UPLOADED r2:$R2_BUCKET/$(basename "$ENC")"
  else
    echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: R2 upload failed - local dump retained: $ENC"
    exit 1
  fi
fi
