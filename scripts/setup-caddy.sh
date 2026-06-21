#!/usr/bin/env bash
# Setup Caddy als Reverse Proxy mit automatischem SSL für ResellEngine API
# Usage: ssh root@91.99.132.249 'bash -s' < scripts/setup-caddy.sh

set -e

DOMAIN="${1:-api.resellengine.de}"
BACKEND_PORT="${2:-3002}"

echo "Installing Caddy..."
apt-get update
apt-get install -y curl gnupg

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

systemctl enable caddy

echo "Writing Caddyfile for domain ${DOMAIN} -> localhost:${BACKEND_PORT}..."
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    reverse_proxy localhost:${BACKEND_PORT}
    encode gzip
    header {
        Access-Control-Allow-Origin "{http.request.header.Origin}"
        Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
        Access-Control-Allow-Headers "Content-Type, Authorization"
        Access-Control-Allow-Credentials "true"
        defer
    }
}
EOF

caddy fmt --overwrite /etc/caddy/Caddyfile

echo "Reloading Caddy..."
systemctl reload caddy || systemctl restart caddy

echo "Done. Caddy is serving https://${DOMAIN} -> http://localhost:${BACKEND_PORT}"
echo "Make sure DNS A-record for ${DOMAIN} points to 91.99.132.249"
