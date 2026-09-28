import type { RunEvent } from './run-events';

// Liest eine Server-Sent-Events-Antwort Ereignis für Ereignis.
// EventSource (die eingebaute Browser-API) kann nur GET und keinen
// Authorization-Header, deshalb lesen wir den Body von fetch() selbst.
// Ein Ereignis endet mit einer Leerzeile, darin steht "data: <JSON>".
// Zeilen mit ":" am Anfang sind Heartbeats und werden übersprungen.
export async function* readRunEvents(response: Response): AsyncGenerator<RunEvent> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    // Ein Netzwerkpaket kann mitten in einem Ereignis enden: nur vollständige
    // Blöcke verarbeiten, den Rest für das nächste Paket aufheben.
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
        .join('\n');
      if (data) yield JSON.parse(data) as RunEvent;
      boundary = buffer.indexOf('\n\n');
    }
  }
}
