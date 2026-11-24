import { Fragment, useEffect } from "react";
import "../motion.css";

/**
 * Motion (design handoff motion.md). Everything here is progressive: with JavaScript off, with
 * prefers-reduced-motion, or before this runs, the page is static and fully visible. Start states are scoped to the
 * classes set below on <html>:
 *   motion  animations allowed (no reduced-motion preference)
 *   sda     CSS scroll-driven animations (animation-timeline: view()) drive the scroll effects
 *   io      fallback: an IntersectionObserver adds .is-in to elements as they enter the viewport (Safari, Firefox)
 */
export function initMotion() {
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Same gate as the pre-paint script in each page: no entrance animations for automated or headless browsers.
  if (reduce || !root.classList.contains("anim")) {
    root.classList.add("reduced");
    return;
  }
  const sda = typeof CSS !== "undefined" && CSS.supports?.("animation-timeline: view()");
  root.classList.add("motion", sda ? "sda" : "io");
  observeAll();
  // Content rendered later (data arriving) is observed too.
  new MutationObserver(() => observeAll()).observe(document.body, { childList: true, subtree: true });
  if (!sda) startParallaxFallback();
}

/** Elements revealed on entry: universal (word-by-word headings, counters, replay) or io-only (everything else). */
const ALWAYS = ".words-scroll, .count, [data-replay]";
const IO_ONLY = ".rv, .scale-in, .fan, .draw, .expand, .table-box, .gasbar, .section";
let io: IntersectionObserver | null = null;
const seen = new WeakSet<Element>();

function observeAll() {
  const root = document.documentElement;
  io ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-in");
        if (e.target.classList.contains("count")) countUp(e.target as HTMLElement);
        if (!(e.target as HTMLElement).dataset.replay) io!.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
  );
  const selector = root.classList.contains("io") ? `${ALWAYS}, ${IO_ONLY}` : ALWAYS;
  document.querySelectorAll(selector).forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);
    io!.observe(el);
  });
}

/** Counts from 0 to the element's data-to over ~1s (the final value is already in the markup). */
function countUp(el: HTMLElement) {
  if (el.dataset.counted) return;
  el.dataset.counted = "1";
  const to = Number(el.dataset.to ?? el.textContent ?? 0);
  if (!Number.isFinite(to) || to <= 0) return;
  const t0 = performance.now();
  const dur = 1100;
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(to * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  el.textContent = "0";
  requestAnimationFrame(step);
}

/** Parallax for the hero chips where scroll timelines are not supported. */
function startParallaxFallback() {
  let ticking = false;
  const apply = () => {
    ticking = false;
    const y = Math.min(220, window.scrollY * 0.35);
    document.querySelectorAll<HTMLElement>(".para").forEach((el) => (el.style.transform = `translateY(${-y}px)`));
  };
  addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(apply);
      }
    },
    { passive: true },
  );
}

/** A heading split into words, revealed one by one (on load for the hero, on scroll elsewhere). */
export function Words({ text, onLoad = false, start = 0 }: { text: string; onLoad?: boolean; start?: number }) {
  const words = text.split(" ");
  return (
    <span className={onLoad ? "words words-load" : "words words-scroll"}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="w" style={{ ["--d" as string]: `${start + i * 80}ms` }}>
            {w}
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}

/** A number that counts up when it scrolls into view (the final value is always in the markup). */
export function Count({ to }: { to: number }) {
  return (
    <span className="count" data-to={to}>
      {to}
    </span>
  );
}

/** Landing page: cursor spotlight with an idle glide, and the proof panel's decision replay. */
export function useLandingMotion() {
  useEffect(() => {
    if (!document.documentElement.classList.contains("motion")) return;
    const stopSpot = spotlight();
    const stopReplay = replay();
    return () => {
      stopSpot();
      stopReplay();
    };
  }, []);
}

function spotlight() {
  const hero = document.querySelector<HTMLElement>("[data-spotlight]");
  const layer = hero?.querySelector<HTMLElement>(".spot-layer");
  if (!hero || !layer) return () => {};
  let mx = 0;
  let my = 0;
  let pointer = false;
  let lastMove = 0;
  let raf = 0;
  const touch = matchMedia("(hover: none)").matches;
  const set = (x: number, y: number, r: number) => {
    layer.style.setProperty("--mx", `${x}px`);
    layer.style.setProperty("--my", `${y}px`);
    layer.style.setProperty("--r", `${r}px`);
  };
  const onMove = (e: PointerEvent) => {
    const b = hero.getBoundingClientRect();
    mx = e.clientX - b.left;
    my = e.clientY - b.top;
    pointer = true;
    lastMove = performance.now();
    layer.classList.add("hover");
    set(mx, my, 230);
  };
  const onLeave = () => {
    pointer = false;
    lastMove = performance.now();
    layer.classList.remove("hover");
  };
  hero.addEventListener("pointermove", onMove);
  hero.addEventListener("pointerleave", onLeave);
  layer.classList.add("spot-on");
  // Idle: park right of centre, then every ~8s glide along a loop and come back (always, on touch devices).
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    if (pointer && now - lastMove < 4000) return;
    if (pointer) {
      pointer = false;
      layer.classList.remove("hover");
    }
    const b = hero.getBoundingClientRect();
    const parkX = b.width * 0.68;
    const parkY = b.height * 0.42;
    const cycle = 8000;
    const t = (now % cycle) / cycle;
    const glide = touch ? 1 : t < 0.55 ? Math.sin((t / 0.55) * Math.PI) : 0; // 0 = parked, 1 = furthest out
    const a = now / 2600;
    const x = parkX + glide * Math.cos(a) * b.width * 0.26;
    const y = parkY + glide * Math.sin(a * 1.3) * b.height * 0.22;
    set(x, y, 170);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    hero.removeEventListener("pointermove", onMove);
    hero.removeEventListener("pointerleave", onLeave);
  };
}

/** Proof panel: while in view, every ~6s the DENIED chip flashes in, then ALLOWED. */
function replay() {
  const panel = document.querySelector<HTMLElement>("[data-replay]");
  if (!panel) return () => {};
  let visible = false;
  const vis = new IntersectionObserver((es) => (visible = es.some((e) => e.isIntersecting)), { threshold: 0.3 });
  vis.observe(panel);
  const timers: number[] = [];
  const run = () => {
    if (!visible) return;
    const chips = panel.querySelectorAll<HTMLElement>(".replay-chip");
    chips.forEach((c, i) => {
      timers.push(
        window.setTimeout(() => {
          c.classList.remove("flash");
          void c.offsetWidth; // restart the animation
          c.classList.add("flash");
        }, i * 900),
      );
    });
  };
  const iv = window.setInterval(run, 6000);
  timers.push(window.setTimeout(run, 1200));
  return () => {
    clearInterval(iv);
    timers.forEach(clearTimeout);
    vis.disconnect();
  };
}
