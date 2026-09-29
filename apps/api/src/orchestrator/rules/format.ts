// Ganze Euro mit Tausenderpunkt: 91500 Cent → "915 €". Liegt bei den
// Regeln, damit sie ohne Abhängigkeiten auskommen: Die Evals importieren sie
// direkt (evals/src/plan-metrics.ts), ohne NestJS und Prisma mitzuladen.
export function formatEur(cents: number): string {
  return `${Math.round(cents / 100).toLocaleString('de-DE')} €`;
}
