'use client';

import dynamic from 'next/dynamic';

export type { CityMapProps } from './city-map-canvas';

// MapLibre braucht window und WebGL und ist groß: erst im Browser und erst
// dann laden, wenn ein Plan eine Karte zeigt
const CityMap = dynamic(() => import('./city-map-canvas'), {
  ssr: false,
  loading: () => <div className="h-full w-full motion-safe:animate-pulse bg-rule/40" />,
});

export default CityMap;
