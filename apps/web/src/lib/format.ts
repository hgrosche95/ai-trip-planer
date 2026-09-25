export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatMoney(cents: number, currency: string) {
  const fractionDigits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(cents / 100);
}

export function tripDays(startIso: string, endIso: string) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function placeCode(destination: string) {
  return destination.replace(/[^A-Za-zÄÖÜäöü]/g, '').slice(0, 3).toUpperCase();
}