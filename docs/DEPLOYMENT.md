# watERPax Deployment (Docker) — Server Checklist

One-time setup + routine deploys for `waterpax.com.ng` on the Hetzner VPS
(`46.224.0.165`). FlexoPrint (`phlexerp-backend` PM2 :3000, DB `flexoprint`,
`phlexerp.com.ng`) is **never touched** by anything below.

## Architecture

```
Cloudflare (waterpax.com.ng, orange-cloud)
  └─ host nginx :443 TLS (certbot)      ← shared with phlexerp.com.ng vhost
       └─ 127.0.0.1:8088                ← web container (static SPA + /api proxy)
            ├─ backend container :3001  ← migrate deploy + seed on start
            └─ postgres container (pgdata volume, DB waterpax)
```

Deploy artifacts are Docker images built by CI (`.github/workflows/docker.yml`,
pushed to GHCR on every merge to `master`). The server never installs Node,
PM2, or Prisma for watERPax — the image carries its own.

## One-time server setup

### 1. Install Docker (Debian)

```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

### 2. Prepare the deploy directory

```bash
mkdir -p /home/deploy/waterpax   # separate from /home/deploy/app (FlexoPrint)
# copy deploy/docker-compose.yml and create deploy/.env there (see step 3)
```

Copy `deploy/docker-compose.yml` from the repo to
`/home/deploy/waterpax/docker-compose.yml`, then:

```bash
cp deploy/.env.example /home/deploy/waterpax/.env   # from repo, or create by hand
nano /home/deploy/waterpax/.env
```

Fill in (all required — compose fails fast if missing):
- `BACKEND_IMAGE` / `WEB_IMAGE`: `ghcr.io/<owner>/<repo>-backend:latest` and
  `ghcr.io/<owner>/<repo>-web:latest` (lowercase owner/repo, matching the repo)
- `POSTGRES_PASSWORD`, `JWT_SECRET` (64+ random chars), `ADMIN_PASSWORD`
- `CORS_ORIGIN=https://waterpax.com.ng`, `COOKIE_SECURE=true`

Generate secrets locally with: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

### 3. GHCR access

The GitHub Actions `GITHUB_TOKEN` pushes images; they are private by default.
On the server, log in with a PAT that has `read:packages`:

```bash
echo "<PAT>" | docker login ghcr.io -u <github-username> --password-stdin
```

(If the packages are kept public, this step can be skipped.)

### 4. First start

```bash
cd /home/deploy/waterpax
docker compose pull
docker compose up -d
docker compose logs -f backend     # expect: migrations applied → seeded → Server started
curl -s http://127.0.0.1:8088/api/health   # expect 200
```

The backend entrypoint runs `prisma migrate deploy` then the idempotent seed
(perms/roles/COA/products upserts) on **every** start — no manual DB steps.

### 5. DNS + TLS on the host nginx

- qservers: point `waterpax.com.ng` A record → `46.224.0.165`.
- Cloudflare: add zone, orange-cloud proxy (same pattern as phlexerp).
- Host nginx new vhost (alongside the phlexerp one):

```nginx
server {
    listen 80;
    server_name waterpax.com.ng;
    location / { proxy_pass http://127.0.0.1:8088; proxy_set_header Host $host;
                 proxy_set_header X-Forwarded-Proto $scheme; }
}
server {
    listen 443 ssl http2;
    server_name waterpax.com.ng;
    ssl_certificate     /etc/letsencrypt/live/waterpax.com.ng/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/waterpax.com.ng/privkey.pem;
    location / { proxy_pass http://127.0.0.1:8088; proxy_set_header Host $host;
                 proxy_set_header X-Forwarded-Proto $scheme; }
}
```

```bash
certbot --nginx -d waterpax.com.ng        # or certbot certonly per phlexerp pattern
nginx -t && systemctl reload nginx
```

- UFW: nothing new — the stack binds loopback only.
- Cloudflare SSL mode: Full (strict), same as phlexerp.

### 6. Verify (same discipline as the phlexerp runbook)

```bash
curl -sL -o /dev/null -w "%{http_code}" https://waterpax.com.ng/api/health   # 200
docker compose ps         # all three Up (postgres healthy)
docker compose logs backend | tail -5
```

### 7. Backups (cron, root or deploy)

```bash
# /etc/cron.d/backup-waterpax  — 02:00 daily
0 2 * * * deploy docker exec waterpax-postgres-1 pg_dump -U waterpax waterpax | gzip > /var/backups/waterpax-$(date +\%F).sql.gz
```

(Retention + R2 offload can mirror the phlexerp backup script; container name
is `waterpax-postgres-1` since the compose project is named `waterpax`.)

## Routine deploys

CI builds and pushes fresh images on every merge to `master`. On the server:

```bash
cd /home/deploy/waterpax
docker compose pull && docker compose up -d --remove-orphans
docker image prune -f
```

Or configure the optional auto-deploy job in `workflows/docker.yml` (set repo
variable `DEPLOY_ENABLED=true` + secrets `DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`,
`DEPLOY_SSH_KEY`) — it pulls, restarts, and health-checks automatically.

## Schema changes after baseline

The migration history is re-baselined: `prisma/migrations/0001_init` matches
the current schema (the pre-fork FlexoPrint migrations were removed — they
still live in git history). New schema changes now go through migrations:

```bash
cd apps/backend
npx prisma migrate dev --name describe_change   # needs a throwaway local DB
# or: npx prisma migrate diff --from-schema-datamodel ... (offline diff)
```

`prisma db push` still works for local iteration but skips history — prefer
`migrate dev` so production `migrate deploy` stays authoritative. CI smoke
keeps using `db push` against a scratch DB and is unaffected.

Local dev DBs built with `db push` have no `_prisma_migrations` table; if you
ever switch one to `migrate deploy`, first run
`npx prisma migrate resolve --applied 0001_init` to mark the baseline applied.
