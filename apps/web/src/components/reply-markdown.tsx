import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Antwort des Agenten als Markdown, im Chat und im Replay gleich dargestellt.

const REMARK_PLUGINS = [remarkGfm];

// Die KI schreibt in Tabellenzellen manchmal <br>. Wir führen kein HTML aus
// der Antwort aus, also wird es zu einem Leerzeichen statt zu Rohtext.
function cleanReply(content: string) {
  return content.replace(/<br\s*\/?>/gi, ' ');
}

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  h1: ({ children }) => <h3 className="mb-1 mt-3 font-extrabold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1 mt-3 font-extrabold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 font-extrabold first:mt-0">{children}</h3>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-teal underline dark:text-teal-300"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-rule">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-background font-mono text-[10px] uppercase tracking-widest text-dim">
      {children}
    </thead>
  ),
  th: ({ children }) => <th className="px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t border-rule px-3 py-2 align-top">{children}</td>,
};

export default function ReplyMarkdown({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
      {cleanReply(text)}
    </Markdown>
  );
}
