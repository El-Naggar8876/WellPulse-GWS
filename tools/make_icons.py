"""Generate WellPulse GWS PNG icons (192, 512, maskable 512) with Pillow."""
from PIL import Image, ImageDraw
import math, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'icons')
os.makedirs(OUT, exist_ok=True)

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def draw_icon(size, maskable=False):
    S = 4  # supersample
    W = size * S
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c1, c2 = (34, 184, 207), (11, 94, 107)
    # gradient background
    grad = Image.new('RGBA', (W, W))
    gd = ImageDraw.Draw(grad)
    for y in range(W):
        gd.line([(0, y), (W, y)], fill=lerp(c1, c2, y / W) + (255,))
    mask = Image.new('L', (W, W), 0)
    md = ImageDraw.Draw(mask)
    if maskable:
        md.rectangle([0, 0, W, W], fill=255)
        pad = W * 0.20
    else:
        r = W * 0.22
        md.rounded_rectangle([0, 0, W - 1, W - 1], radius=r, fill=255)
        pad = W * 0.12
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    cx, cy = W / 2, W / 2
    inner = W - 2 * pad
    # drop shape
    dw = inner * 0.36
    top = cy - inner * 0.36
    bot = cy + inner * 0.04
    pts = []
    for i in range(0, 181):
        a = math.radians(i)
        pts.append((cx + dw / 2 * math.cos(a), bot - dw * 0.12 + dw / 2 * math.sin(a)))
    poly = [(cx, top)] + pts + [(cx, top)]
    d.polygon(poly, fill=(255, 255, 255, 235))
    # waves drawn as smooth filled bands
    def wave(yc, amp, thick, alpha):
        x0 = cx - inner / 2
        top_pts, bot_pts = [], []
        for i in range(0, 241):
            x = x0 + inner * i / 240
            y = yc + amp * math.sin(i / 240 * 2 * math.pi * 2)
            top_pts.append((x, y - thick / 2)); bot_pts.append((x, y + thick / 2))
        d.polygon(top_pts + bot_pts[::-1], fill=(255, 255, 255, alpha))
        d.ellipse([x0 - thick/2, yc - thick/2, x0 + thick/2, yc + thick/2], fill=(255,255,255,alpha))
        d.ellipse([x0 + inner - thick/2, yc - thick/2, x0 + inner + thick/2, yc + thick/2], fill=(255,255,255,alpha))
    wave(cy + inner * 0.16, inner * 0.035, W * 0.035, 255)
    wave(cy + inner * 0.29, inner * 0.035, W * 0.035, 150)
    return img.resize((size, size), Image.LANCZOS)

draw_icon(192).save(os.path.join(OUT, 'icon-192.png'))
draw_icon(512).save(os.path.join(OUT, 'icon-512.png'))
draw_icon(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
print('icons written to', os.path.abspath(OUT))
