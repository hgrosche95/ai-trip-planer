import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateItineraryDto, itineraryValidationErrors } from './itinerary.dto';

const validPlan = {
  destination: 'Wien',
  startDate: '2026-09-01',
  endDate: '2026-09-04',
  budgetCents: 50_000,
  currency: 'EUR',
  preferences: ['Musik'],
  stops: [{ dayNumber: 1, order: 1, title: 'Kaffeehaus', category: 'FOOD' }],
};

// Dieselbe Pipe-Konfiguration wie in main.ts
const pipe = new ValidationPipe({ whitelist: true, transform: true });
const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: CreateItineraryDto });

describe('CreateItineraryDto (über die ValidationPipe)', () => {
  it('lässt einen gültigen Plan durch', async () => {
    await expect(validate(validPlan)).resolves.toMatchObject({
      destination: 'Wien',
    });
  });

  it.each([
    ['ein ungültiges Datum', { startDate: 'quatsch' }],
    [
      'ein Ende vor dem Anfang',
      { startDate: '2026-09-04', endDate: '2026-09-01' },
    ],
    ['ein negatives Budget', { budgetCents: -1 }],
    ['ein Budget als Text', { budgetCents: '500' }],
    ['ein leeres Ziel', { destination: '' }],
    [
      'eine unbekannte Kategorie',
      { stops: [{ dayNumber: 1, order: 1, title: 'x', category: 'PARTY' }] },
    ],
    ['einen Programmpunkt ohne Titel', { stops: [{ dayNumber: 1, order: 1 }] }],
    ['zu viele Programmpunkte', { stops: Array(101).fill(validPlan.stops[0]) }],
    ['fehlende stops', { stops: undefined }],
  ])('lehnt %s mit 400 ab', async (_label, override) => {
    await expect(validate({ ...validPlan, ...override })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('entfernt unbekannte Felder, statt den Request abzulehnen', async () => {
    const result = (await validate({
      ...validPlan,
      userId: 'fremd',
    })) as Record<string, unknown>;
    expect(result.userId).toBeUndefined();
  });
});

it('meldet bei ungültigem Startdatum nur diesen Fehler, keinen Folgefehler', () => {
  const errors = itineraryValidationErrors({
    ...validPlan,
    startDate: 'quatsch',
  });
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('startDate');
});

describe('itineraryValidationErrors (für das Agenten-Tool)', () => {
  it('liefert für einen gültigen Plan keine Fehler', () => {
    expect(itineraryValidationErrors(validPlan)).toEqual([]);
  });

  it('liefert lesbare Meldungen, auch für verschachtelte Felder', () => {
    const errors = itineraryValidationErrors({
      ...validPlan,
      startDate: 'quatsch',
      stops: [{ dayNumber: 0, order: 1, title: 'x' }],
    });
    expect(errors.some((e) => e.includes('startDate'))).toBe(true);
    expect(errors.some((e) => e.startsWith('stops.0.dayNumber'))).toBe(true);
  });
});
