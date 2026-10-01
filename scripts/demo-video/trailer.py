# Schneidet aus den Frames von record.cjs (out/raw) und record-extras.cjs
# (out/extras) einen Trailer: Titelkarte, kurze Erklärtexte, Zooms auf
# Details, zügige Schnitte, Schlusskarte mit Live-Link. Stumm, 1280x800.
# Die Texte rendert overlays.cjs (HTML per Playwright, transparente PNGs).
# Ausgabe: out/trailer.mp4, out/trailer.webm, out/trailer.webp (Poster).
# Anleitung: README.md.
import bisect, json, os, subprocess, sys
from functools import lru_cache
from PIL import Image, ImageFilter

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, 'out')
W, H, FPS = 1280, 800, 30
ff = os.environ.get('FFMPEG', os.path.join(here, '.bin', 'ffmpeg'))
LIVE = 'witty-pond-0504bdc0f.7.azurestaticapps.net'

def load(folder):
    data = json.load(open(os.path.join(out, folder, 'frames.json'), encoding='utf-8'))
    marks = {}
    for m in data['marks']:
        marks.setdefault(m['name'], m['t'])
    return {'dir': os.path.join(out, folder), 'files': [f['file'] for f in data['frames']],
            'times': [f['t'] for f in data['frames']], 'marks': marks}

SRC = {'raw': load('raw'), 'extras': load('extras')}

@lru_cache(maxsize=48)
def frame(src, index):
    s = SRC[src]
    img = Image.open(os.path.join(s['dir'], s['files'][index])).convert('RGB')
    return img if img.size == (W, H) else img.resize((W, H), Image.LANCZOS)

def frame_at(src, t):
    s = SRC[src]
    i = max(bisect.bisect_right(s['times'], t) - 1, 0)
    return frame(src, i)

def at(src, mark, offset=0.0):
    return SRC[src]['marks'][mark] + offset

def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)

def view(img, z, cx, cy):
    # Ausschnitt mit Zoom z um (cx, cy), stufenlos per Float-Box
    if z <= 1.0001:
        return img
    w, h = W / z, H / z
    x0 = min(max(cx - w / 2, 0), W - w)
    y0 = min(max(cy - h / 2, 0), H - h)
    return img.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + w, y0 + h))

# --- Texte -----------------------------------------------------------------
OVERLAYS = [
    {'name': 'title', 'kind': 'title', 'eyebrow': 'KI-Projekt · Live-Demo', 'titleHtml': 'AI Trip <span>Planner</span>',
     'text': 'Ein Reiseplan im Dialog – erarbeitet von vier Agenten, die man bei der Arbeit sieht.',
     'chips': ['<b>01</b> Planer', '<b>02</b> Recherche', '<b>03</b> Budget', '<b>04</b> Kritiker']},
    {'name': 'eingabe', 'kind': 'caption', 'eyebrow': 'Eingabe', 'title': 'Ein Satz reicht',
     'text': 'Ziel, Dauer, Budget – in eigenen Worten. Kein Formular, kein Login.'},
    {'name': 'planer', 'kind': 'caption', 'eyebrow': '01 · Planer', 'title': 'Der Planer zerlegt die Anfrage',
     'text': 'Jeder Agent arbeitet in einer eigenen Spur, live im Chat.'},
    {'name': 'recherche', 'kind': 'caption', 'eyebrow': '02 · Recherche', 'title': 'Recherche läuft parallel',
     'text': 'Wetter, Orte und Unterkünfte werden gleichzeitig geholt.'},
    {'name': 'kritiker', 'kind': 'caption', 'eyebrow': '03 · Budget · 04 · Kritiker', 'title': 'Erst gerechnet, dann geprüft',
     'text': 'Der Kritiker ist Code: Regeln kosten keine Tokens. Die KI bessert nur nach, was beanstandet wurde.'},
    {'name': 'tage', 'kind': 'caption', 'eyebrow': 'Entwurf', 'title': 'Ticket-Tage und Stadtkarte',
     'text': 'Wer über einen Tag fährt, sieht ihn auf der Karte. Hinter dem Chat dreht sich der Globus zum Ziel.'},
    {'name': 'wetter', 'kind': 'caption', 'eyebrow': 'Wetter & Budget', 'title': 'Echte Vorhersage, ehrliche Rechnung',
     'text': 'Die Schätzung steht gegen das genannte Budget – im Rahmen, knapp oder drüber.',
     'align': 'right', 'valign': 'top'},
    {'name': 'ablauf', 'kind': 'caption', 'eyebrow': 'Ablauf', 'title': 'Jeder Schritt nachvollziehbar',
     'text': 'Die Zeitleiste zeigt, welcher Agent wann was getan hat.', 'align': 'right'},
    {'name': 'quellen', 'kind': 'caption', 'eyebrow': 'Klassischer Modus · RAG', 'title': 'Fakten mit Quellen',
     'text': 'Faktenfragen beantwortet eine eigene Wissensbasis – mit sichtbaren Quellen, statt zu raten.',
     'align': 'right', 'valign': 'top'},
    {'name': 'speichern', 'kind': 'caption', 'eyebrow': 'Speichern', 'title': 'Ein Klick, und die Reise bleibt',
     'text': 'Gespeichert im selben Layout: Budget und Annahmen in der Kopfkarte.', 'align': 'right'},
    {'name': 'bearbeiten', 'kind': 'caption', 'eyebrow': 'Bearbeiten', 'title': 'Weiterplanen im Chat',
     'text': 'Eine Nachricht ändert die gespeicherte Reise. Die neue Fassung ersetzt die alte.'},
    {'name': 'ende', 'kind': 'end', 'eyebrow': 'Live-Demo · ohne Login', 'titleHtml': 'AI Trip <span>Planner</span>',
     'text': 'Probier es selbst aus:', 'url': LIVE,
     'small': 'Next.js · NestJS · FastAPI · pgvector · Azure  —  github.com/hgrosche95/ai-trip-planer'},
]

# --- Schnitt ------------------------------------------------------------------
# Jede Einstellung: Quelle, von/bis (Marke + Versatz in Sekunden Echtzeit),
# Länge im Trailer, Zoom (z, cx, cy) am Anfang und Ende, Text.
def shot(src, a, b, dur, z0=(1, 640, 400), z1=None, text=None, blur=0, card=None, chapter=None):
    return dict(src=src, a=a, b=b, dur=dur, z0=z0, z1=z1 or z0, text=text, blur=blur, card=card, chapter=chapter)

R, X = 'raw', 'extras'
SHOTS = [
    # Titel über dem drehenden Globus
    shot(R, at(R, 'Eingabe'), at(R, 'Eingabe', 1.4), 3.8, (1.0, 640, 400), (1.12, 640, 380), blur=7, card='title', chapter='Eingabe'),
    # Eingabe: Zoom auf das Eingabefeld
    shot(R, at(R, 'Eingabe', 1.4), at(R, 'Agenten', -0.3), 4.2, (1.35, 420, 700), (1.55, 420, 700), 'eingabe'),
    # Agenten bei der Arbeit, beschleunigt
    shot(R, at(R, 'Agenten'), at(R, 'Agenten', 0.4) + (at(R, 'Antwort') - at(R, 'Agenten')) * 0.35, 3.6, (1.0, 640, 400), (1.25, 560, 380), 'planer', chapter='Agenten'),
    shot(R, at(R, 'Agenten') + (at(R, 'Antwort') - at(R, 'Agenten')) * 0.35, at(R, 'Agenten') + (at(R, 'Antwort') - at(R, 'Agenten')) * 0.7, 3.4, (1.3, 900, 380), (1.15, 760, 400), 'recherche'),
    shot(R, at(R, 'Agenten') + (at(R, 'Antwort') - at(R, 'Agenten')) * 0.7, at(R, 'Antwort'), 3.6, (1.15, 640, 400), (1.0, 640, 400), 'kritiker'),
    # Antwort: Ticket-Tage und Karte
    shot(R, at(R, 'Antwort'), at(R, 'Wetter', -1.5), 6.5, (1.0, 640, 400), (1.22, 900, 440), 'tage', chapter='Antwort'),
    shot(R, at(R, 'Wetter', -0.2), at(R, 'Ablauf', -0.2), 3.6, (1.32, 860, 450), (1.4, 860, 480), 'wetter'),
    shot(R, at(R, 'Ablauf'), at(R, 'Speichern', -1.2), 4.4, (1.0, 640, 400), (1.28, 900, 400), 'ablauf'),
    # Quellen aus der Wissensbasis (klassischer Modus)
    shot(X, at(X, 'Klassisch', 0.5), at(X, 'Quellen', -0.5), 3.0, (1.25, 420, 650), (1.25, 420, 600), 'quellen', chapter='Quellen'),
    shot(X, at(X, 'Quellen', -0.3), at(X, 'Reise', -0.2), 3.6, (1.15, 620, 560), (1.5, 600, 650), 'quellen'),
    # Speichern und gespeicherte Reise
    shot(R, at(R, 'Speichern'), at(R, 'Gespeichert', 1.0), 2.6, (1.25, 900, 250), (1.35, 1000, 160), 'speichern', chapter='Speichern'),
    shot(R, at(R, 'Reise', 0.3), at(R, 'Ende'), 5.0, (1.0, 640, 400), (1.12, 520, 300), 'speichern'),
    # Bearbeiten: Fassung 2
    shot(X, at(X, 'Bearbeiten', 0.3), at(X, 'Fassung 2', 0.5), 4.2, (1.0, 640, 400), (1.15, 420, 600), 'bearbeiten', chapter='Bearbeiten'),
    shot(X, at(X, 'Fassung 2', 0.5), at(X, 'Ende'), 4.2, (1.15, 900, 300), (1.0, 640, 400), 'bearbeiten'),
    # Schluss mit Live-Link
    shot(R, at(R, 'Ende', -0.1), at(R, 'Ende'), 4.5, (1.05, 640, 400), (1.12, 640, 400), blur=8, card='ende'),
]

FADE = 0.28  # Ein-/Ausblenden der Texte
TARGET_KB = int(os.environ.get('TARGET_KB', 2400))  # Portfolio: MP4 ≤ 2,5 MB

def main():
    specs = os.path.join(out, 'overlays.json')
    json.dump(OVERLAYS, open(specs, 'w', encoding='utf-8'), ensure_ascii=False)
    ov_dir = os.path.join(out, 'overlays')
    subprocess.run(['node', os.path.join(here, 'overlays.cjs'), specs, ov_dir], check=True)
    overlays = {o['name']: Image.open(os.path.join(ov_dir, o['name'] + '.png')).convert('RGBA') for o in OVERLAYS}

    # Textspuren: aufeinanderfolgende Einstellungen mit demselben Text teilen sich eine Einblendung
    start = 0.0
    spans = []
    for s in SHOTS:
        s['start'] = start
        name = s['card'] or s['text']
        if name and spans and spans[-1][0] == name and abs(spans[-1][2] - start) < 1e-6:
            spans[-1][2] = start + s['dur']
        elif name:
            spans.append([name, start, start + s['dur']])
        start += s['dur']
    total = start
    print('Trailer', round(total, 2), 's')
    # Kapitel für das Frontmatter der Portfolio-Seite
    for s in SHOTS:
        if s['chapter']:
            print(f"    - {{ t: {round(s['start'], 1)}, label: \"{s['chapter']}\" }}")

    # Erst ein verlustfreier Master, daraus 2-Pass auf Zielgröße: Die Zooms
    # kosten Bitrate, mit fester Qualität (CRF) wurde die Datei zu groß
    master = os.path.join(out, 'trailer-master.mkv')
    enc = [ff, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
           '-r', str(FPS), '-i', '-', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', master]
    proc = subprocess.Popen(enc, stdin=subprocess.PIPE)
    n = round(total * FPS)
    poster = None
    for i in range(n):
        t = i / FPS
        k = next(j for j, s in enumerate(SHOTS) if t < s['start'] + s['dur'] or j == len(SHOTS) - 1)
        s = SHOTS[k]
        p = (t - s['start']) / s['dur']
        img = frame_at(s['src'], s['a'] + (s['b'] - s['a']) * p)
        e = ease(p)
        z = [s['z0'][q] + (s['z1'][q] - s['z0'][q]) * e for q in range(3)]
        img = view(img, *z)
        if s['blur']:
            img = img.filter(ImageFilter.GaussianBlur(s['blur']))
        for name, a, b in spans:
            if a <= t < b:
                # Titel- und Schlusskarte decken ab Bildbeginn, Texte blenden kurz nach dem Schnitt ein
                delay = 0 if name in ('title', 'ende') else 0.25
                alpha = min(ease((t - a - delay) / FADE), 1.0)
                if name != 'ende' and b < total - 1e-6:
                    alpha = min(alpha, ease((b - t) / FADE))
                if name == 'title':
                    alpha = 1.0 if t > 0.1 else alpha
                if alpha > 0:
                    o = overlays[name]
                    if alpha < 1:
                        o = o.copy()
                        o.putalpha(o.getchannel('A').point(lambda v: int(v * alpha)))
                    base = img.convert('RGBA')
                    # Texte gleiten beim Einblenden ein paar Pixel hoch
                    dy = 0 if name in ('title', 'ende') else int((1 - alpha) * 14)
                    base.alpha_composite(o, (0, dy))
                    img = base.convert('RGB')
        # Aus Schwarz einblenden
        if t < 0.5:
            img = Image.blend(Image.new('RGB', (W, H)), img, ease(t / 0.5))
        if poster is None and t >= 2.0:
            poster = img.copy()
        proc.stdin.write(img.tobytes())
    proc.stdin.close()
    if proc.wait():
        sys.exit('ffmpeg fehlgeschlagen')
    poster.save(os.path.join(out, 'trailer-poster.png'))
    kbps = int(TARGET_KB * 8 * 1.024 / total * 0.97)  # etwas Luft für Container und Ratenschwankung
    log = os.path.join(out, 'pass')
    q = [ff, '-hide_banner', '-loglevel', 'error', '-y', '-i', master]
    for n_pass, dest in ((1, os.devnull), (2, os.path.join(out, 'trailer.mp4'))):
        subprocess.run([*q, '-c:v', 'libx264', '-preset', 'slow', '-b:v', f'{kbps}k', '-pass', str(n_pass), '-passlogfile', log,
                        '-movflags', '+faststart', '-f', 'mp4', dest], check=True)
    for n_pass, dest in ((1, os.devnull), (2, os.path.join(out, 'trailer.webm'))):
        subprocess.run([*q, '-c:v', 'libvpx-vp9', '-b:v', f'{kbps}k', '-pass', str(n_pass), '-passlogfile', log,
                        '-row-mt', '1', '-deadline', 'good', '-f', 'webm', dest], check=True)
    subprocess.run([ff, '-hide_banner', '-loglevel', 'error', '-y', '-i', os.path.join(out, 'trailer-poster.png'),
                    '-c:v', 'libwebp', '-quality', '82', os.path.join(out, 'trailer.webp')], check=True)
    for f in ('trailer.mp4', 'trailer.webm', 'trailer.webp'):
        print(f, os.path.getsize(os.path.join(out, f)) // 1024, 'KB')

if __name__ == '__main__':
    main()
