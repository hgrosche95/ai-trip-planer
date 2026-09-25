import type { AgentTool, GlobeFocus } from './tool-registry';

interface ShowDestinationInput {
  name: string;
  lat: number;
  lng: number;
}

type ShowDestinationOutput = { shown: GlobeFocus } | { error: string };

// Dreht den Globus im Chat zum Reiseziel. Die Koordinaten kommen vom Modell:
// Für Städte und Regionen kennt es sie genau genug, ein Geocoding-Dienst wäre
// für diese Anzeige unnötig. Geprüft wird nur, ob die Werte gültig sind.
export const showDestinationTool: AgentTool<
  ShowDestinationInput,
  ShowDestinationOutput
> = {
  kind: 'tool',
  definition: {
    name: 'show_destination_on_globe',
    description:
      'Zeigt das Reiseziel auf dem Globus im Chat an. Rufe es einmal auf, sobald das Reiseziel feststeht, mit den ungefähren Koordinaten des Ortszentrums.',
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
      },
      required: ['name', 'lat', 'lng'],
    },
  },
  execute: ({ name, lat, lng }) => {
    const isValid =
      typeof name === 'string' &&
      name.trim() !== '' &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180;
    if (!isValid) {
      return {
        error:
          'Ungültige Angaben: name darf nicht leer sein, lat -90 bis 90, lng -180 bis 180.',
      };
    }
    return { shown: { name: name.trim().slice(0, 100), lat, lng } };
  },
  focus: (output) => ('shown' in output ? output.shown : undefined),
};
