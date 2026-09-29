import type { FrankfurterClient } from '../external/frankfurter.client';
import { isCurrencyCode } from '../external/frankfurter.client';
import type { AgentTool } from './tool-registry';

interface CurrencyInput {
  amount: number;
  from: string;
  to: string;
}

type CurrencyOutput =
  | {
      amount: number;
      from: string;
      to: string;
      rate: number;
      converted: number;
      // Datum des EZB-Kurses, leer bei gleicher Währung
      rateDate: string;
      source: string;
      cached: boolean;
    }
  | { error: string };

const MAX_AMOUNT = 1_000_000_000;

export function createCurrencyTool(
  client: FrankfurterClient,
): AgentTool<CurrencyInput, CurrencyOutput> {
  return {
    kind: 'tool',
    definition: {
      name: 'convert_currency',
      description:
        'Rechnet einen Betrag mit dem aktuellen Referenzkurs der Europäischen Zentralbank in eine andere Währung um, z.B. 500 PLN in EUR.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Betrag, z.B. 500' },
          from: {
            type: 'string',
            description: 'Ausgangswährung als ISO-Code, z.B. "PLN"',
          },
          to: {
            type: 'string',
            description: 'Zielwährung als ISO-Code, z.B. "EUR"',
          },
        },
        required: ['amount', 'from', 'to'],
      },
    },
    execute: async ({ amount, from, to }) => {
      if (
        typeof amount !== 'number' ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > MAX_AMOUNT
      ) {
        return { error: 'amount muss eine Zahl zwischen 0 und 1 Mrd. sein.' };
      }
      // "eur" oder " usd" nimmt das Modell gern mal, das ist kein Fehler
      const fromCode =
        typeof from === 'string' ? from.trim().toUpperCase() : '';
      const toCode = typeof to === 'string' ? to.trim().toUpperCase() : '';
      if (!isCurrencyCode(fromCode) || !isCurrencyCode(toCode)) {
        return {
          error:
            'from und to müssen ISO-4217-Währungscodes aus drei Buchstaben sein, z.B. "EUR".',
        };
      }

      const rate = await client.rate(fromCode, toCode);
      if (!rate.available) {
        return {
          error: `${rate.error}. Kein Kurs verfügbar: Rechne nicht mit einem geschätzten Kurs, sondern sag dem Nutzer, dass der Kurs gerade nicht abrufbar ist.`,
        };
      }

      return {
        amount,
        from: fromCode,
        to: toCode,
        rate: rate.data.rate,
        converted: Math.round(amount * rate.data.rate * 100) / 100,
        rateDate: rate.data.date,
        source: 'EZB-Referenzkurs (über Frankfurter)',
        cached: rate.cached,
      };
    },
    cached: (output) => ('rate' in output ? output.cached : undefined),
  };
}
