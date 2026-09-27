# apps/web – Next.js-Frontend

Chat-Oberfläche und gespeicherte Reisen des AI Trip Planners, gebaut als
statischer Export für Azure Static Web Apps. Setup steht in der
[Haupt-README](../../README.md#lokales-setup).

- `src/app/chat-window.tsx` – Chat mit Markdown-Antworten (inkl. Tabellen), Quellen pro Antwort und Fehlermeldung statt Absturz, wenn die API nicht antwortet
- `src/components/trip-globe.tsx`, `globe-canvas.tsx` – 3D-Globus hinter dem Chat (three.js, nur im Browser geladen), dreht und zoomt zum Reiseziel
- `src/app/trips/` – gespeicherte Reisen im Boarding-Pass-Stil, Detailansicht mit Programmpunkten pro Tag
- `src/app/login/` – Besitzer-Login; Gäste bekommen automatisch ein Token (`src/lib/auth.ts`)

```bash
npm run dev      # Port 3001, braucht .env.local mit NEXT_PUBLIC_API_URL=http://localhost:3000
npm run build    # statischer Export nach out/
npm run lint
```
