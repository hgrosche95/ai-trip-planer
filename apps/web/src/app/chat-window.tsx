'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { authFetch } from '@/lib/auth';
import BudgetBar from '@/components/budget-bar';
import ConfirmButton from '@/components/confirm-button';
import CritiquePanel from '@/components/critique-panel';
import DraftCanvas, { type CanvasDraft } from '@/components/draft-canvas';
import LodgingList from '@/components/lodging-list';
import ModeToggle from '@/components/mode-toggle';
import ReplyMarkdown from '@/components/reply-markdown';
import TracePanel from '@/components/trace-panel';
import TripGlobe, { type GlobeArc, type GlobeFocus } from '@/components/trip-globe';
import WeatherStrip from '@/components/weather-strip';
import {
  DEFAULT_AGENT_MODE,
  readStoredAgentMode,
  storeAgentMode,
  subscribeAgentMode,
} from '@/lib/agent-mode';
import { clearChatSession, readChatSession, writeChatSession } from '@/lib/chat-session';
import { issueMarkers, type IssueMarker } from '@/lib/critique';
import { draftVersions } from '@/lib/draft-versions';
import type { ChatSource } from '@/lib/run-events';
import { globeView, lodgingPoints } from '@/lib/replay';
import { applyRunEvent, initialRunState, type RunState } from '@/lib/run-state';
import { readRunEvents } from '@/lib/sse';
import { nextTabIndex } from '@/lib/tabs';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  searchAttempted?: boolean;
  // Ablauf des Agenten, der zu dieser Antwort geführt hat
  trace?: RunState;
  // Fehlgeschlagene Anfrage: diese Nachricht schickt "Erneut senden" noch mal
  retry?: string;
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
            'rounded border border-dashed border-teal bg-teal/5 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-teal dark:border-teal-300 dark:text-teal-300';

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
        <h1 className="text-3xl font-extrabold text-balance">
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
            className="rounded-xl border border-rule bg-card p-3 text-left text-sm transition hover:border-teal focus-visible:outline-2 focus-visible:outline-(--focus)"
          >
            <span className="block font-mono text-[11px] uppercase tracking-wider text-teal dark:text-teal-300">
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
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Gespeicherte Entwürfe: Index der Antwort im Chat -> ID der Reise
  const [saved, setSaved] = useState<Record<number, string>>({});
  // Erst nach dem Wiederherstellen sichern, sonst überschriebe der leere
  // Anfangszustand die Sicherung
  const [restored, setRestored] = useState(false);
  // Für Screenreader: was sich nach einem Lauf geändert hat
  const [announcement, setAnnouncement] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const viewTabs = useRef<(HTMLButtonElement | null)[]>([]);
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
  // Auf der Arbeitsfläche gezeigter Entwurf (Index seiner Antwort im Chat),
  // null = immer der neueste
  const [shownDraft, setShownDraft] = useState<number | null>(null);
  // Schmale Bildschirme zeigen Chat oder Plan, breite beides nebeneinander
  const [view, setView] = useState<'chat' | 'plan'>('chat');
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

  // Chat und Entwürfe aus dem Tab zurückholen (Neuladen, Rückweg von
  // "Meine Reisen"). Erst hier, nicht im Initialzustand: sessionStorage gibt
  // es beim Vorrendern nicht, das HTML muss beim Hydrieren übereinstimmen.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- einmaliges Wiederherstellen aus dem Browser-Speicher */
    const stored = readChatSession<ChatMessage>();
    if (stored && stored.messages.length > 0) {
      setSessionId(stored.sessionId);
      setMessages(stored.messages);
      setSaved(stored.saved);
      const lastTrace = stored.messages.findLast((message) => message.trace)?.trace;
      if (lastTrace) {
        const view = globeView(lastTrace);
        setGlobeFocus(view.focus);
        setGlobePlaces(view.places);
        setGlobeArcs(view.arcs);
        setGlobeRoute(view.route);
        setGlobePois(view.pois);
        setGlobeIssues(view.issues);
      }
    }
    setRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (restored) writeChatSession({ sessionId, messages, saved });
  }, [restored, sessionId, messages, saved]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const userMessage = input.trim();
    if (!userMessage || isLoading) return;
    setInput('');
    await send(userMessage);
  }

  async function send(userMessage: string) {
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setAnnouncement('');
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
      // Ein neuer Entwurf erscheint sofort auf der Arbeitsfläche
      if (finished.draft) setShownDraft(null);
      setAnnouncement(
        finished.draft
          ? `Antwort da. Entwurf, Fassung ${finished.draft.revision ?? 1}, steht im Plan.`
          : 'Antwort des KI-Planers ist da.',
      );
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
          retry: userMessage,
        },
      ]);
      setAnnouncement('Die Anfrage hat nicht geklappt. Du kannst sie erneut senden.');
    } finally {
      setLiveRun(null);
      setIsLoading(false);
    }
  }

  const hasStarted = messages.length > 0 || isLoading;
  // Welche Antwort den neuesten Entwurf trägt ("Plan speichern")
  const versions = draftVersions(messages.map((message) => message.trace));
  // Alle abgeschlossenen Entwürfe der Session, in Reihenfolge des Chats
  const drafts: CanvasDraft[] = messages.flatMap((message, index) =>
    versions[index] && message.trace?.draft
      ? [{ messageIndex: index, run: message.trace as CanvasDraft['run'] }]
      : [],
  );
  const hasCanvas = drafts.length > 0;
  const shownPosition = drafts.findIndex((draft) => draft.messageIndex === shownDraft);
  const selectedDraft = shownPosition === -1 ? drafts.length - 1 : shownPosition;

  function showDraft(messageIndex: number) {
    setShownDraft(messageIndex);
    setView('plan');
  }

  // Ungespeicherter neuester Entwurf: Schließen des Tabs verliert ihn
  const latestDraft = drafts.at(-1);
  const hasUnsavedDraft = latestDraft !== undefined && !(latestDraft.messageIndex in saved);

  useEffect(() => {
    if (!hasUnsavedDraft) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedDraft]);

  function startOver() {
    clearChatSession();
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setSaved({});
    setShownDraft(null);
    setView('chat');
    setGlobeFocus(null);
    setGlobePlaces([]);
    setGlobeArcs([]);
    setGlobeRoute(null);
    setGlobePois([]);
    setGlobeIssues([]);
    setAnnouncement('Neue Reise begonnen.');
    inputRef.current?.focus();
  }

  function pickExample(prompt: string) {
    setInput(prompt);
    inputRef.current?.focus();
  }

  const globe = (
    <TripGlobe
      focus={globeFocus}
      route={globeRoute}
      places={globePlaces}
      arcs={globeArcs}
      pois={globePois}
      issues={globeIssues}
    />
  );

  const conversation = (
    <div className="mb-4 flex flex-1 flex-col gap-4">
      {messages.length === 0 && !isLoading && <EmptyState onPick={pickExample} />}

      {messages.map((message, index) => {
        if (message.role === 'user') {
          return (
            <div key={index} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-navy px-4 py-2 text-white dark:bg-teal">
                {message.content}
              </p>
            </div>
          );
        }
        // Antworten mit Entwurf bleiben im Chat kurz: Plan, Wetter, Budget
        // und Ablauf stehen auf der Arbeitsfläche daneben
        const draft = versions[index] ? message.trace?.draft : undefined;
        return (
          <div key={index} className="max-w-[92%]">
            <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-dim">
              KI-Planer
            </p>
            <div className="rounded-2xl rounded-tl-sm border border-rule bg-card px-4 py-3">
              <ReplyMarkdown text={message.content} />
              {!draft && (
                <>
                  {message.trace?.weather.map((report) => (
                    <WeatherStrip key={report.place.name} report={report} />
                  ))}
                  {message.trace?.lodging.map((report) => (
                    <LodgingList key={report.place.name} report={report} />
                  ))}
                  {message.trace?.budget && <BudgetBar report={message.trace.budget} />}
                  {message.trace && <CritiquePanel critiques={message.trace.critiques} />}
                </>
              )}
              <SourcesPanel sources={message.sources} searchAttempted={message.searchAttempted} />
              {message.trace && !draft && <TracePanel run={message.trace} />}
            </div>
            {message.retry && index === messages.length - 1 && !isLoading && (
              <button
                type="button"
                onClick={() => {
                  // Die fehlgeschlagene Runde ersetzt der neue Versuch
                  setMessages((prev) => prev.slice(0, -2));
                  void send(message.retry!);
                }}
                className="mt-2 min-h-9 rounded-lg border border-rule bg-card px-3 text-sm font-semibold hover:border-teal"
              >
                Erneut senden
              </button>
            )}
            {draft && (
              <button
                type="button"
                onClick={() => showDraft(index)}
                aria-pressed={drafts[selectedDraft]?.messageIndex === index}
                className={
                  'mt-2 min-h-9 rounded-md border border-dashed px-2.5 font-mono text-xs focus-visible:outline-2 focus-visible:outline-(--focus) ' +
                  (drafts[selectedDraft]?.messageIndex === index
                    ? 'border-teal text-teal dark:border-teal-300 dark:text-teal-300'
                    : 'border-rule text-dim hover:border-teal hover:text-teal')
                }
              >
                Fassung {draft.revision}
                {versions[index] === 'superseded' && ' (älter)'} · im Plan ansehen
              </button>
            )}
          </div>
        );
      })}

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
  );

  const newTripClass =
    'min-h-8 rounded-lg px-2 text-xs font-semibold text-dim hover:bg-card hover:text-foreground';
  const composer = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModeToggle mode={agentMode} onChange={storeAgentMode} />
        {messages.length > 0 && !isLoading && (
          <div className="mb-2">
            {hasUnsavedDraft ? (
              <ConfirmButton
                label="Neue Reise"
                question="Entwurf verwerfen?"
                confirmLabel="Verwerfen"
                onConfirm={startOver}
                className={newTripClass}
              />
            ) : (
              <button type="button" onClick={startOver} className={newTripClass}>
                Neue Reise
              </button>
            )}
          </div>
        )}
      </div>
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 rounded-xl border border-rule bg-card p-2 focus-within:border-teal"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ziel, Zeitraum, Budget …"
          aria-label="Nachricht"
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 outline-none placeholder:text-dim"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-navy px-4 py-2 font-semibold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-(--focus) dark:bg-foreground dark:text-background"
        >
          Senden
        </button>
      </form>
    </>
  );

  const announcer = (
    <p role="status" className="sr-only">
      {announcement}
    </p>
  );

  if (hasCanvas) {
    // Chat links, Arbeitsfläche mit dem Entwurf rechts. Die Seite scrollt mit
    // dem Chat, die Arbeitsfläche bleibt dabei stehen (sticky) und scrollt für
    // sich. Unter lg zeigt ein Umschalter entweder Chat oder Plan.
    const tabClass = (active: boolean) =>
      'py-3 text-sm font-bold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus) ' +
      (active ? 'bg-navy text-white dark:bg-foreground dark:text-background' : 'bg-card text-dim');
    return (
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(22rem,28rem)_minmax(0,1fr)]">
        {announcer}
        <div
          role="tablist"
          aria-label="Chat oder Plan"
          className="sticky top-0 z-10 grid grid-cols-2 overflow-hidden border-b border-rule lg:hidden"
        >
          {(['chat', 'plan'] as const).map((entry, index) => (
            <button
              key={entry}
              ref={(element) => {
                viewTabs.current[index] = element;
              }}
              id={`view-tab-${entry}`}
              type="button"
              role="tab"
              aria-selected={view === entry}
              aria-controls={`view-panel-${entry}`}
              tabIndex={view === entry ? 0 : -1}
              onClick={() => setView(entry)}
              onKeyDown={(event) => {
                const next = nextTabIndex(event.key, index, 2);
                if (next === undefined) return;
                event.preventDefault();
                setView(next === 0 ? 'chat' : 'plan');
                viewTabs.current[next]?.focus();
              }}
              className={tabClass(view === entry)}
            >
              {entry === 'chat' ? 'Chat' : `Plan · Fassung ${drafts[selectedDraft].run.draft.revision}`}
            </button>
          ))}
        </div>
        <div
          id="view-panel-chat"
          aria-labelledby="view-tab-chat"
          className={
            (view === 'chat' ? 'flex' : 'hidden') +
            ' min-w-0 flex-1 flex-col p-4 lg:flex lg:border-r lg:border-rule'
          }
        >
          {conversation}
          <div className="sticky bottom-0 bg-background pb-1 pt-2">{composer}</div>
        </div>
        <div
          id="view-panel-plan"
          aria-labelledby="view-tab-plan"
          className={
            (view === 'plan' ? 'block' : 'hidden') +
            ' min-w-0 flex-1 lg:sticky lg:top-0 lg:block lg:h-dvh lg:self-start lg:overflow-y-auto'
          }
        >
          <DraftCanvas
            drafts={drafts}
            selected={selectedDraft}
            onSelect={(position) => setShownDraft(drafts[position].messageIndex)}
            saved={saved}
            onSaved={(messageIndex, id) => setSaved((prev) => ({ ...prev, [messageIndex]: id }))}
          />
        </div>
      </div>
    );
  }

  // Vor der ersten Nachricht steht der Globus mittig hinter dem Startbildschirm,
  // danach rückt er ganz sichtbar an den rechten Rand, damit der Chat lesbar bleibt.
  // Nur Position und Deckkraft animieren: eine Größenänderung würde die
  // WebGL-Fläche in jedem Frame neu aufbauen.
  // Fest am Browserfenster (fixed) statt am Chat-Bereich: Der wächst mit jeder
  // Antwort, ein daran zentrierter Globus rutschte sonst nach unten und
  // verschwand beim Scrollen aus dem Blick. Die Mitte liegt 1,5rem unter der
  // Fenstermitte, also in der Mitte der Fläche unter der Navigationsleiste.
  // Sobald es einen Entwurf gibt, zeigt die Arbeitsfläche eine Stadtkarte statt des Globus.
  return (
    <>
      {announcer}
      <div
        aria-hidden="true"
        className={
          'pointer-events-none fixed top-[calc(50%_+_1.5rem)] size-[min(36rem,100vw)] -translate-y-1/2 transition-all duration-1000 ease-in-out motion-reduce:transition-none ' +
          (hasStarted
            ? 'left-[calc(100%_-_min(36rem,100vw)_-_1.5rem)] translate-x-0 opacity-40 sm:opacity-90'
            : 'left-1/2 -translate-x-1/2 opacity-40 dark:opacity-60')
        }
      >
        {globe}
      </div>
      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col p-4">
        {conversation}
        {composer}
      </div>
    </>
  );
}
