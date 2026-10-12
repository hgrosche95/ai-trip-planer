import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  badgeFor,
  emptyHistory,
  entriesFromReports,
  HISTORY_SCHEMA_VERSION,
  mergeHistory,
  type AnyReport,
  type History,
} from './history.js';

// Hängt die JSON-Reports eines Nachtlaufs an die Historie an und schreibt
// das Badge. Läuft im Job publish von nightly-eval.yml, kann aber auch
// lokal gegen evals/reports getestet werden:
//
//   npx tsx src/publish.ts <Ordner mit Reports> <Ordner für history.json + badge.json>
//
// Die Reports dürfen in Unterordnern liegen (download-artifact legt pro
// Artefakt einen an).

function findReports(dir: string): AnyReport[] {
  const reports: AnyReport[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const kind = entry.name.startsWith('knowledge-')
      ? 'knowledge'
      : entry.name.startsWith('scenarios-')
        ? 'scenarios'
        : null;
    if (!kind || !entry.name.endsWith('.json')) continue;
    const report = JSON.parse(readFileSync(path.join(entry.parentPath, entry.name), 'utf-8'));
    reports.push({ kind, report } as AnyReport);
  }
  return reports;
}

function loadHistory(file: string): History {
  if (!existsSync(file)) return emptyHistory();
  const history = JSON.parse(readFileSync(file, 'utf-8')) as History;
  if (history.schemaVersion !== HISTORY_SCHEMA_VERSION) {
    throw new Error(`${file}: schemaVersion ${history.schemaVersion}, erwartet ${HISTORY_SCHEMA_VERSION}`);
  }
  return history;
}

function main(): void {
  const [reportsDir, outDir] = process.argv.slice(2);
  if (!reportsDir || !outDir) {
    console.error('Aufruf: tsx src/publish.ts <Reports> <Ausgabeordner>');
    process.exitCode = 2;
    return;
  }
  const reports = existsSync(reportsDir) ? findReports(reportsDir) : [];
  const entries = entriesFromReports(reports);
  mkdirSync(outDir, { recursive: true });
  const historyFile = path.join(outDir, 'history.json');
  const history = mergeHistory(loadHistory(historyFile), entries);
  const badge = badgeFor(history);

  writeFileSync(historyFile, `${JSON.stringify(history, null, 2)}\n`);
  writeFileSync(path.join(outDir, 'badge.json'), `${JSON.stringify(badge)}\n`);
  console.log(
    `${reports.length} Reports → ${entries.length} neue Einträge, Historie: ${history.entries.length}. Badge: ${badge.message} (${badge.color})`,
  );
}

main();
