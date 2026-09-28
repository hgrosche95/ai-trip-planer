import type { AgentTool, GlobeFocus } from './tool-registry';

interface PlaceInput {
  name: string;
  lat: number;
  lng: number;
}

interface ShowDestinationInput extends PlaceInput {
  origin?: PlaceInput;
}

type ShowDestinationOutput =
  { shown: GlobeFocus; origin?: GlobeFocus } | { error: string };

// Dreht den Globus im Chat zum Reiseziel und zeichnet, wenn der Abreiseort
// bekannt ist, einen Bogen von dort zum Ziel. Die Koordinaten kommen vom
// Modell: Für Städte und Regionen kennt es sie genau genug, ein
// Geocoding-Dienst wäre für diese Anzeige unnötig. Geprüft wird nur, ob die
// Werte gültig sind.
export const showDestinationTool: AgentTool<
  ShowDestinationInput,
  ShowDestinationOutput
> = {
  kind: 'tool',
  definition: {
    name: 'show_destination_on_globe',
    description:
      'Zeigt das Reiseziel auf dem Globus im Chat an. Rufe es einmal auf, sobald das Reiseziel feststeht, mit den ungefähren Koordinaten des Ortszentrums. Ist der Abreiseort bekannt, gib ihn als origin mit, dann erscheint zusätzlich die Flugroute.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name des Ziels, z.B. "Lissabon"',
        },
        lat: {
          type: 'number',
          description: 'Breitengrad in Grad, -90 bis 90',
        },
        lng: {
          type: 'number',
          description: 'Längengrad in Grad, -180 bis 180',
        },
        origin: {
          type: 'object',
          description:
            'Optional: Abreiseort mit Koordinaten des Ortszentrums, z.B. {"name":"Berlin","lat":52.52,"lng":13.4}',
          properties: {
            name: { type: 'string' },
            lat: { type: 'number' },
            lng: { type: 'number' },
          },
          required: ['name', 'lat', 'lng'],
        },
      },
      required: ['name', 'lat', 'lng'],
    },
  },
  execute: ({ name, lat, lng, origin }) => {
    const shown = toPlace({ name, lat, lng });
    if (!shown) {
      return {
        error:
          'Ungültige Angaben: name darf nicht leer sein, lat -90 bis 90, lng -180 bis 180.',
      };
    }
    // Ein ungültiger Abreiseort soll das Ziel nicht verhindern: dann gibt
    // es eben nur den Marker, keinen Bogen.
    const from = origin ? toPlace(origin) : undefined;
    return from ? { shown, origin: from } : { shown };
  },
  focus: (output) => ('shown' in output ? output.shown : undefined),
  flight: (output) =>
    'shown' in output && output.origin
      ? { from: output.origin, to: output.shown }
      : undefined,
};

function toPlace(input: Partial<PlaceInput>): GlobeFocus | undefined {
  const { name, lat, lng } = input;
  const isValid =
    typeof name === 'string' &&
    name.trim() !== '' &&
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;
  return isValid ? { name: name.trim().slice(0, 100), lat, lng } : undefined;
}
