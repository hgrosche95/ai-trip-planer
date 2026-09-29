# Deployment: Kosten & Betriebsgrenzen

Die einmalige Einrichtung (OIDC-Login, Repo-Secrets) steht im
[README, Abschnitt "Deployment einrichten"](../README.md#architektur-azure) -
dieses Dokument ergänzt das um zwei Fragen, die sich erst im Produktivbetrieb
stellen: was kostet das, und wo limitiert Groq den echten Betrieb (nicht nur
lokales Testen)?

## Was mit Schritt 7.2 dazukommt

`deploy.yml` baut und pusht jetzt zwei statt ein Image (Backend + RAG-Service)
und deployt eine zweite Container App (`<namePrefix>-rag`) in dieselbe
Container Apps Environment wie das Backend. **Keine neuen Secrets nötig** -
der RAG-Service teilt sich `DATABASE_URL` und die GHCR-Zugangsdaten mit dem
Backend (siehe `infra/main.bicep`).

Der RAG-Service ist bewusst nicht öffentlich erreichbar (`ingress.external:
false`) - `/search` und `/embed` haben keine eigene Authentifizierung, das
Backend erreicht ihn stattdessen intern über seinen Namen
(`http://<namePrefix>-rag`, siehe Kommentar in `infra/modules/container-app.bicep`).

## Kosten (Stand: Deployment-Region germanywestcentral)

| Ressource | Tarif | Erwartete Kosten |
| --- | --- | --- |
| Azure Static Web Apps | Free Tier | 0 € |
| Azure Container Apps (`api`) | Consumption, `minReplicas: 0`, 0,25 vCPU / 0,5Gi | ~0 € im Leerlauf, wenige Cent pro aktiver Stunde bei geringem Traffic |
| Azure Container Apps (`rag`, neu) | Consumption, `minReplicas: 0`, 0,5 vCPU / 1,0Gi | ~0 € im Leerlauf, etwas mehr als `api` pro aktiver Stunde (doppelte Größe) |
| Application Insights + Log Analytics | Free Tier (bis 5 GB/Monat) | 0 €, solange das Log-Volumen niedrig bleibt |
| Neon (Postgres) | Free Tier | 0 € |
| GitHub Container Registry | kostenlos für öffentliche/private Images in diesem Umfang | 0 € |
| Groq (LLM) | Free Tier | 0 € (Grenzen siehe unten) |

**Realistische Erwartung für ein Portfolio-/Demo-Projekt mit sporadischem
Traffic: nahe 0 €/Monat.** Scale-to-Zero ist hier kein Nice-to-have, sondern
der Grund, warum das überhaupt stimmt - ohne aktive Nutzer:innen laufen beide
Container Apps schlicht nicht.

**Trade-off, den Scale-to-Zero erkauft:** die erste Chat-Nachricht nach einer
Ruhephase trifft auf einen kalten Start auf **beiden** Containern gleichzeitig
(API und RAG). Das Embedding-Modell ist zwar im RAG-Image vorgeladen (Phase
3.4, kein Download beim Start), der Python-Prozess muss aber trotzdem starten
und das Modell in den Arbeitsspeicher laden - für die Person, die diese eine
Nachricht schickt, ein paar Sekunden längere Wartezeit. Für eine Live-Demo
heißt das: kurz vorher eine harmlose Anfrage schicken, um beide Container
aufzuwecken, statt das Publikum den Kaltstart miterleben zu lassen.

## Groq-Free-Tier im Produktivbetrieb

Groqs Free-Tier-Limits (Stand der Recherche, Modell `openai/gpt-oss-120b`)
gelten im deployten Zustand genauso wie lokal - mit einem Unterschied: lokal
sitzt in der Regel eine Person am Rechner, im Produktivbetrieb potenziell
mehrere gleichzeitig.

| Grenze | Wert | Was im Betrieb passiert |
| --- | --- | --- |
| Requests/Minute | 30 | Bei mehreren gleichzeitigen Chats realistisch erreichbar. `RetryingLlmProvider` (Phase 1.3) fängt das ab: liest `Retry-After`, wartet mit exponentiellem Backoff + Jitter, bis zu 3 Versuche - für Nutzer:innen als etwas längere Antwortzeit sichtbar, nicht als Fehler. |
| Requests/Tag | ca. 1.000 | Bei einer Live-Demo mit ein paar Dutzend Nachrichten unkritisch. Der nächtliche Eval-Lauf (Phase 6.2/7.1) verbraucht selbst nur ~15-25 Requests pro Nacht. |
| Tokens/Minute | 8.000 | Härteste Grenze, hat das RAG-Design bestimmt: `RAG_SEARCH_TOP_K=3` statt mehr, Historie wird getrimmt (`LLM_MAX_HISTORY_MESSAGES`), Tool-Ergebnisse sind längenbegrenzt (`LLM_MAX_TOOL_RESULT_CHARS`). |

**Was bei 31 Anfragen in derselben Minute konkret passiert:** Groq antwortet
der 31. Anfrage mit HTTP 429. Ohne Gegenmaßnahme würde das als Fehler beim
Nutzer landen; mit `RetryingLlmProvider` wartet die App stattdessen den vom
`Retry-After`-Header vorgegebenen Zeitraum ab und versucht es erneut - aus
Nutzersicht eine langsamere statt einer fehlschlagenden Antwort. Bei
mehreren Personen, die bewusst gleichzeitig testen, zeigt sich genau dieser
Unterschied.

**Tokens/Minute vorab abwarten (Phase 2, Teil e):** Vor jedem Groq-Aufruf
prüft der `TokenBudgetLimiter`, ob das Restbudget aus den
`x-ratelimit-*`-Headern der letzten Antwort für den nächsten Aufruf reicht.
Wenn nicht, wartet er bis zum angekündigten Reset (höchstens 20 s, sonst
greift das 429-Handling oben) und der Chat zeigt „wartet 6 s auf
Groq-Limit“. Der Zustand liegt pro Instanz im Arbeitsspeicher, bei mehreren
Replikas bleibt 429 deshalb möglich. Abschalten mit `LLM_RATE_LIMITER=off`
(Standard: an, nur bei `LLM_PROVIDER=groq`). Details:
[`phase-2/README.md`](phase-2/README.md#teil-e-groq-limit-vorab-abwarten-statt-in-429-zu-laufen).

**Multi-Agenten-Modus (Phase 3a):** `AGENT_MODE=multi` lässt `POST /agent/runs`
über den Orchestrator laufen (Planer, Recherche, Budget). Recherche und Budget
brauchen kein LLM, ein vollständiger Lauf macht 3 Aufrufe (triage, compose,
final; höchstens 4 mit Reparaturversuch) mit zusammen etwa 5.000–5.500 Tokens,
eine Rückfrage 1 Aufruf. Details und Token-Rechnung:
[`phase-3/README.md`](phase-3/README.md).

Der Modus ist pro Anfrage wählbar (Umschalter im Chat, Default dort
Multi-Agent). Deployt wird der Server-Default über den Bicep-Parameter
`agentMode` (in `infra/main.parameters.json`: `multi`; ohne Eintrag
`classic`), er gilt für Clients ohne `mode`. **Notbremse**, falls der
Multi-Modus live Probleme macht: `agentModeLocked: true` in
`main.parameters.json` zusammen mit `agentMode: classic` erzwingt den
Classic-Agenten für alle Anfragen, egal was der Umschalter schickt. Schneller
ohne Deploy geht es mit
`az containerapp update -n <namePrefix>-api -g <resource-group> --set-env-vars AGENT_MODE=classic AGENT_MODE_LOCKED=true`
(neue Revision, kein Image-Build); der nächste Deploy setzt dann wieder die
Werte aus den Parametern, deshalb dort nachziehen.

**Fallback für eine wichtige Demo:** `LLM_PROVIDER=anthropic` in der
Container-App-Konfiguration umschalten (Secret `ANTHROPIC_API_KEY` ist
bereits hinterlegt) - kostenpflichtig, aber ohne die Free-Tier-Limits von
Groq. Nach der Demo zurückschalten.
