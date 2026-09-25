'use client';

import dynamic from 'next/dynamic';

export type { GlobeArc, GlobeFocus, GlobeCanvasProps as TripGlobeProps } from './globe-canvas';

// three.js braucht window/WebGL, deshalb nur im Browser laden und nicht
// beim statischen Export vorrendern.
const TripGlobe = dynamic(() => import('./globe-canvas'), { ssr: false });

export default TripGlobe;
