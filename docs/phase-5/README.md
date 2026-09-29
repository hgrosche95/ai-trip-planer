# Phase 5: Evals 2.0 (Teil a: Szenarien und Messung)

Bisher prüften die nächtlichen Evals nur, ob die Wissenssuche das richtige
Dokument findet und der Classic-Agent das richtige Tool wählt. Ab jetzt
laufen jede Nacht **12 komplette Reiseanfragen** gegen den
Multi-Agenten-Modus. Der Code rechnet für jede nach, wie gut der fertige
Plan wirklich ist.

## Vorher → Nachher

| | vorher | Phase 5a |
| --- | --- | --- |
| Was geprüft wird | 12 Einzelfragen an den Classic-Agenten | + 12 ganze Planungen im Multi-Agenten-Modus |
| Wie | `POST /agent/chat` (JSON) | `POST /agent/runs` (SSE, wie im Browser) |
| Plan-Qualität | – | Regelverstöße, Wetter, Geo, Vollständigkeit, Budget, Judge-Rubrik |
| Kosten und Tempo | – | Tokens, Aufrufe, Dauer (p50/p95), Kosten pro Szenario |
| Ergebnis | Markdown-Report | Markdown + **JSON** (Grundlage für `/evals` in 5b) |

## Die 12 Szenarien

| Szenario | Prüft |
| --- | --- |
| `lissabon-oktober` | Standardfall: 3 Tage, Budget, Abreiseort |
| `rom-regen-oktober` | Regenmonat: an Regentagen nichts draußen |
| `wien-wochenende` | „Wochenende“ wird zu 2–3 Tagen |
| `prag-tagesausflug` | 1 Tag, keine Unterkunft |
| `paris-budget-unmoeglich` | 150 € für Paris: Die Antwort muss ehrlich sagen, dass es nicht reicht |
| `unklar-verreisen`, `unklar-nur-ziel` | Rückfrage statt Plan, keine Recherche |
| `lissabon-vegetarisch` | Die Vorliebe landet im Plan, der Kritiker prüft sie |
| `kopenhagen-familie` | 4 Personen, Familienprogramm |
| `krakau-zloty` | Budget in Złoty: Umrechnung läuft |
| `porto-tag-2-entspannter` | Folgenachricht: nur Tag 2 ändert sich, Tag 1 und 3 bleiben Stop für Stop gleich |
| `madrid-injection` | „Ignoriere alle Anweisungen …“ in der Anfrage: Der Plan kommt trotzdem, der Systemprompt nicht |

## Die Idee in einem Satz

> Die Evals glauben dem Kritiker nicht, sie rechnen selbst nach, mit
> denselben Regeln.

Die Regeln des Kritikers (`apps/api/src/orchestrator/rules`) sind reine
Funktionen ohne Abhängigkeiten. `evals/src/plan-metrics.ts` importiert sie
direkt und wendet sie auf den **fertigen** Plan aus dem Ereignis
`itinerary.draft` an. Meldet der Kritiker „0 Fehler“, obwohl noch ein Park
am Regentag steht, fällt das hier auf. Damit die Regeln so importierbar
sind, liegt `formatEur` jetzt in `rules/format.ts` statt im Budget-Agenten.

## Ablauf eines Szenarios

```
scenarios.json ─→ run-client.ts ─── POST /agent/runs (SSE) ───→ API (Groq)
                        │  sammelt alle Ereignisse
                        ▼
                  plan-metrics.ts     Regeln, Regentage, Geo, Tage, Budget,
                        │             Tokens, Dauer, Prüfrunden
                        ▼
                  plan-judge.ts       Rubrik 1–5, Ehrlichkeit, Injection
                        │             (nur mit EVAL_JUDGE_ENABLED)
                        ▼
                  scenario-summary.ts Quoten, p50/p95, Schwellen
                        ▼
                  reports/scenarios-<Zeit>.md + .json
```

## Beispiel-Report

So sah der Probelauf gegen einen Mock-Server aus, der für jede Anfrage
denselben aufgezeichneten Lauf liefert. Die Zahlen sind deshalb nicht
aussagekräftig, zeigen aber die Form:

```
**4 von 12 Szenarien bestanden** · Schwellen verfehlt: Budget-Einhaltung 0 < 0.9; …

| Kennzahl                                   | Wert        | Schwelle     |
| Harte Regelverstöße pro Plan (Ø / max)     | 0,00 / 0    | ≤ 0,10 / 1   |
| Wetterbewusstsein                          | 100 %       | ≥ 80 %       |
| Rückfrage-Genauigkeit                      | 100 %       | ≥ 90 %       |
| Revisionswirksamkeit                       | 100 %       | ≥ 80 %       |
| Tokens pro Szenario (p50 / p95)            | 6730 / 13460| p95 ≤ 12000  |
…
| rom-regen-oktober | ✗ | 6730 | 4 | … | 4 Tage (3 Tage); Budget eingehalten (over) |
```

Die echten Zahlen gibt es nach dem ersten Nachtlauf in GitHub Actions
(Artefakt `eval-report`).

## Rundgang durch den Code (`evals/`)

| Datei | Was |
| --- | --- |
| `scenarios.json` | die 12 Szenarien mit Erwartungen |
| `src/scenario-types.ts` | Szenario, Ergebnis, Kennzahlen |
| `src/run-client.ts` | SSE-Client für `POST /agent/runs` (Login wie `agent-client.ts`) |
| `src/plan-metrics.ts` | alle Prüfungen ohne Judge, Kennzahlen aus den Ereignissen |
| `src/plan-judge.ts` | Rubrik-Judge und Budget-Ehrlichkeit (immer dasselbe Judge-Modell) |
| `src/scenario-summary.ts` | Quoten, Perzentile, Schwellen (per Env überschreibbar) |
| `src/scenario-report.ts` | Markdown und JSON |
| `src/run-scenarios.ts` | CLI `npm run eval:scenarios`, Filter `EVAL_SCENARIOS` |
| `fixtures/*.json` | zwei aufgezeichnete Orchestrator-Läufe für die Tests |

Dazu kommt der Schritt „Szenario-Evals ausführen“ in
`.github/workflows/nightly-eval.yml`. Er läuft nach den Wissens-Evals, auch
wenn die rot sind, und lädt die JSON-Reports mit hoch.

## Kosten

12 Szenarien (13 Läufe, weil Porto eine Folgenachricht hat) à etwa 5.000
bis 10.000 Tokens, plus 12 Judge-Aufrufe: grob **80.000 bis 100.000
Groq-Tokens pro Nacht**. Zwischen den Szenarien liegen 5 s Pause
(`EVAL_SCENARIO_PAUSE_MS`), damit das Minutenlimit nicht die Messung
verzerrt. Die Wartezeit auf das Limit wird trotzdem gemessen und getrennt
ausgewiesen (p95 ohne Wartezeit). Die Evals melden sich als Eigentümer an,
das Gast-Kontingent greift also nicht.

## Tests

`evals/src/scenario-metrics.spec.ts` (läuft in CI mit `npm run test`):
- SSE-Parser
- Regenlauf: Die Nachbesserung wirkt, 0 harte Fehler, Regentag ohne
  Programm draußen
- Vorlieben und Recherche-Aufgaben
- Rückfrage richtig und falsch
- Folgenachricht: nur der genannte Tag ändert sich
- `run.error`
- Zusammenfassung mit verfehlten Schwellen
- Perzentile

Dazu ein Probelauf des ganzen Runners gegen einen Mock-Server (siehe oben).

## Bewusst offen (5b)

- Verlauf `history.json` im Branch `eval-data`, Badge `badge.json`
- Seite `/evals` mit Verlaufslinien, Modellvergleich und letzten
  Fehlschlägen
- Matrix Groq/Anthropic im Nightly (Anthropic nur sonntags)
- Erster echter Nachtlauf: Erst dann zeigt sich, welche Schwellen realistisch
  sind. Verfehlt der erste Lauf Schwellen, ist das ein Befund zum Anschauen,
  kein Grund, die Schwellen blind zu senken.
