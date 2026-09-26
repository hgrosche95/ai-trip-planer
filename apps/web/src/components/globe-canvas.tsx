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

export default function GlobeCanvas({
  arcs = [],
  autoRotate = true,
  focus = null,
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

  // Neues Ziel: Drehung stoppen und in 1,5 s zum Ziel heranzoomen.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !focus) return;
    globe.controls().autoRotate = false;
    globe.pointOfView({ lat: focus.lat, lng: focus.lng, altitude: ALTITUDE_FOCUS }, 1500);
  }, [focus]);

  // Die scharfe Textur erst vorladen und dann tauschen, damit der Globus
  // nicht kurz ohne Textur dasteht.
  const wantsDetail = focus !== null;
  useEffect(() => {
    if (!wantsDetail) return;
    const image = new Image();
    image.onload = () => setDayTexture(TEXTURES.dayDetail);
    image.src = TEXTURES.dayDetail;
    return () => {
      image.onload = null;
    };
  }, [wantsDetail]);

  const markers = focus ? [focus] : [];

  function handleGlobeReady() {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls();
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotate = autoRotate && !prefersReducedMotion && !focus;
    controls.autoRotateSpeed = 0.35;
    controls.enableZoom = false;
    globe.pointOfView(
      focus
        ? { lat: focus.lat, lng: focus.lng, altitude: ALTITUDE_FOCUS }
        : { lat: 35, lng: 10, altitude: ALTITUDE_OVERVIEW },
    );
  }

  // Heranzoomen füllt die ganze Fläche mit Erde; ohne Maske stünde dann ein
  // hartes Quadrat auf dem Seitenhintergrund. Der runde, weich auslaufende
  // Ausschnitt beginnt erst außerhalb der Atmosphäre des ganzen Globus
  // (Abstand 2,2 füllt gut 70 % des Radius), die Übersicht bleibt also gleich.
  return (
    <div
      ref={containerRef}
      className="h-full w-full [mask-image:radial-gradient(circle_closest-side,black_82%,transparent_100%)]"
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
          arcsData={arcs}
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
          ringsData={markers}
          ringLat={(marker) => (marker as GlobeFocus).lat}
          ringLng={(marker) => (marker as GlobeFocus).lng}
          ringColor={() => (t: number) => `rgba(242, 165, 65, ${1 - t})`}
          ringMaxRadius={2}
          ringPropagationSpeed={2}
          ringRepeatPeriod={1200}
          labelsData={markers}
          labelLat={(marker) => (marker as GlobeFocus).lat}
          labelLng={(marker) => (marker as GlobeFocus).lng}
          labelText={(marker) => (marker as GlobeFocus).name}
          labelColor={() => '#FFFFFF'}
          labelSize={0.7}
          labelDotRadius={0.25}
          labelResolution={3}
          onGlobeReady={handleGlobeReady}
        />
      )}
    </div>
  );
}
