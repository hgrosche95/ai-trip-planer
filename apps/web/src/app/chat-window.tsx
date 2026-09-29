'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { authFetch } from '@/lib/auth';
import BudgetBar from '@/components/budget-bar';
import CritiquePanel from '@/components/critique-panel';
import LodgingList from '@/components/lodging-list';
import ModeToggle from '@/components/mode-toggle';
import ReplyMarkdown from '@/components/reply-markdown';
import SaveDraftButton from '@/components/save-draft-button';
import TracePanel from '@/components/trace-panel';
import TripGlobe, { type GlobeArc, type GlobeFocus } from '@/components/trip-globe';
import WeatherStrip from '@/components/weather-strip';
import {
  DEFAULT_AGENT_MODE,
  readStoredAgentMode,
  storeAgentMode,
  subscribeAgentMode,
} from '@/lib/agent-mode';
import { issueMarkers, type IssueMarker } from '@/lib/critique';
import { draftVersions } from '@/lib/draft-versions';
import type { ChatSource } from '@/lib/run-events';
import { lodgingPoints } from '@/lib/replay';
import { applyRunEvent, initialRunState, type RunState } from '@/lib/run-state';
import { readRunEvents } from '@/lib/sse';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  searchAttempted?: boolean;
  // Ablauf des Agenten, der zu dieser Antwort geführt hat
  trace?: RunState;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL;

function SourcesPanel({
  sources,
  searchAttempted,
}: {
  sources?: ChatSource[];
  searchAttempted?: boolean;
}) {
  if (sources && sources.length > 0) {
    return (
      <ul aria-label={`Quellen (${sources.length})`} className="mt-3 flex flex-wrap gap-1.5">
        {sources.map((source, index) => {
          const label = `${source.title} · ${source.license} · ${Math.round(source.score * 100)}%`;
          const chipClass =
            'rounded border border-dashed border-teal bg-teal/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-teal dark:border-teal-300 dark:text-teal-300';

          return (
            <li key={index}>
              {source.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  title={source.source}
                  className={chipClass + ' block hover:bg-teal/15'}
                >
                  {label}
                </a>
              ) : (
                <span title={source.source} className={chipClass + ' block'}>
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  if (searchAttempted) {
    return (
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
        Keine passende Quelle in der Wissensbasis gefunden.
      </p>
    );
  }

  return null;
}

const EXAMPLE_PROMPTS = [
  { tag: 'Städtetrip', text: '3 Tage Lissabon im Oktober, Budget 800 €' },
  { tag: 'Natur', text: 'Eine Woche Wandern in den Dolomiten im Juni' },
  { tag: 'Kulinarik', text: 'Ein Wochenende Street Food in Krakau' },
  { tag: 'Budget', text: 'Günstige Ostsee-Ziele, Anreise mit dem Zug' },
];

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-5 py-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-dim">Neue Reise</p>
        <h1 className="mt-1 text-3xl font-extrabold text-balance">
          Wohin soll&apos;s als Nächstes gehen?
        </h1>
        <p className="mt-2 text-sm text-dim">
          Beschreib Ziel, Zeitraum und Budget. Ich plane Tag für Tag und zeige dir, aus welchen
          Quellen meine Infos stammen.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt.text}
            type="button"
            onClick={() => onPick(prompt.text)}
            className="rounded-xl border border-rule bg-card p-3 text-left text-sm transition hover:border-teal focus-visible:outline-2 focus-visible:outline-teal"
          >
            <span className="block font-mono text-[10px] uppercase tracking-widest text-teal dark:text-teal-300">
              {prompt.tag}
            </span>
            {prompt.text}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ChatWindow() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [globeFocus, setGlobeFocus] = useState<GlobeFocus | null>(null);
  const [globePlaces, setGlobePlaces] = useState<GlobeFocus[]>([]);
  const [globeArcs, setGlobeArcs] = useState<GlobeArc[]>([]);
  // Der gerade laufende Agentenlauf, wird mit jedem Ereignis aktualisiert
  const [liveRun, setLiveRun] = useState<RunState | null>(null);
  const [globeRoute, setGlobeRoute] = useState<GlobeFocus[] | null>(null);
  // Unterkünfte als kleine Punkte, ersetzt wie Marker und Bögen
  const [globePois, setGlobePois] = useState<GlobeFocus[]>([]);
  // Befunde des Kritikers als Ringe an den Programmpunkten
  const [globeIssues, setGlobeIssues] = useState<IssueMarker[]>([]);
  // Gewählter Modus aus localStorage; beim statischen Vorrendern und vor dem
  // Hydrieren gilt der Default, damit das HTML übereinstimmt.
  const agentMode = useSyncExternalStore(
    subscribeAgentMode,
    () => readStoredAgentMode(),
    () => DEFAULT_AGENT_MODE,
  );

  // Weckt den RAG-Service beim Öffnen des Chats, damit sein Kaltstart läuft,
  // während der Nutzer noch tippt, statt während der ersten Frage. Ohne Token
  // und ohne Warten auf die Antwort; schlägt es fehl, ändert sich nichts.
  useEffect(() => {
    fetch(`${API_URL}/health/warmup`, { method: 'POST' }).catch(() => {});
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const userMessage = input.trim();
    if (!userMessage) return;

    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    setIsLoading(true);
    let run = initialRunState();
    setLiveRun(run);

    try {
      const response = await authFetch(`${API_URL}/agent/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ sessionId, message: userMessage, mode: agentMode }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`, { cause: response.status });
      }

      // Jedes Ereignis sofort verarbeiten: Timeline und Globus aktualisieren
      // sich, während der Agent noch arbeitet. Meldet dieser Lauf neue Orte,
      // ersetzen sie Marker und Bögen der vorigen Antwort; Folgefragen ohne
      // neuen Ort lassen das Globusbild stehen.
      let isFirstPlace = true;
      for await (const event of readRunEvents(response)) {
        run = applyRunEvent(run, event);
        setLiveRun(run);
        if (event.type === 'place.added') {
          const { name, lat, lng, kind } = event.data;
          if (isFirstPlace) {
            isFirstPlace = false;
            setGlobePlaces([]);
            setGlobeArcs([]);
            setGlobePois([]);
            setGlobeIssues([]);
          }
          setGlobePlaces((prev) =>
            prev.some((place) => place.name === name) ? prev : [...prev, { name, lat, lng }],
          );
          if (kind === 'destination') {
            setGlobeFocus({ name, lat, lng });
            // Ein neues Ziel löst eine ältere Route ab. Gehört das Ziel selbst
            // zu einer Route, kommt die danach per stops.updated.
            setGlobeRoute(null);
          }
        } else if (event.type === 'route.added') {
          const { from, to } = event.data;
          setGlobeArcs((prev) => [...prev, { from: [from.lat, from.lng], to: [to.lat, to.lng] }]);
        } else if (event.type === 'stops.updated') {
          setGlobeRoute(event.data.stops);
        } else if (event.type === 'lodging.updated') {
          setGlobePois(lodgingPoints(run));
        } else if (event.type === 'critique') {
          setGlobeIssues(issueMarkers(run.critiques));
        }
      }

      if (run.status === 'error') {
        throw new Error(run.error, { cause: 'run.error' });
      }
      if (run.reply === undefined) {
        // Verbindung ist abgerissen, bevor die Antwort kam
        throw new Error('Stream ohne Antwort beendet');
      }
      const finished = run;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: finished.reply ?? '',
          sources: finished.sources,
          searchAttempted: finished.searchAttempted,
          trace: finished,
        },
      ]);
    } catch (error) {
      // Kein Absturz und kein ewiger Spinner, wenn die API nicht erreichbar
      // ist oder mit einem Fehler antwortet: der Chat sagt es stattdessen.
      // Ein run.error bringt seine eigene, verständliche Meldung mit.
      const serverMessage =
        error instanceof Error && error.cause === 'run.error' ? error.message : null;
      const tooManyRequests = error instanceof Error && error.cause === 429;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            serverMessage ??
            (tooManyRequests
              ? 'Gerade kommen zu viele Anfragen an. Warte kurz und versuch es dann noch einmal.'
              : 'Der Reiseplaner ist gerade nicht erreichbar. Versuch es bitte gleich noch einmal.'),
          trace: run,
        },
      ]);
    } finally {
      setLiveRun(null);
      setIsLoading(false);
    }
  }

  // Vor der ersten Nachricht steht der Globus mittig hinter dem Startbildschirm,
  // danach rückt er ganz sichtbar an den rechten Rand, damit der Chat lesbar bleibt.
  // Nur Position und Deckkraft animieren: eine Größenänderung würde die
  // WebGL-Fläche in jedem Frame neu aufbauen.
  // Fest am Browserfenster (fixed) statt am Chat-Bereich: Der wächst mit jeder
  // Antwort, ein daran zentrierter Globus rutschte sonst nach unten und
  // verschwand beim Scrollen aus dem Blick. Die Mitte liegt 1,5rem unter der
  // Fenstermitte, also in der Mitte der Fläche unter der Navigationsleiste.
  const hasStarted = messages.length > 0 || isLoading;
  // Welche Antwort den neuesten Entwurf trägt ("Plan speichern")
  const versions = draftVersions(messages.map((message) => message.trace));

  return (
    <>
      <div
        aria-hidden="true"
        className={
          'pointer-events-none fixed top-[calc(50%_+_1.5rem)] size-[min(36rem,100vw)] -translate-y-1/2 transition-all duration-1000 ease-in-out motion-reduce:transition-none ' +
          (hasStarted
            ? 'left-[calc(100%_-_min(36rem,100vw)_-_1.5rem)] translate-x-0 opacity-40 sm:opacity-90'
            : 'left-1/2 -translate-x-1/2 opacity-40 dark:opacity-60')
        }
      >
        <TripGlobe
          focus={globeFocus}
          route={globeRoute}
          places={globePlaces}
          arcs={globeArcs}
          pois={globePois}
          issues={globeIssues}
        />
      </div>
      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col p-4">
        <div className="mb-4 flex flex-1 flex-col gap-4 overflow-y-auto">
          {messages.length === 0 && !isLoading && <EmptyState onPick={setInput} />}

          {messages.map((message, index) =>
            message.role === 'user' ? (
              <div key={index} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-navy px-4 py-2 text-white dark:bg-teal">
                  {message.content}
                </p>
              </div>
            ) : (
              <div key={index} className="max-w-[92%]">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-dim">
                  KI-Planer
                </p>
                <div className="rounded-2xl rounded-tl-sm border border-rule bg-card px-4 py-3">
                  <ReplyMarkdown text={message.content} />
                  {message.trace?.weather.map((report) => (
                    <WeatherStrip key={report.place.name} report={report} />
                  ))}
                  {message.trace?.lodging.map((report) => (
                    <LodgingList key={report.place.name} report={report} />
                  ))}
                  {message.trace?.budget && <BudgetBar report={message.trace.budget} />}
                  {message.trace && <CritiquePanel critiques={message.trace.critiques} />}
                  <SourcesPanel
                    sources={message.sources}
                    searchAttempted={message.searchAttempted}
                  />
                  {message.trace && <TracePanel run={message.trace} />}
                </div>
                {/* Multi-Modus: Der Plan ist ein Entwurf, gespeichert wird erst
                    hier, und nur der neueste; ältere Fassungen sind überholt */}
                {message.trace?.draft && versions[index] && (
                  <SaveDraftButton
                    itinerary={message.trace.draft.itinerary}
                    revision={message.trace.draft.revision}
                    superseded={versions[index] === 'superseded'}
                  />
                )}
              </div>
            ),
          )}

          {liveRun && (
            <div className="max-w-[92%]">
              <TracePanel run={liveRun} live />
              {/* Wetter schon während des Laufs, sobald get_weather fertig ist */}
              {liveRun.weather.map((report) => (
                <WeatherStrip key={report.place.name} report={report} />
              ))}
              {liveRun.lodging.map((report) => (
                <LodgingList key={report.place.name} report={report} />
              ))}
              {liveRun.budget && <BudgetBar report={liveRun.budget} />}
              <CritiquePanel critiques={liveRun.critiques} />
            </div>
          )}
        </div>

        <ModeToggle mode={agentMode} onChange={storeAgentMode} />
        <form
          onSubmit={handleSubmit}
          className="flex gap-2 rounded-xl border border-rule bg-card p-2 focus-within:border-teal"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Beschreib deine Reisewünsche..."
            className="flex-1 bg-transparent px-2 py-1.5 outline-none placeholder:text-dim"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-lg bg-stamp px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Senden
          </button>
        </form>
      </div>
    </>
  );
}
