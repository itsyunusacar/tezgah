import sys, re
from PIL import Image
rec, out, layers = sys.argv[1:4]
pad, cw, ch, H = map(int, open(f'{layers}/geom.txt').read().split())
bg = Image.open(f'{layers}/bg.png').convert('RGBA')
card = Image.open(f'{layers}/card.png')
outer = Image.open(f'{layers}/outer-bin.png')
txt = open(f'{rec}/frames.txt').read()
files = re.findall(r"file '([^']+)'\nduration ([\d.]+)", txt)
times, t = [], 0.0
for f, d in files:
    times.append((t, f)); t += float(d)
fps, n, j = 12, 0, 0
total = t
k = 0.0
while k <= total:
    while j + 1 < len(times) and times[j + 1][0] <= k: j += 1
    shot = Image.open(f'{rec}/{times[j][1]}').convert('RGBA').resize((cw, ch), Image.LANCZOS)
    shot.putalpha(card)
    im = bg.copy(); im.alpha_composite(shot, (pad, pad)); im.putalpha(outer)
    im.save(f'{out}/g{n:04d}.png'); n += 1; k += 1 / fps
print(n, 'frames')
