# ResellEngine — Deployment-Plan

Ziel: Frontend und Backend sollen sicher, wiederholbar und mit wenig manuellem Eingriff ausgerollt werden. Dieses Dokument beschreibt die aktuelle Architektur, die Deploymentschritte und die häufigsten Fehlerquellen.

## 1. Architektur

```
┌─────────────────────────────────────────────────────────────┐
│  Domain: akaidon.market                                     │
│  Hosting: Vercel (Next.js 16 App, Projekt resellengine-web) │
│  Repo: https://github.com/Kegiion/resellengine.git         │
│  Root Directory: web/                                       │
└─────────────────────────────────┬───────────────────────────┘
                                  │ /api/* rewrites
                                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Domain: api.akaidon.market                                 │
│  Hosting: VM (91.99.132.249)                               │
│  Reverse Proxy: Caddy (HTTPS)                              │
│  Prozessmanager: PM2                                         │
│  Backend: Node.js + Express auf Port 3002                  │
└─────────────────────────────────────────────────────────────┘
```

## 2. Frontend (Vercel)

### Auslöser
- Jeder Push auf `master` im GitHub-Repo startet automatisch einen Production-Deploy.
- Vercel-Projekt: `resellengine-web` (verknüpft mit `Kegiion/resellengine`).
- Root-Directory: `web/`.

### Umgebungsvariablen (Vercel Production)
- `NEXT_PUBLIC_API_URL=https://api.akaidon.market`
- Weitere Variablen wie `NEXT_PUBLIC_*` werden zur Build-Zeit eingefroren. Änderungen erfordern einen neuen Deploy.

### Wichtige Konfiguration
- `web/next.config.ts` enthält Next.js `rewrites`, die `/api/*` auf `https://api.akaidon.market/*` leiten.
- Keine separate `vercel.json` mehr für API-Rewrites (Vercel ignoriert externe Rewrite-Ziele in `vercel.json` zuverlässig, Next.js rewrites funktionieren zuverlässiger).

### Verifizierung nach Deploy
1. `https://akaidon.market/api/health` muss `{"status":"ok"}` liefern.
2. Dashboard zeigt „API online“.

## 3. Backend (VM)

### Server-Setup
- VM: `91.99.132.249`
- Code liegt in `/opt/resellengine`.
- Caddy macht HTTPS für `api.akaidon.market` und leitet auf `localhost:3002` weiter.
- PM2 startet und überwacht `dist/src/index.js`.

### Wichtige Dateien auf der VM
- `/opt/resellengine/.env` — alle Secrets und Runtime-Variablen.
- `/opt/resellengine/ecosystem.config.js` oder PM2-Prozessname `resellengine-backend`.
- Caddyfile in `/opt/resellengine/scripts/Caddyfile` oder global unter `/etc/caddy/Caddyfile`.

### Umgebungsvariablen auf der VM (mindestens)
```bash
PORT=3002
NODE_ENV=production
ALLOWED_ORIGINS=https://akaidon.market,https://*.akaidon.market,https://resellengine-web.vercel.app

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

GEMINI_API_KEY=your-gemini-key
REMOVE_BG_API_KEY=your-removebg-key
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key

DISCORD_WEBHOOK_URL=
SCHEDULER_ENABLED=true
SCHEDULER_INTERVAL_MS=180000
MIN_DELAY_MS=2000
MAX_DELAY_MS=5000
VINTED_SESSION_COOKIE=
SHIPPING_ESTIMATE=5.0
VINTED_SELLER_FEE_PERCENT=0
VINTED_BUYER_PROTECTION_PERCENT=0.05
```

### Deploy-Schritte Backend
1. Auf der VM aktuellen Code ziehen:
   ```bash
   ssh root@91.99.132.249
   cd /opt/resellengine
   git pull origin master
   ```
2. Abhängigkeiten installieren und bauen:
   ```bash
   npm install
   npm run build
   ```
3. PM2-Prozess mit neuen Umgebungsvariablen neu starten:
   ```bash
   pm2 restart resellengine-backend --update-env
   pm2 save
   ```
4. Health-Check:
   ```bash
   curl https://api.akaidon.market/health
   ```

## 4. Wiederkehrende Probleme und Lösungen

### API erscheint im Frontend als „offline“, obwohl VM läuft
- Ursache: Vercel-Rewrites für `/api/*` funktionieren nicht (z. B. wegen `vercel.json` mit externem Ziel).
- Lösung: Rewrites in `web/next.config.ts` definieren und `vercel.json` löschen.
- Prüfung: `curl https://akaidon.market/api/health` muss API-Antwort liefern.

### Backend startet nicht: SUPABASE_URL fehlt
- Ursache: `.env` auf der VM wurde überschrieben oder PM2 hat die alten Env-Variablen nicht neu geladen.
- Lösung:
  ```bash
  pm2 restart resellengine-backend --update-env
  pm2 save
  ```
- Prüfung: `pm2 logs resellengine-backend` und `curl https://api.akaidon.market/health`.

### Frontend zeigt alten Deploy
- Ursache: Vercel-Build wurde nicht getriggert oder GitHub-Verbindung war unterbrochen.
- Lösung:
  - `vercel git connect` prüfen.
  - Leerer Commit erzwingt neuen Deploy:
    ```bash
    git commit --allow-empty -m "Trigger Vercel deploy" && git push origin master
    ```

### Caddy-Zertifikat abgelaufen oder Reverse Proxy defekt
- Prüfung:
  ```bash
  systemctl status caddy
  journalctl -u caddy -f
  ```
- Neustart:
  ```bash
  systemctl restart caddy
  ```

## 5. Checkliste für jedes Release

- [ ] Backend-Code auf der VM mit `git pull` aktualisiert.
- [ ] `npm install` und `npm run build` auf der VM erfolgreich.
- [ ] `pm2 restart resellengine-backend --update-env` und `pm2 save` ausgeführt.
- [ ] `https://api.akaidon.market/health` gibt `{"status":"ok"}` zurück.
- [ ] Frontend-Änderungen in `web/` committet und auf `master` gepusht.
- [ ] Vercel-Deploy erfolgreich abgeschlossen.
- [ ] `https://akaidon.market/api/health` liefert API-Antwort.
- [ ] Dashboard zeigt „API online“ (Desktop + Mobile geprüft).

## 6. Nächste Verbesserungen (optional)

- GitHub Action für automatisches Backend-Deploy auf die VM bei Push auf `master`.
- Health-Check-Monitoring mit Discord-Benachrichtigung bei API-Ausfall.
- PM2 `ecosystem.config.js` im Repo versionieren, damit Prozesskonfiguration reproduzierbar ist.
