# HTTPS-Setup für ResellEngine API

## 1. DNS einrichten

Bei deinem Domain-Anbieter (z. B. Cloudflare, Namecheap, GoDaddy, IONOS):

1. **A-Record** anlegen:
   - Name: `api` (oder deine gewünschte Subdomain, z. B. `resellengine`)
   - Typ: `A`
   - Wert: `91.99.132.249`
   - TTL: automatisch / 300

   Beispiel: `api.deinedomain.de` → `91.99.132.249`

2. Warte 1–5 Minuten, bis der A-Record propagiert. Prüfe mit:

   ```bash
   dig api.deinedomain.de +short
   ```

   Sollte `91.99.132.249` zurückgeben.

## 2. Caddy auf der VM installieren

Von deinem lokalen Rechner aus:

```bash
ssh root@91.99.132.249
```

Auf der VM:

```bash
cd /opt/resellengine
bash scripts/setup-caddy.sh api.deinedomain.de 3002
```

Das Skript installiert Caddy, erstellt die Caddyfile und startet den Dienst.

## 3. Caddy-Status prüfen

```bash
systemctl status caddy
journalctl -u caddy -f
```

Caddy holt sich automatisch ein Let's-Encrypt-Zertifikat für `api.deinedomain.de`.

## 4. Backend- und Frontend-Env aktualisieren

### Auf der VM (`/opt/resellengine/.env`)

```bash
# Caddy sorgt für HTTPS; Erlaubte Origins für CORS
ALLOWED_ORIGINS=https://deinedomain.de,https://*.deinedomain.de,https://resellengine-web.vercel.app
```

```bash
cd /opt/resellengine
pm2 restart resellengine-backend --update-env
pm2 save
```

### Vercel Environment Variables

Setze im Vercel-Dashboard oder per CLI:

```bash
cd web
echo "https://api.deinedomain.de" | vercel env add NEXT_PUBLIC_API_URL production
vercel --prod --yes
```

## 5. Testen

```bash
curl https://api.deinedomain.de/health
```

Erwartet:

```json
{"status":"ok","version":"0.1.0"}
```

Im Browser sollte das Vercel-Dashboard nun "API online" anzeigen.

## 6. (Optional) Hintergrund-Infos

- **Caddy vs. Nginx + Certbot**: Caddy verwaltet Zertifikate automatisch und erneuert sie selbstständig. Keine `certbot renew` Crontab nötig.
- **Mixed Content**: Sobald die API über HTTPS läuft, erlaubt der Browser HTTPS-Frontend → HTTPS-API-Requests ohne Blockade.
- **Firewall**: Stelle sicher, dass Port 443 (HTTPS) in der VM-Firewall offen ist. Port 80 wird von Caddy für ACME-HTTP-Challenge genutzt.
