import type { FrankfurterClient } from '../external/frankfurter.client';
import { createCurrencyTool } from './currency.tool';

function errorOf(output: unknown): string | undefined {
  return (output as { error?: string }).error;
}

describe('convert_currency', () => {
  let client: { rate: jest.Mock };
  const context = { userId: 'user-a' };

  beforeEach(() => {
    client = {
      rate: jest.fn().mockResolvedValue({
        available: true,
        data: { from: 'PLN', to: 'EUR', rate: 0.2345, date: '2026-09-25' },
        cached: false,
      }),
    };
  });

  const tool = () => createCurrencyTool(client as unknown as FrankfurterClient);

  it('rechnet mit dem EZB-Kurs um und rundet auf Cent', async () => {
    const t = tool();
    const output = await t.execute(
      { amount: 500, from: 'pln', to: ' eur' },
      context,
    );

    expect(client.rate).toHaveBeenCalledWith('PLN', 'EUR');
    expect(output).toEqual({
      amount: 500,
      from: 'PLN',
      to: 'EUR',
      rate: 0.2345,
      converted: 117.25,
      rateDate: '2026-09-25',
      source: 'EZB-Referenzkurs (über Frankfurter)',
      cached: false,
    });
    expect(t.cached!(output)).toBe(false);
  });

  it.each([
    [{ amount: -1, from: 'EUR', to: 'USD' }, /amount/],
    [{ amount: Number.NaN, from: 'EUR', to: 'USD' }, /amount/],
    [{ amount: '5' as unknown as number, from: 'EUR', to: 'USD' }, /amount/],
    [{ amount: 5, from: 'Euro', to: 'USD' }, /ISO-4217/],
    [{ amount: 5, from: 'EUR', to: undefined as unknown as string }, /ISO/],
  ])('lehnt ungültige Eingaben ab: %j', async (input, message) => {
    const output = await tool().execute(input, context);

    expect(errorOf(output)).toMatch(message);
    expect(client.rate).not.toHaveBeenCalled();
  });

  it('erfindet bei einem Ausfall keinen Kurs', async () => {
    client.rate.mockResolvedValue({
      available: false,
      cached: false,
      error: 'frankfurter nicht erreichbar: Zeitüberschreitung',
    });

    const output = await tool().execute(
      { amount: 5, from: 'EUR', to: 'USD' },
      context,
    );

    expect(errorOf(output)).toMatch(/Zeitüberschreitung.*nicht abrufbar/);
  });
});
