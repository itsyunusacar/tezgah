"""Frames screenshots and recordings in Tezgah's style (the tour's): a light grid-paper stage, the shot
as a rounded card with a soft shadow, and rounded outer corners.

  python3 frame.py image <in.png> <out.png> [width]
  python3 frame.py layers <width> <shot_w> <shot_h> <outdir>   # background, card mask, outer mask for ffmpeg
"""
import sys
from PIL import Image, ImageDraw, ImageFilter

STAGE = (245, 243, 241)  # --sidebar, light
LINE = (231, 227, 222)   # --border
EDGE = (226, 221, 215)


def layout(width, shot_w, shot_h):
    pad = round(width * 0.055)
    card_w = width - 2 * pad
    card_h = round(card_w * shot_h / shot_w)
    return pad, card_w, card_h, card_h + 2 * pad


def rounded(size, radius, scale=4):
    w, h = size
    m = Image.new('L', (w * scale, h * scale), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w * scale - 1, h * scale - 1], radius=radius * scale, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def background(width, shot_w, shot_h):
    pad, cw, ch, height = layout(width, shot_w, shot_h)
    k = width / 1000
    bg = Image.new('RGBA', (width, height), STAGE + (255,))
    d = ImageDraw.Draw(bg)
    step = max(12, round(28 * k))
    for x in range(0, width, step):
        d.line([(x, 0), (x, height)], fill=LINE, width=max(1, round(k)))
    for y in range(0, height, step):
        d.line([(0, y), (width, y)], fill=LINE, width=max(1, round(k)))
    # Soft shadow under the card.
    shadow = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    r = round(14 * k)
    ImageDraw.Draw(shadow).rounded_rectangle([pad, pad + round(10 * k), pad + cw, pad + ch + round(10 * k)], radius=r, fill=(12, 11, 10, 40))
    shadow = shadow.filter(ImageFilter.GaussianBlur(round(22 * k)))
    bg = Image.alpha_composite(bg, shadow)
    # A hairline around the card.
    edge = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle([pad - 1, pad - 1, pad + cw, pad + ch], radius=r + 1, outline=EDGE + (255,), width=max(1, round(k)))
    bg = Image.alpha_composite(bg, edge)
    return bg, pad, cw, ch, height, r


def outer_mask(width, height):
    return rounded((width, height), round(20 * width / 1000))


def frame_image(src, out, width=2000):
    shot = Image.open(src).convert('RGBA')
    bg, pad, cw, ch, height, r = background(width, *shot.size)
    card = shot.resize((cw, ch), Image.LANCZOS)
    card.putalpha(rounded((cw, ch), r))
    bg.alpha_composite(card, (pad, pad))
    bg.putalpha(outer_mask(width, height))
    bg.save(out, optimize=True)


def layers(width, shot_w, shot_h, outdir):
    bg, pad, cw, ch, height, r = background(width, shot_w, shot_h)
    bg.convert('RGB').save(f'{outdir}/bg.png')
    rounded((cw, ch), r).save(f'{outdir}/card.png')
    outer_mask(width, height).save(f'{outdir}/outer.png')
    print(pad, cw, ch, height)


if __name__ == '__main__':
    if sys.argv[1] == 'image':
        frame_image(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 2000)
    else:
        layers(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5])
