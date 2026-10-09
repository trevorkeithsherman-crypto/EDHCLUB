"""Paints the five EDH Club playmats as original landscape art.

Run:  python3 tools/paint-mats.py
Writes public/mats/<name>.jpg (1600x1000) and public/mats/<name>-thumb.jpg.
Everything here is procedural and original: no card art, no logos.
"""
import math, os, random
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

W, H = 1600, 1000
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'mats')
os.makedirs(OUT, exist_ok=True)


# ---------- helpers ----------
def noise(w, h, scale, octaves=4, seed=0, persistence=0.5):
    """Fractal value noise in [0,1]."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        s = max(2, int(scale / (2 ** o)))
        small = rng.random((max(2, h // s), max(2, w // s))).astype(np.float32)
        img = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += np.asarray(img, np.float32) / 255 * amp
        total += amp
        amp *= persistence
    return out / total


def noise1d(n, scale, octaves=4, seed=0):
    return noise(n, 1, scale, octaves, seed)[0]


def lerp(a, b, t):
    return a + (b - a) * t


def col(hexs):
    hexs = hexs.lstrip('#')
    return np.array([int(hexs[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


def vgrad(top, bottom, curve=1.0):
    t = (np.linspace(0, 1, H) ** curve)[:, None, None]
    g = top[None, None, :] * (1 - t) + bottom[None, None, :] * t
    return np.ascontiguousarray(np.broadcast_to(g, (H, W, 3)))


def blend(img, color, mask):
    """img: HxWx3 float, color: 3, mask: HxW in [0,1]"""
    m = np.clip(mask, 0, 1)[:, :, None]
    return img * (1 - m) + color[None, None, :] * m


def glow(img, cx, cy, r, color, strength=1.0, power=2.0):
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
    m = np.clip(1 - d, 0, 1) ** power * strength
    return img + color[None, None, :] * m[:, :, None]


def ridge(img, base_y, amp, color, scale, seed, fog=None, fog_amt=0.0, sharp=1.0):
    """Fill everything below a noisy ridge line with color (optionally fogged toward sky)."""
    line = base_y + (noise1d(W, scale, 5, seed) - 0.5) * 2 * amp
    line = line + (np.abs(noise1d(W, scale / 3, 3, seed + 7) - 0.5) * amp * 0.6) * sharp
    yy = np.arange(H)[:, None]
    mask = np.clip((yy - line[None, :]) / 2.0 + 0.5, 0, 1)
    c = color if fog is None else lerp(color, fog, fog_amt)
    return blend(img, c, mask), line


def soft_blur(arr, r):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r)), np.float32)


def stars(img, n, seed, brightness=1.0, ymax=0.6):
    rng = np.random.default_rng(seed)
    for _ in range(n):
        x, y = int(rng.random() * W), int(rng.random() * H * ymax)
        b = rng.random() ** 2 * 255 * brightness
        img[y, x] = np.maximum(img[y, x], b)
        if rng.random() < 0.15 and 1 <= x < W - 1 and 1 <= y < H - 1:
            img[y - 1:y + 2, x - 1:x + 2] = np.maximum(img[y - 1:y + 2, x - 1:x + 2], b * 0.5)
    return img


def clouds(img, color, seed, scale=300, cover=0.55, ymax=0.55, soft=0.25, strength=0.7):
    n = noise(W, H, scale, 5, seed)
    yy = np.linspace(0, 1, H)[:, None]
    fade = np.clip((ymax - yy) / ymax, 0, 1) ** 0.7
    m = np.clip((n - cover) / soft, 0, 1) * fade * strength
    return blend(img, color, m)


def painterly(im):
    """Cinematic grade: soften edges into brushwork, bloom the highlights, deepen the blacks, add haze."""
    from PIL import ImageEnhance, ImageChops
    im = im.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.GaussianBlur(0.7))
    im = im.filter(ImageFilter.UnsharpMask(radius=2.5, percent=50, threshold=2))
    # bloom: blurred highlights added back
    hi = im.point(lambda v: max(0, (v - 150)) * 2)
    bloom = hi.filter(ImageFilter.GaussianBlur(28))
    im = ImageChops.add(im, bloom.point(lambda v: int(v * 0.55)))
    # tone: contrast + slight desaturation so cards and UI read on top
    im = ImageEnhance.Contrast(im).enhance(1.18)
    im = ImageEnhance.Color(im).enhance(0.9)
    return im


def finish(img, name, vignette=0.55, grain=0.03, seed=99):
    strokes = noise(W, H, 18, 2, seed + 1)
    img = img * (1 + (strokes - 0.5) * grain * 2)[:, :, None]
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    v = 1 - np.clip(d - 0.45, 0, 1) ** 1.5 * (vignette + 0.15)
    img = img * v[:, :, None]
    im = painterly(Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)))
    im.save(os.path.join(OUT, f'{name}.jpg'), quality=86, optimize=True, progressive=True)
    im.resize((480, 300), Image.LANCZOS).save(os.path.join(OUT, f'{name}-thumb.jpg'), quality=80, optimize=True)
    print(name, os.path.getsize(os.path.join(OUT, f'{name}.jpg')) // 1024, 'KB')


def texture(img, mask, color_a, color_b, scale, seed):
    """Paint a silhouette with two colors mixed by noise, so rock and bark aren't flat."""
    n = noise(W, H, scale, 4, seed)
    c = color_a[None, None, :] * (1 - n[:, :, None]) + color_b[None, None, :] * n[:, :, None]
    m = np.clip(mask, 0, 1)[:, :, None]
    return img * (1 - m) + c * m


def ridge_mask(base_y, amp, scale, seed, sharp=1.0):
    line = base_y + (noise1d(W, scale, 5, seed) - 0.5) * 2 * amp
    line = line + (np.abs(noise1d(W, scale / 3, 3, seed + 7) - 0.5) * amp * 0.6) * sharp
    yy = np.arange(H)[:, None]
    return np.clip((yy - line[None, :]) / 2.0 + 0.5, 0, 1), line


def tree(d, x, y, ang, length, depth, width, color, spread=0.45, seed=0):
    rnd = random.Random(seed)
    def rec(x, y, ang, length, depth, width):
        if depth == 0 or length < 3:
            return
        x2, y2 = x + math.cos(ang) * length, y - math.sin(ang) * length
        d.line([(x, y), (x2, y2)], fill=color, width=max(1, int(width)))
        for s in (-1, 1):
            if rnd.random() < 0.9:
                rec(x2, y2, ang + s * (spread * 0.6 + rnd.random() * spread), length * (0.6 + rnd.random() * 0.2), depth - 1, width * 0.66)
    rec(x, y, ang, length, depth, width)


def to_im(img):
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def to_np(im):
    return np.asarray(im, np.float32)


# ---------- 1. Emberforge ----------
def paint_ember():
    yy, xx = np.mgrid[0:H, 0:W]
    img = vgrad(col('#140507'), col('#7a2a12'), 1.6)
    img = glow(img, W * 0.56, H * 0.60, 1000, col('#ff5a1e') * 0.3, 1, 2.5)
    img = stars(img, 400, 1, 0.45, 0.3)
    img = clouds(img, col('#2a0f0f'), 11, 340, 0.48, 0.55, 0.3, 0.9)
    img = clouds(img, col('#ff7a2e') * 0.5, 12, 220, 0.6, 0.5, 0.18, 0.5)
    # five fogged ridges for depth
    fog = col('#7a2a12')
    for k, (y, amp, c, f) in enumerate([(0.46, 70, '#3a1210', 0.6), (0.50, 60, '#2e0e0e', 0.45), (0.55, 55, '#240b0c', 0.3), (0.60, 45, '#1c0809', 0.15)]):
        m, _ = ridge_mask(H * y, amp, 260 - k * 30, 21 + k)
        img = texture(img, m, lerp(col(c), fog, f), lerp(col(c) * 1.4, fog, f), 90, 31 + k)
    # volcano cone with rock texture
    cone = H * 0.26 + np.abs(xx[0] - W * 0.56) * 0.66 + (noise1d(W, 50, 4, 23) - 0.5) * 36
    cm = np.clip((yy - cone[None, :]) / 2 + 0.5, 0, 1)
    img = texture(img, cm, col('#1a0708'), col('#3a1410'), 70, 41)
    # lit side of the cone from the crater glow
    lit = cm * np.clip(1 - (yy - H * 0.26) / (H * 0.45), 0, 1) ** 2 * np.clip(1 - np.abs(xx - W * 0.56) / 220, 0, 1)
    img = img + col('#ff6a1a')[None, None, :] * (lit * 0.35)[:, :, None]
    img = glow(img, W * 0.56, H * 0.26, 150, col('#ff6a1a'), 0.9, 1.5)
    # smoke plume drifting left
    plume = noise(W, H, 220, 5, 24)
    px = np.clip(1 - np.abs(xx - (W * 0.56 - (H * 0.26 - yy) * 0.9)) / (90 + (H * 0.26 - yy) * 1.6), 0, 1)
    pm = np.clip((plume - 0.42) / 0.3, 0, 1) * px * np.clip((H * 0.26 - yy) / (H * 0.26), 0, 1) ** 0.6
    img = blend(img, col('#241010'), pm * 0.9)
    img = blend(img, col('#ff7a2e'), pm * 0.3 * np.clip((yy - H * 0.1) / (H * 0.16), 0, 1))
    # two lava channels running down the cone
    for sx, seed in ((W * 0.50, 51), (W * 0.63, 52)):
        path = sx + (noise1d(H, 120, 4, seed) - 0.5) * 160 * np.clip((yy[:, 0] - H * 0.26) / (H * 0.5), 0, 1)
        width = 3 + (yy[:, 0] - H * 0.26) / H * 26
        chan = np.clip(1 - np.abs(xx - path[:, None]) / width[:, None], 0, 1) * (yy > H * 0.27) * cm
        g = soft_blur(np.repeat((chan * 255)[:, :, None], 3, 2), 18) / 255
        img = img + col('#ff3c0a')[None, None, :] * g * 0.9
        img = blend(img, col('#ffd27a'), chan ** 0.7 * 0.95)
    # foreground crust field with lava pools
    fm, line = ridge_mask(H * 0.72, 50, 320, 25)
    img = texture(img, fm, col('#0c0304'), col('#1e0a08'), 60, 61)
    pools = noise(W, H, 140, 4, 26)
    pm2 = np.clip((pools - 0.62) / 0.12, 0, 1) * fm * np.clip((yy - line[None, :]) / 60, 0, 1)
    g = soft_blur(np.repeat((pm2 * 255)[:, :, None], 3, 2), 20) / 255
    img = img + col('#ff3c0a')[None, None, :] * g * 0.8
    img = blend(img, col('#ff9a3a'), pm2 * 0.9)
    img = blend(img, col('#fff0b0'), np.clip((pools - 0.72) / 0.08, 0, 1) * fm)
    # dragon over the peak
    im = to_im(img); d = ImageDraw.Draw(im)
    cx, cy = W * 0.36, H * 0.16; k = 0.8
    def P(pts): return [(cx + x * k, cy + y * k) for x, y in pts]
    d.polygon(P([(-60, 0), (-140, -70), (-220, -140), (-180, -60), (-120, 10), (-40, 18)]), fill=(20, 7, 8))
    d.polygon(P([(40, 6), (120, -90), (240, -150), (260, -80), (190, 0), (90, 30)]), fill=(20, 7, 8))
    d.polygon(P([(-60, 0), (-20, -10), (40, 0), (90, 20), (160, 60), (230, 110), (150, 70), (80, 44), (20, 30), (-50, 20)]), fill=(20, 7, 8))
    d.polygon(P([(-60, 0), (-100, -16), (-150, -8), (-120, 12), (-60, 18)]), fill=(20, 7, 8))
    img = to_np(im)
    finish(img, 'ember', 0.6)


# ---------- 2. Tidehollow ----------
def paint_tide():
    yy, xx = np.mgrid[0:H, 0:W]
    img = vgrad(col('#03060f'), col('#17405f'), 1.3)
    img = stars(img, 1100, 2, 0.9, 0.5)
    mx, my = W * 0.64, H * 0.20
    img = glow(img, mx, my, 520, col('#8fd2ff') * 0.3, 1, 2.2)
    img = clouds(img, col('#0e2740'), 31, 420, 0.52, 0.5, 0.28, 0.8)
    img = clouds(img, col('#6fb6e0') * 0.7, 32, 180, 0.66, 0.45, 0.15, 0.35)
    hz = int(H * 0.56)
    fog = col('#17405f')
    m, _ = ridge_mask(H * 0.53, 22, 460, 33)
    img = texture(img, m * (yy < hz), lerp(col('#0a1c2e'), fog, 0.7), lerp(col('#143450'), fog, 0.7), 80, 34)
    # sea from the sky (before the moon disc, so the moon reflects as a path, not a disc)
    sky = img[:hz].copy()
    refl_im = Image.fromarray(np.clip(sky[::-1], 0, 255).astype(np.uint8)).resize((W, (H - hz) // 8), Image.BILINEAR).resize((W, H - hz), Image.BILINEAR).filter(ImageFilter.GaussianBlur(6))
    img[hz:] = np.asarray(refl_im, np.float32) * 0.45 + vgrad(col('#0a2840'), col('#02070d'), 0.9)[hz:] * 0.55
    # moon disc
    disc = np.clip(1 - (np.sqrt((xx - mx) ** 2 + (yy - my) ** 2) - 56) / 2, 0, 1)
    img = blend(img, col('#eef8ff'), disc)
    img = blend(img, col('#c9dde8'), disc * np.clip((noise(W, H, 40, 3, 30) - 0.5) * 2, 0, 1) * 0.5)
    # moon path: horizontal streaks that widen toward the viewer
    streak = np.asarray(Image.fromarray((noise(W // 8, H, 14, 3, 36) * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), np.float32) / 255
    sea = np.clip((yy - hz) / 3, 0, 1)
    dy = np.maximum(yy - hz, 0)
    path = np.clip(1 - np.abs(xx - mx) / (30 + dy * 0.9), 0, 1) ** 1.5 * np.clip(dy / (H - hz), 0, 1) ** 0.25
    bright = np.clip((streak - 0.5) * 2.5, 0, 1)
    img = img + col('#cfeeff')[None, None, :] * ((bright * path * 0.95 + bright * 0.06) * sea)[:, :, None]
    # sea stacks in silhouette, the tallest crowned by a ruined watchtower
    mask_im = Image.new('L', (W, H), 0); dm = ImageDraw.Draw(mask_im)
    im = to_im(img); d = ImageDraw.Draw(im)
    rnd = random.Random(3)
    def stack(x, top, base_w, top_w, color):
        pts = []
        n = 14
        for i in range(n + 1):
            t = i / n; y = top + (H * 0.80 - top) * t
            w = top_w + (base_w - top_w) * t ** 1.4 + (rnd.random() - 0.5) * base_w * 0.25
            pts.append((x - w, y))
        for i in range(n, -1, -1):
            t = i / n; y = top + (H * 0.80 - top) * t
            w = top_w + (base_w - top_w) * t ** 1.4 + (rnd.random() - 0.5) * base_w * 0.25
            pts.append((x + w, y))
        d.polygon(pts, fill=color); dm.polygon(pts, fill=255)
    stack(W * 0.20, H * 0.30, 150, 60, (6, 16, 28))
    stack(W * 0.36, H * 0.44, 70, 22, (8, 20, 34))
    stack(W * 0.86, H * 0.50, 90, 30, (8, 20, 34))
    tx, ty = W * 0.20, H * 0.30
    c = (6, 16, 28)
    d.rectangle([tx - 28, ty - 150, tx + 28, ty + 20], fill=c)
    for k in range(-2, 3):
        d.rectangle([tx + k * 14 - 5, ty - 166, tx + k * 14 + 5, ty - 150], fill=c)
    d.rectangle([tx + 28, ty - 80, tx + 66, ty + 20], fill=c)
    d.rectangle([tx - 7, ty - 118, tx + 7, ty - 96], fill=(150, 215, 250))
    img = to_np(im)
    img = glow(img, tx, ty - 107, 70, col('#8fd2ff') * 0.5, 1, 1.6)
    rock = np.asarray(mask_im, np.float32) / 255
    img = texture(img, rock, col('#06121f'), col('#12304a'), 40, 39)
    img = blend(img, col('#02060a'), np.clip((noise(W, H, 24, 4, 48) - 0.6) / 0.15, 0, 1) * rock * 0.7)
    # waterline foam around the stacks and the shore
    foamn = noise(W, H, 30, 4, 43)
    near = np.clip(1 - np.abs(yy - H * 0.80) / 16, 0, 1) * np.clip(1 - np.minimum(np.abs(xx - W * 0.20) / 230, np.abs(xx - W * 0.86) / 150), 0, 1)
    img = blend(img, col('#dff4ff'), np.clip((foamn - 0.42) / 0.3, 0, 1) * near * 0.8)
    fm, fl = ridge_mask(H * 0.90, 30, 420, 45)
    img = texture(img, fm, col('#02070c'), col('#0b1e2e'), 50, 46)
    shore = np.clip(1 - np.abs(yy - fl[None, :] + 6) / 10, 0, 1) * np.clip((noise(W, H, 40, 3, 47) - 0.4) * 2.5, 0, 1)
    img = blend(img, col('#dff4ff'), shore * 0.7)
    finish(img, 'tide', 0.5)


# ---------- 3. Gravewood ----------
def paint_grave():
    yy, xx = np.mgrid[0:H, 0:W]
    img = vgrad(col('#090c0b'), col('#2f3e35'), 1.2)
    mx, my = W * 0.26, H * 0.20
    img = glow(img, mx, my, 560, col('#b8d8c0') * 0.24, 1, 2.4)
    disc = np.clip(1 - (np.sqrt((xx - mx) ** 2 + (yy - my) ** 2) - 66) / 2, 0, 1)
    img = blend(img, col('#e3ece0'), disc)
    img = blend(img, col('#b9c6b6'), disc * np.clip((noise(W, H, 40, 3, 40) - 0.5) * 2, 0, 1) * 0.5)
    img = clouds(img, col('#161d19'), 41, 460, 0.48, 0.6, 0.3, 0.9)
    img = clouds(img, col('#44544a'), 46, 260, 0.6, 0.5, 0.2, 0.4)
    fog = col('#2f3e35')
    for k, (y, c, f) in enumerate([(0.50, '#121a16', 0.55), (0.55, '#0e1411', 0.35)]):
        m, _ = ridge_mask(H * y, 30, 400, 42 + k)
        img = texture(img, m, lerp(col(c), fog, f), lerp(col(c) * 1.6, fog, f), 70, 47 + k)
    # far dead trees, fogged
    im = to_im(img); d = ImageDraw.Draw(im)
    for i, tx in enumerate([W * 0.46, W * 0.58, W * 0.64, W * 0.78, W * 0.34]):
        tree(d, tx, H * 0.60, math.pi / 2, 60, 7, 5, (26, 36, 30), 0.5, 100 + i)
    # mausoleum: pointed gothic roof, columns, glowing door
    cx, cy = W * 0.72, H * 0.64
    body = (12, 16, 14); trim = (30, 40, 34)
    d.rectangle([cx - 120, cy - 110, cx + 120, cy], fill=body)
    d.polygon([(cx - 140, cy - 110), (cx, cy - 215), (cx + 140, cy - 110)], fill=body)
    d.polygon([(cx - 118, cy - 112), (cx, cy - 200), (cx + 118, cy - 112)], fill=trim)
    d.polygon([(cx - 100, cy - 116), (cx, cy - 190), (cx + 100, cy - 116)], fill=body)
    for k in (-80, -44, 44, 80):
        d.rectangle([cx + k - 8, cy - 100, cx + k + 8, cy], fill=trim)
    d.rectangle([cx - 24, cy - 60, cx + 24, cy], fill=(52, 86, 64))
    d.pieslice([cx - 24, cy - 84, cx + 24, cy - 36], 180, 360, fill=(52, 86, 64))
    d.polygon([(cx - 24, cy - 60), (cx, cy - 96), (cx + 24, cy - 60)], fill=(52, 86, 64))
    # iron fence and stones
    for k in range(-9, 10):
        gx = cx + k * 30
        d.line([(gx, cy + 10), (gx, cy + 40)], fill=body, width=2)
        d.polygon([(gx - 4, cy + 12), (gx, cy + 2), (gx + 4, cy + 12)], fill=body)
    d.line([(cx - 275, cy + 20), (cx + 275, cy + 20)], fill=body, width=2)
    rnd = random.Random(5)
    for k in range(14):
        gx, gy = W * (0.30 + rnd.random() * 0.62), H * (0.70 + rnd.random() * 0.06)
        w, h = 10 + rnd.random() * 8, 24 + rnd.random() * 26
        if rnd.random() < 0.3:
            d.rectangle([gx - 3, gy - h, gx + 3, gy], fill=body); d.rectangle([gx - 10, gy - h + 10, gx + 10, gy - h + 16], fill=body)
        else:
            d.rounded_rectangle([gx - w, gy - h, gx + w, gy], int(w * 0.8), fill=body)
    # big foreground trees framing the scene
    tree(d, W * 0.09, H * 0.86, math.pi / 2 + 0.08, 200, 10, 26, (6, 8, 7), 0.42, 1)
    tree(d, W * 0.93, H * 0.84, math.pi / 2 - 0.1, 170, 10, 22, (6, 8, 7), 0.45, 2)
    tree(d, W * 0.20, H * 0.76, math.pi / 2, 110, 8, 12, (10, 13, 11), 0.5, 3)
    img = to_np(im)
    fm, line = ridge_mask(H * 0.76, 18, 500, 43)
    img = texture(img, fm, col('#090c0a'), col('#141b16'), 50, 48)
    water = np.clip((yy - H * 0.82) / 4, 0, 1)
    img = blend(img, col('#0f1713'), water * 0.85)
    refl = np.clip(1 - np.abs(xx - mx) / 80, 0, 1) ** 2 * water * np.clip((noise(W, H, 100, 3, 44) - 0.45) * 3, 0, 1)
    img = blend(img, col('#9fb8a4'), refl * 0.45)
    for sc, sd, st in ((300, 45, 0.35), (160, 49, 0.25)):
        mist = noise(W, H, sc, 5, sd)
        mm = np.clip((mist - 0.35) / 0.4, 0, 1) * np.clip((yy - H * 0.52) / (H * 0.3), 0, 1)
        img = blend(img, col('#9fb3a4'), mm * st)
    rnd = random.Random(9)
    for _ in range(7):
        img = glow(img, rnd.random() * W, H * (0.56 + rnd.random() * 0.3), 26, col('#b6ffc0') * 0.9, 1, 2)
    finish(img, 'grave', 0.6)


# ---------- 4. Sunspire ----------
def paint_sun():
    yy, xx = np.mgrid[0:H, 0:W]
    img = vgrad(col('#e8c084'), col('#c9682f'), 1.1)
    sx, sy = W * 0.5, H * 0.46
    img = glow(img, sx, sy, 900, col('#fff1c8') * 0.55, 1, 2.4)
    img = glow(img, sx, sy, 130, col('#ffffff') * 0.95, 1, 1.3)
    img = clouds(img, col('#ffe2b4'), 51, 520, 0.48, 0.5, 0.32, 0.55)
    img = clouds(img, col('#a8512a'), 52, 240, 0.6, 0.5, 0.2, 0.45)
    ang = np.arctan2(yy - sy, xx - sx)
    rays = np.clip((np.sin(ang * 14 + noise(W, H, 400, 2, 50) * 2) - 0.72) / 0.28, 0, 1) * np.clip(1 - np.sqrt((xx - sx) ** 2 + (yy - sy) ** 2) / 950, 0, 1) ** 1.3
    img = img + col('#fff2c8')[None, None, :] * (rays * 0.16)[:, :, None]
    fog = col('#e9a860')
    for k, (y, amp, c, f) in enumerate([(0.50, 70, '#8a4a2a', 0.65), (0.55, 60, '#6e3822', 0.5), (0.60, 50, '#52281a', 0.3), (0.66, 44, '#3e1e14', 0.12)]):
        m, _ = ridge_mask(H * y, amp, 300 - k * 40, 53 + k)
        img = texture(img, m, lerp(col(c), fog, f), lerp(col(c) * 1.5, fog, f), 90, 60 + k)
    im = to_im(img); d = ImageDraw.Draw(im)
    px, py = W * 0.5, H * 0.72
    d.polygon([(px - 480, py + 50), (px - 330, py), (px + 330, py), (px + 480, py + 50)], fill=(78, 42, 28))
    for k, (hw, hh) in enumerate([(300, 14), (280, 12), (260, 12)]):
        d.rectangle([px - hw, py - 14 * (k + 1) - hh + 14, px + hw, py - 14 * k], fill=(236 - k * 10, 210 - k * 10, 160 - k * 8))
    base = py - 42
    for k in range(-5, 6):
        x = px + k * 48
        shade = (240, 220, 176) if k < 0 else (214, 180, 128)
        d.rectangle([x - 10, base - 150, x + 10, base], fill=shade)
        d.rectangle([x - 15, base - 160, x + 15, base - 150], fill=(246, 230, 190))
        d.rectangle([x - 14, base, x + 14, base + 6], fill=(246, 230, 190))
    d.rectangle([px - 270, base - 176, px + 270, base - 160], fill=(246, 230, 190))
    d.polygon([(px - 284, base - 176), (px, base - 262), (px + 284, base - 176)], fill=(240, 220, 176))
    d.polygon([(px - 250, base - 186), (px, base - 250), (px + 250, base - 186)], fill=(150, 96, 60))
    d.rectangle([px - 24, base - 150, px + 24, base], fill=(255, 246, 214))
    img = to_np(im)
    img = glow(img, px, base - 80, 140, col('#fff2c8') * 0.45, 1, 1.5)
    fm, _ = ridge_mask(H * 0.87, 40, 420, 57)
    img = texture(img, fm, col('#3a1a12'), col('#5a2c1a'), 50, 66)
    grass = noise(W, H, 24, 3, 67)
    img = blend(img, col('#c48a4a'), np.clip((grass - 0.6) / 0.2, 0, 1) * fm * 0.5)
    hz = np.clip((yy - H * 0.55) / (H * 0.35), 0, 1) * 0.22
    img = blend(img, col('#f0b878'), hz)
    finish(img, 'sun', 0.5, 0.04)


# ---------- 5. Wildheart ----------
def paint_wild():
    yy, xx = np.mgrid[0:H, 0:W]
    img = vgrad(col('#7fc292'), col('#0f2a16'), 1.0)
    img = glow(img, W * 0.60, H * 0.05, 560, col('#f6ffd6') * 0.6, 1, 2)
    fog = col('#6fb085')
    # far canopy layers
    for k, (c, f, sc) in enumerate([('#2b6b3e', 0.6, 160), ('#1f5a32', 0.4, 130), ('#174626', 0.2, 110)]):
        n = noise(W, H, sc, 5, 61 + k)
        m = np.clip((n - 0.42) / 0.22, 0, 1) * np.clip((yy - H * (0.08 + k * 0.08)) / (H * 0.2), 0, 1)
        img = texture(img, m, lerp(col(c), fog, f), lerp(col(c) * 1.4, fog, f), 50, 70 + k)
    # waterfall and pool
    wx = W * 0.56
    fall = np.clip(1 - np.abs(xx - wx) / 30, 0, 1) ** 0.5 * np.clip((yy - H * 0.26) / 30, 0, 1) * (yy < H * 0.80)
    tex = noise(W, H, 40, 3, 62)
    img = blend(img, col('#e9fbff'), fall * (0.5 + 0.5 * tex))
    img = glow(img, wx, H * 0.80, 240, col('#dff8ff') * 0.55, 1, 1.8)
    pool = np.clip((yy - H * 0.80) / 4, 0, 1) * np.clip(1 - np.abs(xx - wx) / 420, 0, 1)
    img = blend(img, col('#2a6a66'), pool * 0.8)
    img = blend(img, col('#bfe9e4'), pool * np.clip((noise(W, H, 60, 3, 63) - 0.55) * 4, 0, 1) * 0.5)
    im = to_im(img); d = ImageDraw.Draw(im)
    # tapered trunks with flared roots, branches, bark stripes
    rnd = random.Random(11)
    trunks = [(W * 0.07, 62, (14, 32, 18)), (W * 0.23, 40, (18, 40, 22)), (W * 0.88, 72, (12, 28, 16)), (W * 0.73, 36, (20, 44, 24)), (W * 0.40, 26, (24, 52, 28))]
    for tx, tw, c in trunks:
        pts = []
        for i in range(0, 11):
            t = i / 10
            y = H * (0.02 + t * 0.86)
            w = tw * (0.45 + t * 0.55 + (0.9 if t > 0.92 else 0) * (t - 0.92) * 9)
            wob = (rnd.random() - 0.5) * tw * 0.3
            pts.append((tx - w + wob, y))
        for i in range(10, -1, -1):
            t = i / 10
            y = H * (0.02 + t * 0.86)
            w = tw * (0.45 + t * 0.55 + (0.9 if t > 0.92 else 0) * (t - 0.92) * 9)
            wob = (rnd.random() - 0.5) * tw * 0.3
            pts.append((tx + w + wob, y))
        d.polygon(pts, fill=c)
        for k in range(4):
            y0 = H * (0.14 + k * 0.13)
            s = 1 if (k + int(tx)) % 2 else -1
            tree(d, tx + s * tw * 0.4, y0, (0.25 if s > 0 else math.pi - 0.25), tw * 3.2, 5, tw * 0.35, c, 0.5, k + int(tx))
        for k in range(18):
            yk = H * (0.1 + rnd.random() * 0.75)
            d.line([(tx - tw * 0.5, yk), (tx + tw * 0.5 + 10, yk + rnd.random() * 20 - 10)], fill=(c[0] + 10, c[1] + 14, c[2] + 10), width=2)
    img = to_np(im)
    # canopy clusters overhead, in three greens
    for k, (c, sc, cov) in enumerate([('#0f2a14', 70, 0.46), ('#1b4a22', 50, 0.55), ('#2e6a34', 36, 0.62)]):
        leaf = noise(W, H, sc, 5, 80 + k)
        top = np.clip((leaf - cov) / 0.16, 0, 1) * np.clip((H * 0.32 - yy) / (H * 0.3), 0, 1)
        img = blend(img, col(c), top * 0.95)
    shafts = np.clip((np.sin((xx + yy * 0.6) / 60 + noise(W, H, 300, 2, 90) * 3) - 0.55) / 0.45, 0, 1) * np.clip(1 - yy / (H * 0.95), 0, 1) ** 1.6
    img = img + col('#f4ffd0')[None, None, :] * (shafts * 0.26)[:, :, None]
    fm, _ = ridge_mask(H * 0.84, 24, 300, 64)
    img = texture(img, fm, col('#13301a'), col('#245a2a'), 40, 91)
    im = to_im(img); d = ImageDraw.Draw(im)
    rnd = random.Random(12)
    for _ in range(40):
        fx, fy = rnd.random() * W, H * (0.84 + rnd.random() * 0.14)
        for a in range(-4, 5):
            ang = math.pi / 2 + a * 0.22
            d.line([(fx, fy), (fx + math.cos(ang) * 50, fy - math.sin(ang) * 50)], fill=(30, 90, 40), width=3)
    img = to_np(im)
    moss = noise(W, H, 30, 4, 65)
    img = blend(img, col('#6fb05a'), np.clip((moss - 0.58) / 0.2, 0, 1) * fm * 0.6)
    for _ in range(16):
        img = glow(img, rnd.random() * W, H * (0.45 + rnd.random() * 0.45), 16, col('#d8ff7a') * 0.9, 1, 2)
    finish(img, 'wild', 0.55)


if __name__ == '__main__':
    paint_ember(); paint_tide(); paint_grave(); paint_sun(); paint_wild()
