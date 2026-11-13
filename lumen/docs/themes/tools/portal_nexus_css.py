"""theme.css i layers.html motywu Portal Nexus — część stała + reguły cząsteczek (pozycje, wielkości, prędkości)
generowane z ziarna (dekoracje nie mogą mieć atrybutu style — wszystko w CSS).

    python portal_nexus_css.py
"""
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "portal-nexus"
T = ".tv[data-theme='portal-nexus']"
N_SPARK, N_DUST, N_SHOOT = 32, 26, 5

BASE = """/* Portal Nexus — motyw trybu TV z paczki (neon i synthwave). Układ listy; kolory z palety theme.json
   (--tv-bg, --tv-text, --tv-dim, --tv-accent, --tv-sel-*, --tv-panel); dekoracje w layers.html (poziomy animacji:
   lv-med — od średniego, lv-high — tylko wysoki). Plik wygenerowany: docs/themes/tools/portal_nexus_css.py */

@T {
  --nx-pink: #ff3fa4;
  --nx-violet: #8b5cff;
  --nx-cyan: #2de2ff;
  --tv-line: rgba(151, 96, 255, 0.28);
  --tv-accent2: #ff7ac6;
  --tv-plate: url(assets/plate.png);
  --tv-plate-ar: 1200 / 440;
  --tv-plate-lw: 70;
  --tv-plate-lh: 58;
  /* zdjęcia konsol platform: chłodny, przygaszony neon */
  --tv-con-filter: saturate(1.25) hue-rotate(-12deg) brightness(0.75);
  --tv-con-op: 0.32;
  background:
    radial-gradient(1100px 760px at 12% 8%, rgba(45, 226, 255, 0.14), transparent 62%),
    radial-gradient(1000px 720px at 86% 12%, rgba(139, 92, 255, 0.18), transparent 66%),
    radial-gradient(1300px 850px at 50% 112%, rgba(255, 63, 164, 0.16), transparent 70%),
    linear-gradient(180deg, var(--tv-bg) 0%, #0d0330 58%, #16033a 100%);
}

/* ---- górny pasek i podpowiedzi ---- */
@T .tv-brand {
  letter-spacing: 0.06em;
}
@T .tv-brand b {
  color: #fff;
  text-shadow: 0 0 10px var(--nx-cyan), 0 0 26px rgba(45, 226, 255, 0.55);
}
@T .tv-clock {
  color: var(--tv-dim);
  text-shadow: 0 0 12px rgba(139, 92, 255, 0.6);
}
@T .tv-pill {
  background: rgba(45, 226, 255, 0.1);
  box-shadow: inset 0 0 0 1px rgba(45, 226, 255, 0.35), 0 0 14px rgba(45, 226, 255, 0.15);
}
@T .tv-hints {
  background: linear-gradient(0deg, rgba(7, 2, 26, 0.92), rgba(7, 2, 26, 0.4) 70%, transparent);
}
@T .tv-btn--sq {
  background: rgba(139, 92, 255, 0.28);
  box-shadow: inset 0 0 0 1px rgba(139, 92, 255, 0.6);
}

/* ---- karuzela grup: płytka z neonową krawędzią; wybrana — mocna poświata ---- */
@T .tv-syscard .sys-plate {
  filter: drop-shadow(0 10px 30px rgba(0, 0, 0, 0.6));
  transition: filter 0.3s ease;
}
@T .tv-syscard.is-current .sys-plate {
  filter: drop-shadow(0 0 22px rgba(45, 226, 255, 0.55)) drop-shadow(0 0 48px rgba(255, 63, 164, 0.3));
}
@T .tv-sysinfo h1 {
  color: #fff;
  letter-spacing: 0.04em;
  text-shadow: 0 0 14px rgba(45, 226, 255, 0.6), 0 0 40px rgba(255, 63, 164, 0.35), 0 3px 22px rgba(0, 0, 0, 0.9);
}
@T :is(.tv-sysfacts, .tv-sysabout) {
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.9);
}
/* sceny grup z motywu (categories) — na cały ekran, nie jak małe zdjęcie konsoli */
@T .tv-console img[src^='lumen-theme:'] {
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  object-fit: cover;
  transform: none;
  opacity: 0.92;
  filter: none;
}
@T .tv-console:has(img[src^='lumen-theme:']) {
  filter: none;
}
@T .tv-console:has(img[src^='lumen-theme:'])::after {
  background: linear-gradient(180deg, rgba(7, 2, 26, 0.55) 0%, transparent 22%, transparent 48%, rgba(7, 2, 26, 0.78) 74%, rgba(7, 2, 26, 0.95) 100%);
}

/* ---- lista gier: szkło; wybrany wiersz — neonowa belka z poświatą ---- */
@T .tv-gamelist {
  background: linear-gradient(90deg, rgba(10, 4, 30, 0.72), rgba(10, 4, 30, 0.35) 85%, transparent);
  border-right: 1px solid rgba(139, 92, 255, 0.2);
}
@T .tv-listhead h2 {
  color: #fff;
  text-shadow: 0 0 12px rgba(255, 63, 164, 0.55);
}
@T .tv-row {
  border-radius: 10px;
  transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
@T .tv-row.sel {
  color: var(--tv-sel-text);
  background: linear-gradient(90deg, var(--nx-cyan) 0%, #7fefff 45%, rgba(255, 63, 164, 0.9) 100%);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35), 0 0 18px rgba(45, 226, 255, 0.55), 0 0 46px rgba(255, 63, 164, 0.3);
  transform: translateX(0.6vw);
}
@T .tv-row.sel .g {
  color: rgba(4, 18, 28, 0.75);
}
@T .tv-tag {
  border-radius: 6px;
  background: rgba(45, 226, 255, 0.1);
  box-shadow: inset 0 0 0 1px rgba(45, 226, 255, 0.28);
}
@T .tv-row.sel .tv-tag {
  background: rgba(4, 18, 28, 0.22);
  box-shadow: none;
  color: var(--tv-sel-text);
}

/* ---- podgląd: okładka i zrzut w neonowych ramkach ---- */
@T .tv-box .tv-boxart {
  border-radius: 12px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25), 0 0 0 3px rgba(45, 226, 255, 0.55), 0 0 26px rgba(45, 226, 255, 0.45),
    0 0 60px rgba(255, 63, 164, 0.22), 0 24px 60px rgba(0, 0, 0, 0.7);
}
@T .tv-snap .tv-snapart {
  border-radius: 12px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25), 0 0 0 3px rgba(255, 63, 164, 0.55), 0 0 26px rgba(255, 63, 164, 0.4),
    0 24px 60px rgba(0, 0, 0, 0.7);
}

/* ---- panele: ciemne szkło z neonowym brzegiem i świecącą listwą u góry ---- */
@T :is(.tv-info, .tv-panel) {
  position: relative;
  border-radius: 14px;
  border: 1px solid rgba(139, 92, 255, 0.35);
  background: linear-gradient(180deg, rgba(45, 226, 255, 0.07), transparent 40%), var(--tv-panel);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6), 0 0 34px rgba(139, 92, 255, 0.14);
  backdrop-filter: blur(10px);
}
@T :is(.tv-info, .tv-panel)::before {
  content: '';
  position: absolute;
  left: 8%;
  right: 8%;
  top: -1px;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--nx-cyan) 25%, var(--nx-pink) 75%, transparent);
  box-shadow: 0 0 12px rgba(45, 226, 255, 0.7);
}
@T .tv-info h1 {
  color: #fff;
  text-shadow: 0 0 14px rgba(45, 226, 255, 0.4);
}
@T .tv-menulist li {
  border-radius: 10px;
}
@T .tv-menulist li.sel {
  color: var(--tv-sel-text);
  background: linear-gradient(90deg, var(--nx-cyan), rgba(255, 63, 164, 0.85));
  box-shadow: 0 0 18px rgba(45, 226, 255, 0.45);
}

/* ================= dekoracje (layers.html) ================= */

/* poświaty dryfujące po niebie (od poziomu niskiego) */
@T .nx-aura {
  position: absolute;
  inset: -30%;
  background: conic-gradient(from 120deg at 22% 32%, rgba(45, 226, 255, 0.12), transparent 24%, rgba(139, 92, 255, 0.15), transparent 54%,
    rgba(255, 63, 164, 0.12), transparent 80%);
  filter: blur(70px);
  animation: nx-drift 40s ease-in-out infinite alternate;
}
@keyframes nx-drift {
  from { transform: translate3d(-2%, -1%, 0) scale(1.05) rotate(0deg); }
  to { transform: translate3d(2%, 2%, 0) scale(1.12) rotate(8deg); }
}

/* migoczące gwiazdy (dwie warstwy, różne tempo) */
@T :is(.nx-stars, .nx-stars2) {
  position: absolute;
  inset: 0;
  background-repeat: repeat;
  mix-blend-mode: screen;
}
@T .nx-stars {
  background-image: radial-gradient(1.5px 1.5px at 12% 18%, #fff, transparent 70%), radial-gradient(1px 1px at 37% 64%, #bff6ff, transparent 70%),
    radial-gradient(1.5px 1.5px at 63% 27%, #ffd1ec, transparent 70%), radial-gradient(1px 1px at 84% 72%, #fff, transparent 70%),
    radial-gradient(1px 1px at 52% 8%, #d9c8ff, transparent 70%);
  background-size: 420px 420px;
  animation: nx-twinkle 5s ease-in-out infinite alternate;
}
@T .nx-stars2 {
  background-image: radial-gradient(1px 1px at 22% 44%, #fff, transparent 70%), radial-gradient(1px 1px at 71% 12%, #bff6ff, transparent 70%),
    radial-gradient(1.5px 1.5px at 46% 86%, #ffd1ec, transparent 70%);
  background-size: 300px 300px;
  animation: nx-twinkle 7s ease-in-out -3s infinite alternate;
}
@keyframes nx-twinkle {
  from { opacity: 0.25; }
  to { opacity: 0.85; }
}

/* neonowa siatka przy dolnej krawędzi (od średniego) */
@T .nx-grid {
  position: absolute;
  left: -10%;
  right: -10%;
  bottom: 0;
  height: 40vh;
  opacity: 0.3;
  background-image: linear-gradient(to right, rgba(45, 226, 255, 0.35) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 63, 164, 0.3) 1px, transparent 1px);
  background-size: 72px 72px;
  transform: perspective(430px) rotateX(72deg);
  transform-origin: bottom center;
  mask-image: linear-gradient(to top, black 0%, transparent 85%);
  animation: nx-grid 14s linear infinite;
}
@keyframes nx-grid {
  from { background-position: 0 0; }
  to { background-position: 0 72px; }
}

/* iskry unoszące się z dołu (od średniego) */
@T .nx-sparks i {
  position: absolute;
  bottom: -2vh;
  border-radius: 50%;
  background: var(--nx-cyan);
  box-shadow: 0 0 6px var(--nx-cyan), 0 0 16px rgba(45, 226, 255, 0.5);
  opacity: 0;
  animation: nx-rise linear infinite;
}
@T .nx-sparks i:nth-child(3n) {
  background: var(--nx-pink);
  box-shadow: 0 0 6px var(--nx-pink), 0 0 16px rgba(255, 63, 164, 0.5);
}
@T .nx-sparks i:nth-child(4n) {
  background: #ffd23f;
  box-shadow: 0 0 6px #ffd23f, 0 0 16px rgba(255, 210, 63, 0.45);
}
@T .nx-sparks i:nth-child(5n) {
  background: #c7b0ff;
  box-shadow: 0 0 6px var(--nx-violet), 0 0 16px rgba(139, 92, 255, 0.5);
}
@keyframes nx-rise {
  0% { transform: translate3d(0, 0, 0) scale(0.6); opacity: 0; }
  10% { opacity: 0.9; }
  70% { opacity: 0.55; }
  100% { transform: translate3d(var(--nx-dx, 4vw), -108vh, 0) scale(1.2); opacity: 0; }
}

/* pył — wolne, rozmyte drobiny w całym kadrze (od średniego) */
@T .nx-dust i {
  position: absolute;
  border-radius: 50%;
  background: rgba(220, 230, 255, 0.55);
  filter: blur(1px);
  animation: nx-float ease-in-out infinite alternate;
}
@keyframes nx-float {
  from { transform: translate3d(0, 0, 0); opacity: 0.15; }
  to { transform: translate3d(var(--nx-dx, 3vw), var(--nx-dy, -4vh), 0); opacity: 0.6; }
}

/* spadające gwiazdy (tylko wysoki) */
@T .nx-shoot i {
  position: absolute;
  width: 18vw;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.95) 70%, #fff);
  box-shadow: 0 0 10px rgba(45, 226, 255, 0.8);
  opacity: 0;
  transform: rotate(-24deg);
  animation: nx-shoot linear infinite;
}
@keyframes nx-shoot {
  0%, 88% { opacity: 0; transform: translate3d(0, 0, 0) rotate(-24deg); }
  90% { opacity: 1; }
  100% { opacity: 0; transform: translate3d(-40vw, 18vw, 0) rotate(-24deg); }
}

/* linie CRT i winieta (tylko wysoki) */
@T .nx-crt {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 3px),
    radial-gradient(120% 90% at 50% 50%, transparent 60%, rgba(0, 0, 0, 0.55) 100%);
  animation: nx-flicker 6s steps(60) infinite;
}
@keyframes nx-flicker {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
}
""".replace("@T", T)


def particles() -> str:
    rnd = random.Random(2077)
    out = ["\n/* ---- cząsteczki: pozycje, wielkości i tempo (wygenerowane) ---- */"]
    for i in range(1, N_SPARK + 1):
        s = rnd.choice((2, 2, 3, 3, 4, 5))
        out.append(f"{T} .nx-sparks i:nth-child({i}) {{ left: {rnd.uniform(1, 99):.1f}%; width: {s}px; height: {s}px; "
                   f"--nx-dx: {rnd.uniform(-6, 8):.1f}vw; animation-duration: {rnd.uniform(11, 28):.1f}s; "
                   f"animation-delay: -{rnd.uniform(0, 28):.1f}s; }}")
    for i in range(1, N_DUST + 1):
        s = rnd.choice((2, 3, 3, 4, 6))
        out.append(f"{T} .nx-dust i:nth-child({i}) {{ left: {rnd.uniform(0, 100):.1f}%; top: {rnd.uniform(5, 95):.1f}%; "
                   f"width: {s}px; height: {s}px; --nx-dx: {rnd.uniform(-4, 4):.1f}vw; --nx-dy: {rnd.uniform(-6, 3):.1f}vh; "
                   f"animation-duration: {rnd.uniform(7, 16):.1f}s; animation-delay: -{rnd.uniform(0, 16):.1f}s; }}")
    for i in range(1, N_SHOOT + 1):
        out.append(f"{T} .nx-shoot i:nth-child({i}) {{ left: {rnd.uniform(40, 95):.0f}%; top: {rnd.uniform(2, 35):.0f}%; "
                   f"animation-duration: {rnd.uniform(9, 19):.1f}s; animation-delay: -{rnd.uniform(0, 19):.1f}s; }}")
    return "\n".join(out) + "\n"


def layers() -> str:
    return "\n".join([
        '<div class="nx-aura"></div>',
        '<div class="nx-stars"></div>',
        '<div class="nx-stars2 lv-med"></div>',
        '<div class="nx-grid lv-med"></div>',
        '<div class="nx-dust lv-med">' + "<i></i>" * N_DUST + "</div>",
        '<div class="nx-sparks lv-med">' + "<i></i>" * N_SPARK + "</div>",
        '<div class="nx-shoot lv-high">' + "<i></i>" * N_SHOOT + "</div>",
        '<div class="nx-crt lv-high"></div>',
        "",
    ])


if __name__ == "__main__":
    (OUT / "theme.css").write_text(BASE + particles(), encoding="utf-8")
    (OUT / "layers.html").write_text(layers(), encoding="utf-8")
    print("theme.css", (OUT / "theme.css").stat().st_size, "B; layers.html", (OUT / "layers.html").stat().st_size, "B")
