# Setzt die Frames aus record.cjs zu einem Video zusammen. Jeder Abschnitt
# wird so beschleunigt/gestreckt, dass die Kapitel auf den Zeiten der
# Portfolio-Seite liegen. Ausgabe: out/trip-planer.{mp4,webm} und
# out/ai-trip-planer.webp (Poster), 1280x800.
import json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
os.chdir(os.path.join(here, 'out'))
raw = 'raw'; name = 'trip-planer'
# Speichern hat mehr Zeit als früher: Am Ende steht die gespeicherte Reise
# mit Budget und Annahmen in der Kopfkarte
TARGET = {'Eingabe': 0, 'Agenten': 9.5, 'Antwort': 20, 'Ablauf': 31, 'Speichern': 38.5, 'Ende': 48}
data = json.load(open(os.path.join(raw, 'frames.json')))
frames, marks = data['frames'], {m['name']: m['t'] for m in data['marks']}
order = list(TARGET)
def target_time(t):
    for a, b in zip(order, order[1:]):
        if marks[a] <= t <= marks[b]:
            return TARGET[a] + (t - marks[a]) / (marks[b] - marks[a]) * (TARGET[b] - TARGET[a])
    return None
lines = []
kept = [(f, target_time(f['t'])) for f in frames]
kept = [(f, tt) for f, tt in kept if tt is not None]
for (f, tt), (_, nt) in zip(kept, kept[1:] + [(None, TARGET['Ende'])]):
    lines += [f"file '{os.path.abspath(os.path.join(raw, f['file']))}'", f"duration {max(nt - tt, 0.001):.4f}"]
lines.append(lines[-2])
open('list.txt', 'w').write('\n'.join(lines) + '\n')
ff = os.environ.get('FFMPEG', os.path.join(here, '.bin', 'ffmpeg'))
base = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-vf', 'fps=30,scale=1280:800:flags=lanczos,format=yuv420p', '-t', str(TARGET['Ende'])]
subprocess.run([ff, *base, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', f'{name}.mp4'], check=True)
subprocess.run([ff, *base, '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', f'{name}.webm'], check=True)
# Poster: Moment kurz nach "Antwort" (Entwurf mit Karte)
poster_t = TARGET['Antwort'] + 4
subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(poster_t), '-i', f'{name}.mp4', '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', 'ai-trip-planer.webp'], check=True)
for f in (f'{name}.mp4', f'{name}.webm', 'ai-trip-planer.webp'):
    print(f, os.path.getsize(f) // 1024, 'KB')
