#!/bin/bash
set -e
echo "== installing port-80 vhost =="
install -m 644 /tmp/waterpax-http.conf /etc/nginx/sites-available/waterpax
mkdir -p /var/www/waterpax
chown www-data:www-data /var/www/waterpax
ln -sfn /etc/nginx/sites-available/waterpax /etc/nginx/sites-enabled/waterpax
nginx -t
systemctl reload nginx
echo "== issuing certificate =="
if ls /etc/letsencrypt/accounts/*/*/ 1>/dev/null 2>&1; then
  certbot certonly --webroot -w /var/www/waterpax -d waterpax.com.ng -d www.waterpax.com.ng --non-interactive --agree-tos --keep-until-expiring
else
  certbot certonly --webroot -w /var/www/waterpax -d waterpax.com.ng -d www.waterpax.com.ng --non-interactive --agree-tos --register-unsafely-without-email
fi
echo "== done =="
