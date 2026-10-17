'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  nearestIndex,
  seriesFor,
  timeTicks,
  type HistoryEntry,
  type MetricDef,
  type Series,
} from '@/lib/eval-history';

const HEIGHT = 150;
const PAD = { top: 12, right: 48, bottom: 22, left: 44 };

const dayFormat = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' });

// Breite des Containers, damit Text im SVG nicht mitskaliert
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

// Pfad mit Lücken: Läufe ohne Wert (z. B. Judge aus) unterbrechen die Linie
function linePath(series: Series, x: (t: number) => number, y: (v: number) => number) {
  let d = '';
  let open = false;
  for (const point of series.points) {
    if (point.value === null) {
      open = false;
      continue;
    }
    d += `${open ? 'L' : 'M'}${x(point.time).toFixed(1)},${y(point.value).toFixed(1)}`;
    open = true;
  }
  return d;
}

// Der Punkt einer Reihe an einem Tag, falls sie dort gemessen hat
const pointAt = (series: Series, time: number) => series.points.find((p) => p.time === time);

export default function EvalChart({ metric, entries }: { metric: MetricDef; entries: HistoryEntry[] }) {
  const [containerRef, width] = useWidth();
  const series = useMemo(() => seriesFor(entries, metric), [entries, metric]);
  // Alle Zeitpunkte aller Reihen: Das Fadenkreuz rastet auf ihnen ein
  const times = useMemo(
    () => [...new Set(series.flatMap((s) => s.points.filter((p) => p.value !== null).map((p) => p.time)))].sort((a, b) => a - b),
    [series],
  );
  const [active, setActive] = useState<number | null>(null);

  // Schwelle des jüngsten Laufs; ändert sie sich, gilt die aktuelle
  const threshold = entries.length > 0 ? metric.threshold(entries.at(-1)!) : null;
  const [lo, hi] = metric.domain;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const minT = times[0] ?? 0;
  const maxT = times.at(-1) ?? 0;
  const x = (t: number) => PAD.left + (maxT === minT ? plotW : ((t - minT) / (maxT - minT)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * plotH;

  if (times.length === 0) {
    return (
      <figure className="rounded-xl border border-rule bg-card p-4">
        <ChartTitle metric={metric} />
        <p className="mt-6 mb-4 text-sm text-dim">Noch keine Messung in diesem Zeitraum.</p>
      </figure>
    );
  }

  const activeTime = active === null ? null : times[active];
  const latestValues = series.map((s) => ({ s, point: s.points.filter((p) => p.value !== null).at(-1)! }));

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const time = minT + ((px - PAD.left) / Math.max(1, plotW)) * (maxT - minT);
    setActive(nearestIndex(times, time));
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    const last = times.length - 1;
    const current = active ?? last;
    const next =
      event.key === 'ArrowLeft' ? Math.max(0, current - 1)
      : event.key === 'ArrowRight' ? Math.min(last, current + 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  }

  const tooltipLeft = activeTime === null ? 0 : x(activeTime);

  return (
    <figure className="rounded-xl border border-rule bg-card p-4">
      <ChartTitle metric={metric} />
      <div ref={containerRef} className="relative mt-3">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            tabIndex={0}
            aria-label={`${metric.label}: ${latestValues.map(({ s, point }) => `${s.provider.label} zuletzt ${metric.format(point.value!)}`).join(', ')}. Pfeiltasten zeigen einzelne Läufe.`}
            className="block touch-pan-y rounded focus-visible:outline-2 focus-visible:outline-(--focus)"
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
          >
            {/* Raster: drei Linien, zurückhaltend */}
            {[lo, (lo + hi) / 2, hi].map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} stroke="var(--rule)" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-dim font-mono text-[11px]">
                  {metric.format(v)}
                </text>
              </g>
            ))}
            {timeTicks(minT, maxT).map((t, i, all) => (
              <text
                key={t}
                x={x(t)}
                y={HEIGHT - 4}
                textAnchor={all.length === 1 ? 'end' : i === 0 ? 'start' : i === all.length - 1 ? 'end' : 'middle'}
                className="fill-dim font-mono text-[11px]"
              >
                {dayFormat.format(t)}
              </text>
            ))}

            {threshold !== null && (
              <g>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotW}
                  y1={y(threshold)}
                  y2={y(threshold)}
                  stroke="var(--dim)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
                <text x={PAD.left + plotW + 6} y={y(threshold)} dy="0.32em" className="fill-dim font-mono text-[11px]">
                  {metric.bound === 'max' ? '≤' : '≥'} {metric.format(threshold)}
                </text>
              </g>
            )}

            {activeTime !== null && (
              <line x1={x(activeTime)} x2={x(activeTime)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--dim)" strokeWidth={1} />
            )}

            {series.map((s) => {
              const valued = s.points.filter((p) => p.value !== null);
              // Wenige Punkte (z. B. Anthropic nur bei Läufen per Hand): jeden zeigen
              const markers = valued.length <= 20 ? valued : [valued.at(-1)!];
              return (
                <g key={s.provider.id}>
                  <path d={linePath(s, x, y)} fill="none" stroke={s.provider.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {markers.map((p) => (
                    <circle key={p.time} cx={x(p.time)} cy={y(p.value!)} r={4} fill={s.provider.color} stroke="var(--card)" strokeWidth={2} />
                  ))}
                  {activeTime !== null && pointAt(s, activeTime)?.value != null && (
                    <circle
                      cx={x(activeTime)}
                      cy={y(pointAt(s, activeTime)!.value!)}
                      r={5}
                      fill={s.provider.color}
                      stroke="var(--card)"
                      strokeWidth={2}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {activeTime !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-rule bg-card px-3 py-2 text-xs shadow-lg"
            // Neben das Fadenkreuz statt darüber, damit der Punkt sichtbar bleibt
            style={
              tooltipLeft < width / 2
                ? { left: Math.min(tooltipLeft + 12, Math.max(0, width - 152)) }
                : { right: Math.min(width - tooltipLeft + 12, Math.max(0, width - 152)) }
            }
          >
            <div className="font-mono text-[11px] text-dim">{dateFormat.format(activeTime)}</div>
            {series.map((s) => {
              const point = pointAt(s, activeTime);
              return (
                <div key={s.provider.id} className="mt-1 flex items-center gap-2">
                  <span aria-hidden="true" className="h-0.5 w-3 rounded" style={{ background: s.provider.color }} />
                  <span className="font-mono font-semibold tabular-nums">
                    {point?.value != null ? metric.format(point.value) : '–'}
                  </span>
                  <span className="text-dim">{s.provider.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Direkte Beschriftung: letzter Wert pro Anbieter */}
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {latestValues.map(({ s, point }) => (
          <span key={s.provider.id} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-3 rounded" style={{ background: s.provider.color }} />
            <span className="text-dim">{s.provider.label} zuletzt</span>
            <span className="font-mono font-semibold tabular-nums">{metric.format(point.value!)}</span>
          </span>
        ))}
      </figcaption>

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-dim hover:text-foreground">Als Tabelle</summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-dim">
            <tr>
              <th className="py-1 font-normal">Lauf</th>
              {series.map((s) => (
                <th key={s.provider.id} className="py-1 text-right font-normal">
                  {s.provider.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {[...times].reverse().map((t) => (
              <tr key={t} className="border-t border-rule">
                <td className="py-1">{dateFormat.format(t)}</td>
                {series.map((s) => {
                  const point = pointAt(s, t);
                  return (
                    <td key={s.provider.id} className="py-1 text-right">
                      {point?.value != null ? metric.format(point.value) : '–'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function ChartTitle({ metric }: { metric: MetricDef }) {
  return (
    <>
      <h3 className="font-bold">{metric.label}</h3>
      <p className="text-xs text-dim">{metric.hint}</p>
    </>
  );
}
