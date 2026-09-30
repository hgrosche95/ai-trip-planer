// Tastatur für Tablisten nach dem WAI-ARIA-Muster: Pfeiltasten wechseln den
// Tab (und wählen ihn, "automatic activation"), Home/End springen an die
// Ränder. Liefert den neuen Index oder undefined, wenn die Taste nichts tut.
export function nextTabIndex(key: string, index: number, count: number): number | undefined {
  const last = count - 1;
  if (key === 'ArrowRight') return index === last ? 0 : index + 1;
  if (key === 'ArrowLeft') return index === 0 ? last : index - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  return undefined;
}
