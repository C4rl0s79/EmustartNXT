"""Grafiki motywu Portal Nexus (lumen/docs/themes/portal-nexus/assets): tła synthwave dla grup biblioteki, neonowe
emblematy (logo grup) i płytka pod logo platform. Wszystko rysowane tu, bez zewnętrznych obrazów.

    python portal_nexus_assets.py        (z dowolnego miejsca; zapisuje do ../portal-nexus/assets)

Rysowanie w 3× rozdzielczości i pomniejszanie (gładkie krawędzie); poświata = rozmyta kopia pod ostrą linią.
"""

import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "portal-nexus" / "assets"
S = 3  # nadpróbkowanie

CYAN = (45, 226, 255)
PINK = (255, 63, 164)
VIOLET = (139, 92, 255)
GOLD = (255, 200, 70)
LIME = (120, 255, 170)
ORANGE = (255, 140, 60)

# grupa → (kolor emblematu, kolor słońca / akcent sceny, emblemat)
GROUPS = {
    "grp:pc": (CYAN, PINK, "monitor"),
    "grp:computer": (LIME, CYAN, "computer"),
    "grp:console": (PINK, VIOLET, "gamepad"),
    "grp:arcade": (GOLD, PINK, "arcade"),
    "grp:other": (VIOLET, CYAN, "question"),
    "grp:col": (CYAN, VIOLET, "cards"),
    "grp:fav": (GOLD, ORANGE, "star"),
    "grp:recent": (VIOLET, PINK, "clock"),
    "pc/steam": (CYAN, VIOLET, "monitor"),
    "pc/gog": (VIOLET, PINK, "monitor"),
    "pc/shortcut": (LIME, CYAN, "link"),
}
# logo tylko dla grup — podgrupy Steam / GOG zostają przy własnych znakach (nie podrabiamy marek)
LOGOS = [k for k in GROUPS if k.startswith("grp:")]


def glow(layer: Image.Image, radius: float, strength: float = 1.0) -> Image.Image:
    """Ostra warstwa RGBA + jej rozmyte kopie pod spodem (neon)."""
    out = Image.new("RGBA", layer.size)
    for r, a in ((radius * 2.2, 0.55), (radius, 0.85)):
        g = layer.filter(ImageFilter.GaussianBlur(r))
        if strength != 1.0 or a != 1.0:
            al = g.getchannel("A").point(lambda v: min(255, int(v * a * strength)))
            g.putalpha(al)
        out = Image.alpha_composite(out, g)
    return Image.alpha_composite(out, layer)


# ── emblematy (współrzędne 0–100, linie neonu) ─────────────────────────────────

def emblem(kind: str, size: int, color: tuple, width: float = 4.2) -> Image.Image:
    W = size * S
    im = Image.new("RGBA", (W, W))
    d = ImageDraw.Draw(im)
    k = W / 100
    lw = max(2, int(width * k / 2.2))
    col = color + (255,)

    def P(x, y):
        return (x * k, y * k)

    def rect(x0, y0, x1, y1, r=4):
        d.rounded_rectangle([P(x0, y0), P(x1, y1)], radius=r * k, outline=col, width=lw)

    def line(*pts):
        d.line([P(*p) for p in pts], fill=col, width=lw, joint="curve")

    def circle(cx, cy, r, fill=False):
        box = [P(cx - r, cy - r), P(cx + r, cy + r)]
        d.ellipse(box, outline=col, width=lw, fill=col if fill else None)

    if kind == "monitor":
        rect(14, 18, 86, 66, 5)
        rect(21, 25, 79, 59, 2)
        line((50, 66), (50, 78))
        line((34, 82), (66, 82))
    elif kind == "computer":
        rect(12, 22, 88, 52, 4)
        rect(20, 28, 80, 46, 2)
        rect(8, 60, 92, 80, 4)
        for y in (66, 73):
            for x in range(16, 86, 9):
                d.rectangle([P(x, y), P(x + 5, y + 3.5)], outline=col, width=max(1, lw // 2))
    elif kind == "gamepad":
        d.rounded_rectangle([P(10, 34), P(90, 70)], radius=17 * k, outline=col, width=lw)
        line((24, 52), (36, 52))
        line((30, 46), (30, 58))
        circle(66, 48, 3.4, True)
        circle(74, 56, 3.4, True)
        circle(58, 56, 3.4, True)
        circle(66, 64, 3.4, True)
    elif kind == "arcade":
        rect(18, 60, 82, 84, 4)
        line((50, 60), (44, 24))
        circle(43, 20, 8)
        circle(64, 70, 4, True)
        circle(74, 70, 4, True)
    elif kind == "question":
        circle(50, 50, 38)
        d.arc([P(36, 24), P(64, 52)], start=180, end=40, fill=col, width=lw)
        line((60, 47), (50, 54), (50, 62))
        circle(50, 72, 3, True)
    elif kind == "cards":
        rect(26, 16, 82, 70, 4)
        rect(20, 22, 76, 76, 4)
        rect(14, 28, 70, 84, 4)
    elif kind == "star":
        pts = []
        for i in range(10):
            a = -math.pi / 2 + i * math.pi / 5
            r = 40 if i % 2 == 0 else 17
            pts.append(P(50 + r * math.cos(a), 52 + r * math.sin(a)))
        d.line(pts + [pts[0]], fill=col, width=lw, joint="curve")
    elif kind == "clock":
        circle(50, 50, 38)
        line((50, 50), (50, 26))
        line((50, 50), (67, 60))
        circle(50, 50, 3, True)
        for i in range(12):
            a = i * math.pi / 6
            line((50 + 33 * math.cos(a), 50 + 33 * math.sin(a)), (50 + 36 * math.cos(a), 50 + 36 * math.sin(a)))
    elif kind == "link":
        d.rounded_rectangle([P(10, 38), P(54, 62)], radius=12 * k, outline=col, width=lw)
        d.rounded_rectangle([P(46, 38), P(90, 62)], radius=12 * k, outline=col, width=lw)
    small = im.resize((size, size), Image.Resampling.LANCZOS)
    return glow(small, radius=size / 40)


# ── tła synthwave ───────────────────────────────────────────────────────────────

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background(key: str, ink: tuple, sun: tuple, kind: str, w: int = 1920, h: int = 1080) -> Image.Image:
    rnd = random.Random(key)
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    horizon = int(h * 0.62)
    top, mid = (4, 1, 14), (34, 8, 62)
    for y in range(horizon):
        t = y / horizon
        d.line([(0, y), (w, y)], fill=lerp(top, mid, t ** 1.6))
    for y in range(horizon, h):
        t = (y - horizon) / (h - horizon)
        d.line([(0, y), (w, y)], fill=lerp((22, 4, 40), (5, 1, 14), t))
    # gwiazdy
    for _ in range(420):
        x, y = rnd.randrange(w), rnd.randrange(int(horizon * 0.95))
        b = rnd.randint(90, 255)
        r = rnd.choice((1, 1, 1, 2))
        d.ellipse([x - r / 2, y - r / 2, x + r / 2, y + r / 2], fill=(b, b, min(255, b + 30)))
    # słońce z pasami
    sun_l = Image.new("RGBA", (w, h))
    sd = ImageDraw.Draw(sun_l)
    cx, cy, R = int(w * (0.5 + rnd.uniform(-0.18, 0.18))), int(horizon - h * 0.06), int(h * 0.24)
    for i in range(R, 0, -2):
        t = 1 - i / R
        sd.ellipse([cx - i, cy - i, cx + i, cy + i], fill=lerp(sun, (255, 230, 120), t * 0.85) + (255,))
    cut = ImageDraw.Draw(sun_l)
    for j in range(7):
        y = cy + int(R * 0.12) + j * int(R * 0.13)
        cut.rectangle([cx - R, y, cx + R, y + max(3, int(R * 0.025 * (j + 1)))], fill=(0, 0, 0, 0))
    sun_g = sun_l.filter(ImageFilter.GaussianBlur(40))
    base = Image.alpha_composite(im.convert("RGBA"), sun_g)
    base = Image.alpha_composite(base, sun_l)
    # góry z neonową krawędzią
    mnt = Image.new("RGBA", (w, h))
    md = ImageDraw.Draw(mnt)
    for layer, (amp, colr, edge) in enumerate(((0.22, (14, 4, 30), sun), (0.14, (8, 2, 20), ink))):
        pts = [(0, horizon)]
        x = 0
        while x <= w:
            y = horizon - int(h * amp * (0.35 + 0.65 * abs(math.sin(x / (170 + 90 * layer) + rnd.random()))) * rnd.uniform(0.6, 1.0))
            pts.append((x, y))
            x += rnd.randint(70, 160)
        pts += [(w, horizon), (w, horizon + 2), (0, horizon + 2)]
        md.polygon(pts, fill=colr + (255,))
        md.line(pts[1:-3], fill=edge + (255,), width=3)
    base = Image.alpha_composite(base, glow(mnt, 6, 0.8))
    # siatka podłogi w perspektywie
    grid = Image.new("RGBA", (w, h))
    gd = ImageDraw.Draw(grid)
    vx = w // 2
    for i in range(-24, 25):
        x0 = vx + i * 30
        x1 = vx + i * w // 9
        gd.line([(x0, horizon), (x1, h)], fill=ink + (150,), width=2)
    y, step = horizon + 4, 6
    while y < h:
        a = int(70 + 150 * (y - horizon) / (h - horizon))
        gd.line([(0, y), (w, y)], fill=sun + (a,), width=2)
        y += step
        step = int(step * 1.32) + 2
    base = Image.alpha_composite(base, glow(grid, 4, 0.9))
    # duży, przygaszony emblemat grupy na niebie
    em = emblem(kind, int(h * 0.42), ink, width=3.2)
    em.putalpha(em.getchannel("A").point(lambda v: int(v * 0.38)))
    base.alpha_composite(em, (int(w * 0.7) - em.width // 2 if cx < w / 2 else int(w * 0.3) - em.width // 2, int(h * 0.08)))
    # winieta
    vig = Image.new("L", (w, h), 0)
    ImageDraw.Draw(vig).ellipse([-w * 0.25, -h * 0.35, w * 1.25, h * 1.35], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(160))
    dark = Image.new("RGBA", (w, h), (2, 0, 8, 255))
    dark.putalpha(ImageChops.invert(vig).point(lambda v: int(v * 0.85)))
    return Image.alpha_composite(base, dark).convert("RGB")


def plate() -> Image.Image:
    """Płytka pod logo platform: ciemne szkło z neonową krawędzią (cyjan → róż), 1200×440."""
    W, H = 1200, 440
    im = Image.new("RGBA", (W * S, H * S))
    d = ImageDraw.Draw(im)
    r = 60 * S
    d.rounded_rectangle([20 * S, 20 * S, (W - 20) * S, (H - 20) * S], radius=r, fill=(10, 4, 28, 215))
    edge = Image.new("RGBA", im.size)
    ed = ImageDraw.Draw(edge)
    ed.rounded_rectangle([20 * S, 20 * S, (W - 20) * S, (H - 20) * S], radius=r, outline=(255, 255, 255, 255), width=5 * S)
    grad = Image.new("RGBA", im.size)
    gd = ImageDraw.Draw(grad)
    for x in range(0, W * S, S):
        gd.line([(x, 0), (x, H * S)], fill=lerp(CYAN, PINK, x / (W * S)) + (255,), width=S)
    edge = Image.composite(grad, Image.new("RGBA", im.size), edge.getchannel("A"))
    small = Image.alpha_composite(im, edge).resize((W, H), Image.Resampling.LANCZOS)
    return glow(small, 10, 0.7)


def main() -> None:
    (OUT / "bg").mkdir(parents=True, exist_ok=True)
    (OUT / "logo").mkdir(parents=True, exist_ok=True)
    for key, (ink, sun, kind) in GROUPS.items():
        name = key.replace(":", "-").replace("/", "-")
        background(key, ink, sun, kind).save(OUT / "bg" / f"{name}.webp", "WEBP", quality=80, method=6)
        if key in LOGOS:
            emblem(kind, 512, ink).save(OUT / "logo" / f"{name}.png", optimize=True)
    plate().save(OUT / "plate.png", optimize=True)
    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"zapisano {sum(1 for p in OUT.rglob('*') if p.is_file())} plików, {total >> 10} KB -> {OUT}")


if __name__ == "__main__":
    main()
