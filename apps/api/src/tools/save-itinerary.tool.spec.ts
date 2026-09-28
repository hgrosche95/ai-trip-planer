import { routeFromStops } from './save-itinerary.tool';

describe('routeFromStops', () => {
  const stop = (
    dayNumber: number,
    order: number,
    title: string,
    lat?: number,
    lng?: number,
  ) => ({ dayNumber, order, title, lat, lng });

  it('ordnet die Stationen nach Tag und Reihenfolge', () => {
    const route = routeFromStops([
      stop(2, 1, 'Porto', 41.15, -8.61),
      stop(1, 2, 'Sintra', 38.8, -9.39),
      stop(1, 1, 'Lissabon', 38.72, -9.14),
    ]);
    expect(route.map((point) => point.name)).toEqual([
      'Lissabon',
      'Sintra',
      'Porto',
    ]);
  });

  it('lässt Punkte ohne Koordinaten und direkte Wiederholungen weg', () => {
    const route = routeFromStops([
      stop(1, 1, 'Hotel', 38.71, -9.13),
      stop(1, 2, 'Freizeit'),
      stop(2, 1, 'Hotel', 38.71, -9.13),
      stop(2, 2, 'Belém', 38.69, -9.21),
    ]);
    expect(route.map((point) => point.name)).toEqual(['Hotel', 'Belém']);
  });
});
