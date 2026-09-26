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
// Als WebP in 2048 px Breite: der Globus ist höchstens 36rem groß und nicht
// zoombar, eine 4096er-Textur wäre nur zusätzliche Ladezeit.
const TEXTURES = {
  day: '/globe/earth-blue-marble.webp',
  bump: '/globe/earth-topology.webp',
  water: '/globe/earth-water.webp',
};

export default function GlobeCanvas({
  arcs = [],
  autoRotate = true,
  focus = null,
}: GlobeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });

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

  // Neues Ziel: Drehung stoppen und in 1,5 s zum Ziel schwenken.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !focus) return;
    globe.controls().autoRotate = false;
    globe.pointOfView({ lat: focus.lat, lng: focus.lng, altitude: 1.7 }, 1500);
  }, [focus]);

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
        ? { lat: focus.lat, lng: focus.lng, altitude: 1.7 }
        : { lat: 35, lng: 10, altitude: 2.2 },
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full">
      {size.width > 0 && (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl={TEXTURES.day}
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
          ringMaxRadius={4}
          ringPropagationSpeed={2}
          ringRepeatPeriod={1200}
          labelsData={markers}
          labelLat={(marker) => (marker as GlobeFocus).lat}
          labelLng={(marker) => (marker as GlobeFocus).lng}
          labelText={(marker) => (marker as GlobeFocus).name}
          labelColor={() => '#FFFFFF'}
          labelSize={1.4}
          labelDotRadius={0.5}
          labelResolution={3}
          onGlobeReady={handleGlobeReady}
        />
      )}
    </div>
  );
}
