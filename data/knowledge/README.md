# Wissensbasis

Markdown-Dokumente zu Reisezielen, die später (Phase 3/4) in Chunks zerlegt,
embedded und über den RAG-Service durchsuchbar gemacht werden.

## Format

Jede Datei beginnt mit einem Frontmatter-Block, der 1:1 auf das `Document`-Modell
in `apps/api/prisma/schema.prisma` abbildet:

```yaml
---
title: <Titel des Dokuments>
source: <woher der Inhalt stammt, z.B. "Eigene Recherche" oder "Wikivoyage">
url: <Quell-URL, falls vorhanden - sonst weglassen>
license: <Lizenz des Inhalts, z.B. "Eigene Inhalte" oder "CC BY-SA 4.0">
language: de
---
```

Danach folgt der eigentliche Inhalt in normalem Markdown (Überschriften,
Absätze, Listen) - das wird später der Text sein, der in Chunks zerlegt wird.

## Woher die Inhalte kommen

Siehe den Abschnitt "Wissensbasis: Datenherkunft & Lizenzen" in der
[Projekt-README](../../README.md) für die Details zu eigenen vs. importierten
Inhalten und was bei der Namensnennung zu beachten ist.

## Neue Dokumente hinzufügen

Eine neue Datei nach demselben Muster anlegen (Dateiname z.B. `<ziel>.md`),
Frontmatter vollständig ausfüllen. Bei importierten Inhalten (z.B. aus
Wikivoyage) unbedingt `source`, `url` und `license` korrekt setzen - das ist
kein optionales Metadatum, sondern die Grundlage für eine rechtssichere
Namensnennung.
