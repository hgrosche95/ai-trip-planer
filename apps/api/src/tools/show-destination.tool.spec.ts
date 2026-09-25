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
