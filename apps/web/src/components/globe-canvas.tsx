'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { Color, MeshPhongMaterial, TextureLoader } from 'three';

export interface GlobeArc {
  from: [lat: number, lng: number];
  to: [lat: number, lng: number];
}

export interface GlobeFocus {
  name: string;
  lat: number;
  lng: number;
}

export interface GlobeCanvasProps {
  arcs?: GlobeArc[];
  autoRotate?: boolean;
  // Ort, zu dem der Globus dreht und den er markiert
  focus?: GlobeFocus | null;
  // Weitere Orte, die markiert werden (z. B. der Abreiseort), ohne dass die
  // Kamera zu ihnen dreht
  places?: GlobeFocus[];
  // Stationen einer Reise in Reihenfolge: werden markiert und mit Bögen
  // verbunden, die Kamera nimmt die ganze Route ins Bild. Hat Vorrang vor focus.
  route?: GlobeFocus[] | null;
  // Orte in der Nähe (z. B. Unterkünfte): kleine Punkte ohne Ring und ohne
  // Beschriftung, der Name steht im Tooltip. Die Kamera richtet sich nicht nach ihnen.
  pois?: GlobeFocus[];
  // Befunde des Kritikers an Programmpunkten: roter Ring, solange offen,
  // grüner, sobald eine Nachbesserung sie behoben hat
  issues?: (GlobeFocus & { resolved: boolean })[];
}

type GlobePoint = GlobeFocus & { poi: boolean };

// Unterkünfte in Türkis, damit sie sich von den weißen Reisezielen abheben
const POI_COLOR = '#7FD1CF';
const POI_RADIUS = 0.06;

// Ringe als RGB: Ziel orange, Befund des Kritikers rot, behoben grün
const RING_COLORS = {
  focus: '242, 165, 65',
  issue: '200, 65, 43',
  resolved: '46, 196, 140',
};
// Befunde liegen oft dicht beieinander in einer Stadt: kleinere Ringe als
// der am Ziel, damit sie sich nicht überdecken
type GlobeRing = GlobeFocus & { color: string; radius: number };

// Texturen stammen aus three-globe (NASA Blue Marble, gemeinfrei) und liegen
// in public/globe, damit sie mit dem statischen Export ausgeliefert werden.
// Als WebP in 2048 px Breite, das reicht für den ganzen Globus. Erst wenn er auf
// ein Reiseziel heranzoomt, wird die 4096er-Fassung nachgeladen, damit der
// Ausschnitt scharf bleibt; der erste Seitenaufruf lädt sie nicht.
const TEXTURES = {
  day: '/globe/earth-blue-marble.webp',
  dayDetail: '/globe/earth-blue-marble-4096.webp',
  bump: '/globe/earth-topology.webp',
  water: '/globe/earth-water.webp',
};

// Abstand der Kamera in Globus-Radien: 2,2 zeigt die ganze Erde, 0,5 etwa
// die Iberische Halbinsel rund um Lissabon. Näher wird selbst die 4096er-Textur
// matschig.
const ALTITUDE_OVERVIEW = 2.2;
const ALTITUDE_FOCUS = 0.5;

type PointOfView = { lat: number; lng: number; altitude: number };

// Kamera für eine Route: Mittelpunkt über Einheitsvektoren (klappt auch über
// die Datumsgrenze hinweg), Abstand so, dass die am weitesten entfernte
// Station noch mit Rand ins Bild passt. Etwa 25° Bogen pro Globus-Radius
// Abstand, empirisch: 0,5 zeigt rund 12° um den Mittelpunkt.
function viewForRoute(route: GlobeFocus[]): PointOfView {
  const toRad = Math.PI / 180;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const stop of route) {
    x += Math.cos(stop.lat * toRad) * Math.cos(stop.lng * toRad);
    y += Math.cos(stop.lat * toRad) * Math.sin(stop.lng * toRad);
    z += Math.sin(stop.lat * toRad);
  }
  const lat = Math.atan2(z, Math.hypot(x, y)) / toRad;
  const lng = Math.atan2(y, x) / toRad;
  const maxDistance = Math.max(
    ...route.map((stop) => greatCircleDegrees(lat, lng, stop.lat, stop.lng)),
  );
  const altitude = Math.min(ALTITUDE_OVERVIEW, Math.max(ALTITUDE_FOCUS, maxDistance / 20));
  return { lat, lng, altitude };
}

// Höchstens drei Namen, sonst wird die Beschriftung breiter als der Globus
function groupLabel(names: string[]) {
  if (names.length <= 3) return names.join(' · ');
  return `${names.slice(0, 2).join(' · ')} +${names.length - 2}`;
}

// Beschriftung als HTML statt als 3D-Text: die eingebaute 3D-Schrift von
// three-globe kennt nur ASCII, aus "Düsseldorf" wurde "D?sseldorf".
// textContent statt innerHTML, weil der Name vom Modell kommt.
// Zwei Ebenen, weil three-globe das transform des äußeren Elements für die
// Position setzt; der Versatz über den Punkt sitzt deshalb innen.
function placeLabel(name: string, small: boolean) {
  const anchor = document.createElement('div');
  anchor.style.cssText = 'pointer-events: none; transition: opacity 250ms';
  const label = document.createElement('div');
  label.textContent = name;
  label.style.cssText = [
    'color: #fff',
    `font: 600 ${small ? 11 : 13}px/1.2 system-ui, sans-serif`,
    'text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9)',
    'white-space: nowrap',
    'transform: translateY(-14px)',
  ].join(';');
  anchor.append(label);
  return anchor;
}

// Der Tooltip (pointLabel) wird als HTML gesetzt. Namen kommen vom Modell
// oder aus OpenStreetMap, deshalb maskieren.
function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

function greatCircleDegrees(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = Math.PI / 180;
  const cos =
    Math.sin(lat1 * toRad) * Math.sin(lat2 * toRad) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lng2 - lng1) * toRad);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / toRad;
}

export default function GlobeCanvas({
  arcs = [],
  autoRotate = true,
  focus = null,
  places = [],
  route = null,
  pois = [],
  issues = [],
}: GlobeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dayTexture, setDayTexture] = useState(TEXTURES.day);

  // Wasser glänzt, Land nicht: die Wasser-Maske dient als Specular Map.
  const material = useMemo(() => {
    const phong = new MeshPhongMaterial();
    new TextureLoader().load(TEXTURES.water, (texture) => {
      phong.specularMap = texture;
      phong.specular = new Color('#4a5f73');
      phong.shininess = 18;
      phong.needsUpdate = true;
    });
    return phong;
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Eine Route mit nur einer Station ist ein einzelnes Ziel
  const hasRoute = route !== null && route.length > 1;
  const view = useMemo<PointOfView | null>(() => {
    if (route && route.length > 1) return viewForRoute(route);
    const target = route?.[0] ?? focus;
    if (!target) return null;
    // Abreiseort und Ziel zusammen ins Bild, damit der Flugbogen ganz zu sehen ist
    const others = route?.length ? [] : places.filter((place) => place.name !== target.name);
    if (others.length > 0) return viewForRoute([...others, target]);
    return { lat: target.lat, lng: target.lng, altitude: ALTITUDE_FOCUS };
  }, [route, focus, places]);

  // Neues Ziel oder neue Route: Drehung stoppen und in 1,5 s heranzoomen.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !view) return;
    globe.controls().autoRotate = false;
    globe.pointOfView(view, 1500);
  }, [view]);

  // Die scharfe Textur erst vorladen und dann tauschen, damit der Globus
  // nicht kurz ohne Textur dasteht.
  const wantsDetail = view !== null && view.altitude < 1;
  useEffect(() => {
    if (!wantsDetail) return;
    const image = new Image();
    image.onload = () => setDayTexture(TEXTURES.dayDetail);
    image.src = TEXTURES.dayDetail;
    return () => {
      image.onload = null;
    };
  }, [wantsDetail]);

  // Ohne Route: das Ziel plus weitere Orte wie der Abreiseort, jeder Ort einmal
  const markers = useMemo(() => {
    if (route && route.length > 0) return route;
    const all = focus ? [...places, focus] : places;
    return all.filter((place, index) => all.findIndex((p) => p.name === place.name) === index);
  }, [route, focus, places]);
  // Aufeinanderfolgende Stationen verbinden
  const routeArcs = useMemo<GlobeArc[]>(
    () =>
      hasRoute
        ? route!.slice(1).map((stop, index) => ({
            from: [route![index].lat, route![index].lng],
            to: [stop.lat, stop.lng],
          }))
        : [],
    [hasRoute, route],
  );
  const allArcs = useMemo(() => [...arcs, ...routeArcs], [arcs, routeArcs]);
  // Ziele zuletzt, damit sie über den Unterkünften liegen
  const points = useMemo<GlobePoint[]>(
    () => [
      ...pois.map((poi) => ({ ...poi, poi: true })),
      ...markers.map((marker) => ({ ...marker, poi: false })),
    ],
    [pois, markers],
  );
  // Der pulsierende Ring nur am Start der Route bzw. am Ziel, sonst flimmert
  // es überall. Dazu je ein Ring pro Befund des Kritikers.
  const rings = useMemo<GlobeRing[]>(
    () => [
      ...(hasRoute ? markers.slice(0, 1) : focus ? [focus] : markers.slice(0, 1)).map(
        (marker) => ({ ...marker, color: RING_COLORS.focus, radius: 2 }),
      ),
      ...issues.map((issue) => ({
        ...issue,
        color: issue.resolved ? RING_COLORS.resolved : RING_COLORS.issue,
        radius: 0.6,
      })),
    ],
    [hasRoute, markers, focus, issues],
  );
  // Jede Station bekommt einen Punkt. Liegen Stationen zu nah beieinander
  // (z.B. Düsseldorf, Köln, Bonn), stünden ihre Namen übereinander: dann
  // trägt die erste Beschriftung die Namen der Nachbarn mit, statt dass die
  // anderen Stationen scheinbar fehlen. Der Mindestabstand wächst mit dem
  // Zoom, weil er in Grad auf dem Globus bemessen ist.
  const labels = useMemo<GlobeFocus[]>(() => {
    if (!hasRoute || !view) return markers;
    const minDistance = view.altitude * 1.5;
    const groups: { anchor: GlobeFocus; names: string[] }[] = [];
    for (const stop of markers) {
      const near = groups.find(
        ({ anchor }) =>
          greatCircleDegrees(anchor.lat, anchor.lng, stop.lat, stop.lng) < minDistance,
      );
      if (!near) groups.push({ anchor: stop, names: [stop.name] });
      else if (!near.names.includes(stop.name)) near.names.push(stop.name);
    }
    return groups.map(({ anchor, names }) => ({ ...anchor, name: groupLabel(names) }));
  }, [hasRoute, view, markers]);

  function handleGlobeReady() {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls();
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotate = autoRotate && !prefersReducedMotion && !view;
    controls.autoRotateSpeed = 0.35;
    controls.enableZoom = false;
    globe.pointOfView(view ?? { lat: 35, lng: 10, altitude: ALTITUDE_OVERVIEW });
  }

  // Heranzoomen füllt die ganze Fläche mit Erde; ohne Maske stünde dann ein
  // hartes Quadrat auf dem Seitenhintergrund. Der runde, weich auslaufende
  // Ausschnitt beginnt erst außerhalb der Atmosphäre des ganzen Globus
  // (Abstand 2,2 füllt gut 70 % des Radius), die Übersicht bleibt also gleich.
  return (
    <div
      ref={containerRef}
      className="h-full w-full [mask-image:radial-gradient(circle_closest-side,black_95%,transparent_100%)]"
    >
      {size.width > 0 && (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl={dayTexture}
          bumpImageUrl={TEXTURES.bump}
          globeMaterial={material}
          atmosphereColor="#7FD1CF"
          atmosphereAltitude={0.18}
          arcsData={allArcs}
          arcStartLat={(arc) => (arc as GlobeArc).from[0]}
          arcStartLng={(arc) => (arc as GlobeArc).from[1]}
          arcEndLat={(arc) => (arc as GlobeArc).to[0]}
          arcEndLng={(arc) => (arc as GlobeArc).to[1]}
          arcColor={() => ['#C8412B', '#F2A541']}
          arcStroke={0.6}
          arcDashLength={0.4}
          arcDashGap={0.2}
          arcDashAnimateTime={2500}
          arcAltitudeAutoScale={0.4}
          ringsData={rings}
          ringLat={(marker) => (marker as GlobeFocus).lat}
          ringLng={(marker) => (marker as GlobeFocus).lng}
          ringColor={(ring: object) => (t: number) => `rgba(${(ring as GlobeRing).color}, ${1 - t})`}
          ringMaxRadius={(ring: object) => (ring as GlobeRing).radius}
          ringPropagationSpeed={2}
          ringRepeatPeriod={1200}
          pointsData={points}
          pointLat={(point) => (point as GlobePoint).lat}
          pointLng={(point) => (point as GlobePoint).lng}
          pointColor={(point) => ((point as GlobePoint).poi ? POI_COLOR : '#FFFFFF')}
          pointAltitude={0.002}
          pointRadius={(point) =>
            (point as GlobePoint).poi ? POI_RADIUS : hasRoute ? 0.18 : 0.25
          }
          pointLabel={(point) => escapeHtml((point as GlobePoint).name)}
          htmlElementsData={labels}
          htmlLat={(marker) => (marker as GlobeFocus).lat}
          htmlLng={(marker) => (marker as GlobeFocus).lng}
          htmlElement={(marker) => placeLabel((marker as GlobeFocus).name, hasRoute)}
          htmlElementVisibilityModifier={(el, isVisible) => {
            el.style.opacity = isVisible ? '1' : '0';
          }}
          onGlobeReady={handleGlobeReady}
        />
      )}
    </div>
  );
}
