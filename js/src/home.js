// Homepage: 3D hero globe with live earthquakes + 3D tilt on project cards.
import { createGlobe, themeFromCSS, onThemeChange, webglAvailable } from "./globe.js";
import { getQuakes, quakeColor, quakeHeight, timeAgo, esc, nf1 } from "./feeds.js";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;

/* ---------- hero globe ---------- */
const host = document.getElementById("heroGlobe");
const badge = document.getElementById("liveBadge");

if (host && webglAvailable()) {
  let globe;
  try {
    globe = createGlobe(host, {
      dots: 42000,
      interactive: finePointer,
      zoom: false,
      autoRotate: true,
      autoRotateSpeed: 0.7,
      fit: 1.02,
      view: { lat: 0, lon: 112 },
      tooltip: q => `
        <b>M${nf1.format(q.mag)}</b> · ${esc(q.place)}<br>
        <span>${timeAgo(q.time)} · kedalaman ${Math.round(q.depth)} km</span>`,
    });
  } catch (err) {
    console.warn("Globe tidak dapat dibuat:", err);
  }
  if (globe) {
    host.classList.add("ready");
    const applyTheme = () => globe.setTheme(themeFromCSS());
    applyTheme();
    onThemeChange(applyTheme);

    const seen = new Set();
    let first = true;
    async function load() {
      try {
        const qs = await getQuakes();
        globe.setBars("quakes", qs.map(q => ({
          lat: q.lat, lon: q.lon, height: quakeHeight(q.mag), width: 0.0045 + q.mag * 0.0007,
          color: quakeColor(q.mag), data: q,
        })));
        const fresh = first ? [...qs].sort((a, b) => b.mag - a.mag).slice(0, 3) : qs.filter(q => !seen.has(q.id));
        fresh.forEach((q, i) => setTimeout(() => globe.pulse(q.lat, q.lon, {
          color: quakeColor(q.mag), size: 0.05 + q.mag * 0.012, repeat: first ? 2 : 3,
        }), i * 500));
        qs.forEach(q => seen.add(q.id));
        first = false;
        const max = qs.reduce((m, q) => Math.max(m, q.mag), 0);
        badge.innerHTML = `<span class="live-dot"></span><b>LIVE</b> ${qs.length} gempa M2.5+ dalam 24 jam · terbesar M${nf1.format(max)}`;
        badge.hidden = false;
      } catch (err) {
        badge.innerHTML = `<span class="live-dot off"></span>Data gempa sedang tidak tersedia`;
        badge.hidden = false;
      }
    }
    load();
    setInterval(() => { if (!document.hidden) load(); }, 120000);
  }
} else if (host) {
  host.classList.add("no-webgl");
}

/* ---------- 3D tilt for project cards ---------- */
if (finePointer && !reduceMotion) {
  const grid = document.getElementById("grid");
  let active = null, raf = 0, ev = null;
  const reset = card => { card.style.transform = ""; card.style.removeProperty("--gx"); card.style.removeProperty("--gy"); };
  grid?.addEventListener("pointermove", e => {
    const card = e.target.closest(".card");
    if (active && active !== card) reset(active);
    active = card;
    ev = e;
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      if (!active || !ev) return;
      const r = active.getBoundingClientRect();
      const px = (ev.clientX - r.left) / r.width, py = (ev.clientY - r.top) / r.height;
      active.style.transform = `perspective(900px) rotateX(${(0.5 - py) * 9}deg) rotateY(${(px - 0.5) * 11}deg) translateZ(6px)`;
      active.style.setProperty("--gx", `${px * 100}%`);
      active.style.setProperty("--gy", `${py * 100}%`);
    });
  });
  grid?.addEventListener("pointerleave", () => { if (active) reset(active); active = null; });
}
