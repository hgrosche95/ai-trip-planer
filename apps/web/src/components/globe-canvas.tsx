'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { Color, MeshPhongMaterial, TextureLoader } from 'three';

export interface GlobeArc {
  from: [lat: number, lng: number];
  to: [lat: number, lng: number];
}

export interface GlobeCanvasProps {
  arcs?: GlobeArc[];
  autoRotate?: boolean;
}

// Texturen stammen aus three-globe (NASA Blue Marble, gemeinfrei) und liegen
// in public/globe, damit sie mit dem statischen Export ausgeliefert werden.
const TEXTURES = {
  day: '/globe/earth-blue-marble.jpg',
  bump: '/globe/earth-topology.png',
  water: '/globe/earth-water.png',
};

export default function GlobeCanvas({ arcs = [], autoRotate = true }: GlobeCanvasProps) {
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

  function handleGlobeReady() {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls();
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotate = autoRotate && !prefersReducedMotion;
    controls.autoRotateSpeed = 0.35;
    controls.enableZoom = false;
    globe.pointOfView({ lat: 35, lng: 10, altitude: 2.2 });
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
          onGlobeReady={handleGlobeReady}
        />
      )}
    </div>
  );
}
