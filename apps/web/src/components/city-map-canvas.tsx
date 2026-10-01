'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { dayRoutes, mapStops, stopBounds, type MapStopInput } from '@/lib/city-map';

// Freie Vektorkacheln ohne Schlüssel (OpenStreetMap-Daten)
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const FIT = { padding: 48, maxZoom: 15, duration: 0 };

// Worker aus public/ (scripts/copy-maplibre-worker.mjs): Neben dem
// gebündelten Modul, wo MapLibre ihn sonst sucht, liegt er nicht
maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

export interface CityMapProps {
  stops: MapStopInput[];
  // Hervorgehobener Tag, die anderen treten zurück; null = alle gleich
  activeDay: number | null;
  onDayClick?: (dayNumber: number) => void;
}

// Tagesfarbe als echter Farbwert: MapLibre versteht keine CSS-Variablen
function dayColor(dayNumber: number) {
  const variable = `--day-${((dayNumber - 1) % 4) + 1}`;
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || '#14213D';
}

// Äußeres Element positioniert MapLibre per transform, deshalb sitzen Stil
// und Hervorhebung (scale) auf dem inneren
function markerElement(dayNumber: number, index: number, title: string) {
  const element = document.createElement('div');
  element.dataset.day = String(dayNumber);
  element.setAttribute('aria-hidden', 'true');
  const dot = document.createElement('div');
  dot.className = 'city-map-marker';
  dot.textContent = String(index);
  dot.title = `Tag ${dayNumber} · ${title}`;
  dot.style.background = `var(--day-${((dayNumber - 1) % 4) + 1})`;
  element.append(dot);
  return element;
}

// Stadtkarte mit den Programmpunkten: nummerierte Marker und ein Weg pro Tag
// in der Tagesfarbe. Die Liste daneben bleibt die zugängliche Fassung; die
// Kartenfläche ist für Screenreader verborgen, die Region beschreibt sie.
export default function CityMapCanvas({ stops, activeDay, onDayClick }: CityMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const onDayClickRef = useRef(onDayClick);
  const bounds = useRef<ReturnType<typeof stopBounds>>(null);
  const [failed, setFailed] = useState(false);
  const points = mapStops(stops);
  const key = JSON.stringify(points);

  useEffect(() => {
    onDayClickRef.current = onDayClick;
  }, [onDayClick]);

  // Karte einmal anlegen
  useEffect(() => {
    if (!container.current) return;
    let instance: maplibregl.Map;
    try {
      instance = new maplibregl.Map({
        container: container.current,
        style: STYLE_URL,
        center: [0, 0],
        zoom: 1,
        attributionControl: { compact: true },
        // Scrollen über die Karte scrollt die Seite; zoomen mit Strg/zwei Fingern
        cooperativeGestures: true,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch {
      // Kein WebGL: Die Liste reicht, die Karte meldet sich ab
      // eslint-disable-next-line react-hooks/set-state-in-effect -- einmalige Rückmeldung beim Anlegen
      setFailed(true);
      return;
    }
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.getCanvas().setAttribute('aria-hidden', 'true');
    map.current = instance;
    // Die Fläche kann nach dem Anlegen noch wachsen (Skelett -> Inhalt,
    // Tab-Wechsel, Umbruch ab xl): Größe nachziehen und den Ausschnitt neu
    // einpassen, sonst zeichnet die Karte nur in einer Ecke
    const observer = new ResizeObserver(() => {
      instance.resize();
      if (bounds.current) instance.fitBounds(bounds.current, FIT);
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, []);

  // Marker, Wege und Ausschnitt, sobald sich die Punkte ändern
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const current: typeof points = JSON.parse(key);

    markers.current.forEach((marker) => marker.remove());
    markers.current = current.map((stop) => {
      const element = markerElement(stop.dayNumber, stop.index, stop.title);
      element.addEventListener('click', () => onDayClickRef.current?.(stop.dayNumber));
      return new maplibregl.Marker({ element }).setLngLat([stop.lng, stop.lat]).addTo(instance);
    });

    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: dayRoutes(current).map((route) => ({
        type: 'Feature',
        properties: { day: route.dayNumber, color: dayColor(route.dayNumber) },
        geometry: { type: 'LineString', coordinates: route.coordinates },
      })),
    };
    const addRoutes = () => {
      const source = instance.getSource('day-routes') as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
        return;
      }
      instance.addSource('day-routes', { type: 'geojson', data });
      instance.addLayer({
        id: 'day-routes',
        type: 'line',
        source: 'day-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.85 },
      });
    };
    if (instance.isStyleLoaded()) addRoutes();
    else instance.once('load', addRoutes);

    bounds.current = stopBounds(current);
    if (bounds.current) instance.fitBounds(bounds.current, FIT);
  }, [key]);

  // Hervorhebung eines Tages: Marker und Weg der anderen Tage treten zurück
  useEffect(() => {
    const instance = map.current;
    markers.current.forEach((marker) => {
      const element = marker.getElement();
      const dimmed = activeDay !== null && element.dataset.day !== String(activeDay);
      const dot = element.firstElementChild;
      dot?.classList.toggle('is-dimmed', dimmed);
      dot?.classList.toggle('is-active', activeDay !== null && !dimmed);
    });
    if (!instance) return;
    const apply = () => {
      if (!instance.getLayer('day-routes')) return;
      instance.setPaintProperty(
        'day-routes',
        'line-opacity',
        activeDay === null ? 0.85 : ['case', ['==', ['get', 'day'], activeDay], 1, 0.15],
      );
      instance.setPaintProperty(
        'day-routes',
        'line-width',
        activeDay === null ? 3 : ['case', ['==', ['get', 'day'], activeDay], 4, 3],
      );
    };
    if (instance.isStyleLoaded()) apply();
    else instance.once('idle', apply);
  }, [activeDay, key]);

  if (failed) {
    return (
      <p className="grid h-full place-items-center p-4 text-center text-sm text-dim">
        Die Karte kann in diesem Browser nicht angezeigt werden.
      </p>
    );
  }

  return (
    // Region statt Bild: Die Zoom-Knöpfe darin bleiben bedienbar
    <div
      role="region"
      aria-label={`Karte: ${points.map((stop) => `Tag ${stop.dayNumber}, ${stop.title}`).join('; ')}`}
      className="h-full w-full"
    >
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
