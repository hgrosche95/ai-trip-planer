import { estimateCostUsd } from './pricing';

describe('estimateCostUsd', () => {
  it('rechnet mit dem Preis pro Million Tokens', () => {
    // 1 Mio. Input zu 1 $ + 0,2 Mio. Output zu 5 $
    expect(estimateCostUsd('claude-haiku-4-5', 1_000_000, 200_000)).toBe(2);
  });

  it('erkennt Modellnamen mit Datums-Suffix', () => {
    expect(estimateCostUsd('claude-haiku-4-5-20251001', 1_000_000, 0)).toBe(1);
  });

  it('liefert null für unbekannte Modelle statt einer falschen Zahl', () => {
    expect(estimateCostUsd('unbekannt', 100, 100)).toBeNull();
  });
});
