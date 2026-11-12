import { memo, useEffect, useState } from "react";
import { forgetArt, loadArt, readyArt } from "../lib/artCache";
import type { ArtKind, ArtLayout } from "@shared/types";
import { api, useStore } from "../store";
import { hueOf } from "../lib/format";

interface Props {
  gameId: string;
  name: string;
  kind: ArtKind;
  className?: string;
  /** what to render when there is no image */
  fallback?: "poster" | "hero" | "title" | "none";
  eager?: boolean;
  onState?: (ok: boolean) => void;
  /** the loaded image's width / height */
  onRatio?: (ratio: number) => void;
  /** "tv": the TV layout's own art (its choices; LaunchBox first for EmuStart games) */
  layout?: ArtLayout;
  /** small copy for lists */
  thumb?: boolean;
  /** with thumb: an animated image as it is (it moves), not its list copy (first frame) */
  anim?: boolean;
}

/**
 * Images already shown this session (src → shown whole over a blurred copy): the browser keeps
 * them, so they appear at once — no empty frame and no fade-in when the list changes back.
 */
const shown = new Map<string, boolean>();

/**
 * Obraz z pamięci obrazów (lib/artCache.ts): pobrany w całości i zdekodowany w tle, zanim trafi do <img> — wątek
 * interfejsu nie obrabia pliku kawałek po kawałku, a plakat widziany wcześniej wraca od razu.
 */
function useArtBlob(src: string): { blob?: string; failed: boolean; retry: () => boolean } {
  const [st, setSt] = useState<{ src: string; blob?: string; failed: boolean; retried: boolean }>(() => ({
    src,
    blob: readyArt(src),
    failed: false,
    retried: false,
  }));
  let cur = st;
  if (st.src !== src) {
    cur = { src, blob: readyArt(src), failed: false, retried: false };
    setSt(cur);
  }
  const [attempt, setAttempt] = useState(0);
  const missing = !cur.blob && !cur.failed;
  useEffect(() => {
    if (!missing) return;
    let alive = true;
    loadArt(src).then(
      (blob) => alive && setSt((p) => (p.src === src ? { ...p, blob, failed: false } : p)),
      () => alive && setSt((p) => (p.src === src ? { ...p, failed: true } : p)),
    );
    return () => {
      alive = false;
    };
  }, [src, attempt, missing]);
  return {
    blob: cur.blob,
    failed: cur.failed,
    // <img> nie wyświetlił obrazu z pamięci (np. wyrzuconego w międzyczasie): raz od nowa z serwera / dysku
    retry: () => {
      if (cur.retried) return false;
      forgetArt(src);
      setSt({ src, failed: false, retried: true });
      setAttempt((a) => a + 1);
      return true;
    },
  };
}

/** Image served by the main process (lumen-art://) with a tasteful generated placeholder. */
export const Art = memo(function Art({
  gameId,
  name,
  kind,
  className,
  fallback = "poster",
  eager,
  onState,
  onRatio,
  layout,
  thumb,
  anim,
}: Props) {
  const rev = useStore((s) => s.artRev[gameId] ?? 0);
  const wanted = api().art.url(gameId, kind, rev, layout, thumb, anim);
  // A new version of the same image (the player picked other art): the old one stays on screen until the
  // new one is downloaded and decoded — a large / animated file is not an empty frame for seconds.
  // Another game in this slot switches at once.
  const slot = `${gameId}|${kind}|${layout ?? ""}`;
  const [cur, setCur] = useState({ slot, src: wanted });
  let src = cur.src;
  if (cur.slot !== slot) {
    src = wanted;
    setCur({ slot, src: wanted });
  }
  useEffect(() => {
    if (cur.slot !== slot || cur.src === wanted) return;
    if (shown.has(wanted)) {
      setCur({ slot, src: wanted });
      return;
    }
    let alive = true;
    void loadArt(wanted)
      .catch(() => undefined)
      .finally(() => alive && setCur({ slot, src: wanted }));
    return () => {
      alive = false;
    };
  }, [wanted, slot, cur.slot, cur.src]);
  const [state, setState] = useState<"loading" | "ok" | "error">(() =>
    shown.has(src) ? "ok" : "loading",
  );
  // a poster image that is not 2:3 (box art from an emulator library: longbox, jewel case, cartridge
  // box) is shown whole over a blurred copy of itself instead of being cropped
  const [fit, setFit] = useState(() => shown.get(src) ?? false);
  const [seen, setSeen] = useState(src);
  if (seen !== src) {
    // a new image (art changed or another game in this slot): known ones at once
    setSeen(src);
    setState(shown.has(src) ? "ok" : "loading");
    setFit(shown.get(src) ?? false);
  }

  // an image known from earlier is "loaded" at once — tell the parent (no onLoad wait)
  useEffect(() => {
    if (shown.has(src)) onState?.(true);
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  const art = useArtBlob(src);
  // brak obrazu (404, błąd): jak dotąd błąd <img> — rodzic pokazuje zamiast niego np. nazwę
  useEffect(() => {
    if (!art.failed) return;
    shown.delete(src);
    onState?.(false);
  }, [art.failed, src]); // eslint-disable-line react-hooks/exhaustive-deps
  const hue = hueOf(name);
  if (state === "error" || art.failed) {
    if (fallback === "none") return null;
    if (fallback === "title")
      return <div className={`art-title ${className ?? ""}`}>{name}</div>;
    return (
      <div
        className={`art-placeholder art-placeholder--${fallback} ${className ?? ""}`}
        style={{ ["--h" as string]: hue }}
        aria-label={name}
      >
        {fallback === "poster" && <span>{name}</span>}
      </div>
    );
  }
  return (
    <>
      {fit && (
        <img decoding="async"
          className="art-fit__bg"
          src={art.blob}
          alt=""
          aria-hidden
          draggable={false}
        />
      )}
      <img
        key={src}
        className={`art art--${kind} ${state === "ok" ? "is-loaded" : ""} ${fit ? "art--fit" : ""} ${className ?? ""}`}
        src={art.blob}
        alt=""
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        style={state === "loading" ? { ["--h" as string]: hue } : undefined}
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          if (w && h) onRatio?.(w / h);
          const f = kind === "grid" && !!w && !!h && Math.abs(w / h - 2 / 3) > 0.06;
          setFit(f);
          shown.set(src, f);
          if (shown.size > 5000) shown.delete(shown.keys().next().value!);
          setState("ok");
          onState?.(true);
        }}
        onError={() => {
          if (art.retry()) return;
          shown.delete(src);
          setState("error");
          onState?.(false);
        }}
      />
    </>
  );
});
