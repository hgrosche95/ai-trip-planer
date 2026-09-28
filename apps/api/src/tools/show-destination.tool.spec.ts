import { showDestinationTool } from './show-destination.tool';

describe('showDestinationTool', () => {
  const run = (input: { name: string; lat: number; lng: number }) => {
    const output = showDestinationTool.execute(input, { userId: 'u1' });
    return { output, focus: showDestinationTool.focus?.(output as never) };
  };

  it('liefert gültige Koordinaten als Globus-Fokus', () => {
    expect(run({ name: ' Lissabon ', lat: 38.72, lng: -9.14 }).focus).toEqual({
      name: 'Lissabon',
      lat: 38.72,
      lng: -9.14,
    });
  });

  it('liefert mit Abreiseort eine Route vom Abreiseort zum Ziel', () => {
    const output = showDestinationTool.execute(
      {
        name: 'Lissabon',
        lat: 38.72,
        lng: -9.14,
        origin: { name: 'Berlin', lat: 52.52, lng: 13.4 },
      },
      { userId: 'u1' },
    );
    expect(showDestinationTool.route?.(output as never)).toEqual({
      from: { name: 'Berlin', lat: 52.52, lng: 13.4 },
      to: { name: 'Lissabon', lat: 38.72, lng: -9.14 },
    });
  });

  it('zeigt das Ziel auch bei ungültigem Abreiseort, nur ohne Route', () => {
    const output = showDestinationTool.execute(
      {
        name: 'Lissabon',
        lat: 38.72,
        lng: -9.14,
        origin: { name: 'Berlin', lat: 520, lng: 13.4 },
      },
      { userId: 'u1' },
    );
    expect(showDestinationTool.focus?.(output as never)?.name).toBe('Lissabon');
    expect(showDestinationTool.route?.(output as never)).toBeUndefined();
  });

  it.each([
    { name: 'Nirgendwo', lat: 91, lng: 0 },
    { name: 'Nirgendwo', lat: 0, lng: -181 },
    { name: '', lat: 10, lng: 10 },
    { name: 'Text', lat: '48.2' as unknown as number, lng: 16.4 },
  ])('lehnt ungültige Angaben ab: %o', (input) => {
    const { output, focus } = run(input);
    expect(output).toHaveProperty('error');
    expect(focus).toBeUndefined();
  });
});
