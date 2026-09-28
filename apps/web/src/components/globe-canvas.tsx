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
  // Stationen einer Reise in Reihenfolge: werden markiert und mit Bögen
  // verbunden, die Kamera nimmt die ganze Route ins Bild. Hat Vorrang vor focus.
  route?: GlobeFocus[] | null;
}

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
  route = null,
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
    return target ? { lat: target.lat, lng: target.lng, altitude: ALTITUDE_FOCUS } : null;
  }, [route, focus]);

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

  const markers = useMemo(
    () => (route && route.length > 0 ? route : focus ? [focus] : []),
    [route, focus],
  );
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
  // Der pulsierende Ring nur am Start der Route, sonst flimmert es überall
  const rings = markers.slice(0, 1);
  // Jede Station bekommt einen Punkt, aber nur Stationen mit Abstand zu den
  // schon beschrifteten einen Namen: in einer Stadt stünden die Namen sonst
  // übereinander. Der Abstand wächst mit dem Zoom, weil Beschriftungen in
  // Grad auf dem Globus bemessen sind.
  const labels = useMemo(() => {
    if (!hasRoute || !view) return markers;
    const minDistance = view.altitude * 1.5;
    const labeled: GlobeFocus[] = [];
    for (const stop of markers) {
      const isFree = labeled.every(
        (other) => greatCircleDegrees(other.lat, other.lng, stop.lat, stop.lng) >= minDistance,
      );
      if (isFree) labeled.push(stop);
    }
    return labeled;
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
          ringColor={() => (t: number) => `rgba(242, 165, 65, ${1 - t})`}
          ringMaxRadius={2}
          ringPropagationSpeed={2}
          ringRepeatPeriod={1200}
          pointsData={hasRoute ? markers : []}
          pointLat={(marker) => (marker as GlobeFocus).lat}
          pointLng={(marker) => (marker as GlobeFocus).lng}
          pointColor={() => '#FFFFFF'}
          pointAltitude={0.002}
          pointRadius={0.18}
          pointLabel={(marker) => (marker as GlobeFocus).name}
          labelsData={labels}
          labelLat={(marker) => (marker as GlobeFocus).lat}
          labelLng={(marker) => (marker as GlobeFocus).lng}
          labelText={(marker) => (marker as GlobeFocus).name}
          labelColor={() => '#FFFFFF'}
          labelSize={hasRoute ? 0.5 : 0.7}
          labelDotRadius={hasRoute ? 0 : 0.25}
          labelResolution={3}
          onGlobeReady={handleGlobeReady}
        />
      )}
    </div>
  );
}
