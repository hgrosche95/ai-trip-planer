import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, '..', '..', 'data', 'knowledge');

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Text der Wissensbasis-Dokumente, nach Frontmatter-Titel. Der
 * Belegtreue-Judge vergleicht die Antwort mit dem ganzen Dokument statt nur
 * mit den Top-k-Chunks: die Suchanfrage des Agenten kann anders lauten als die
 * Frage im Golden Dataset, das Dokument als Ganzes ist dagegen eindeutig.
 */
export function loadKnowledgeDocuments(dir = KNOWLEDGE_DIR): Map<string, string> {
  const documents = new Map<string, string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md') || file.toLowerCase() === 'readme.md') continue;
    const raw = readFileSync(path.join(dir, file), 'utf-8');
    const match = raw.match(FRONTMATTER);
    const title = match?.[1].match(/^title:\s*(.+)$/m)?.[1].trim();
    if (!title) continue;
    documents.set(title, raw.slice(match![0].length).trim());
  }
  return documents;
}
