# ResellEngine Web Dashboard

Next.js 16 App Router Dashboard für ResellEngine.

## Environment

Im Vercel-Dashboard oder in einer `.env.local` beim lokalen Start:

```env
NEXT_PUBLIC_API_URL=http://91.99.132.249:3002
```

Lokal gegen das Backend:

```env
NEXT_PUBLIC_API_URL=http://localhost:3002
```

## Development

```bash
cd web
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output ist `standalone` unter `.next/standalone/`.

## Deployment

### Vercel (empfohlen)

1. Repo auf GitHub pushen.
2. In Vercel "Import Project" → Root-Directory `web` auswählen.
3. Environment Variable `NEXT_PUBLIC_API_URL` auf `http://91.99.132.249:3002` setzen.
4. Deploy.

### VM / Eigenes Hosting

```bash
cd web
npm install
npm run build
node .next/standalone/server.js
```

Auf der VM kann das Backend unter Port `3002` und das Frontend unter Port `3000` laufen. Stelle sicher, dass `NEXT_PUBLIC_API_URL` auf die externe VM-IP zeigt.
