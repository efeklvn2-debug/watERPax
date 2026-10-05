#!/bin/bash
set -e
echo "== splitting origin cert/key =="
awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/' /tmp/cf-origin.txt > /etc/ssl/waterpax-origin.pem
awk '/BEGIN PRIVATE KEY/,/END PRIVATE KEY/' /tmp/cf-origin.txt > /etc/ssl/private/waterpax-origin.key
chmod 600 /etc/ssl/private/waterpax-origin.key
chown root:root /etc/ssl/waterpax-origin.pem /etc/ssl/private/waterpax-origin.key
openssl x509 -in /etc/ssl/waterpax-origin.pem -noout -subject -enddate

echo "== installing 443 vhost =="
install -m 644 /tmp/waterpax-https.conf /etc/nginx/sites-available/waterpax-https
ln -sfn /etc/nginx/sites-available/waterpax-https /etc/nginx/sites-enabled/waterpax-https
nginx -t
systemctl reload nginx

echo "== on-box verification (direct to origin) =="
curl -sk --resolve waterpax.com.ng:443:127.0.0.1 -o /dev/null -w "health_via_origin=%{http_code}\n" https://waterpax.com.ng/api/health
curl -sk --resolve waterpax.com.ng:443:127.0.0.1 -o /dev/null -w "spa_via_origin=%{http_code}\n" https://waterpax.com.ng/
echo "== done =="
