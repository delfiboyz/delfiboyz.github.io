// Live OSINT dashboard: a 3D globe fed by public, key-less, CORS-enabled data sources.
import { createGlobe, themeFromCSS, onThemeChange, webglAvailable, kmToAlt, isLand } from "./globe.js";
import * as F from "./feeds.js";
import { CENTROIDS } from "./geo-data.js";

const { esc, nf, nf1, timeAgo } = F;
const $ = id => document.getElementById(id);
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const mobile = matchMedia("(max-width: 960px)").matches;
const GH_USER = "delfiboyz";

/* ---------- state ---------- */
const S = {
  quakes: [], eonet: [], iss: null, issPath: [], tor: null, kp: null, adv: [], kev: null, gh: [], me: null,
  newQuakes: new Set(), feedFilter: "all", feedLimit: 40,
};

/* ---------- sources & status ---------- */
const SOURCES = [
  { id: "quakes", name: "USGS — gempa M2.5+ (24 jam)", url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php", every: 60e3 },
  { id: "eonet", name: "NASA EONET — peristiwa alam", url: "https://eonet.gsfc.nasa.gov/", every: 10 * 60e3 },
  { id: "iss", name: "Where the ISS at? — posisi ISS", url: "https://wheretheiss.at/", every: 5e3 },
  { id: "tor", name: "Tor Project Onionoo — relay exit", url: "https://metrics.torproject.org/onionoo.html", every: 30 * 60e3 },
  { id: "kp", name: "NOAA SWPC — indeks Kp", url: "https://www.swpc.noaa.gov/products/planetary-k-index", every: 5 * 60e3 },
  { id: "adv", name: "GitHub Advisory Database", url: "https://github.com/advisories", every: 15 * 60e3 },
  { id: "kev", name: "CISA KEV (cisagov/kev-data)", url: "https://github.com/cisagov/kev-data", every: 60 * 60e3 },
  { id: "gh", name: `GitHub — aktivitas publik ${GH_USER}`, url: `https://github.com/${GH_USER}`, every: 15 * 60e3 },
];
const status = Object.fromEntries(SOURCES.map(s => [s.id, { state: "loading", at: 0 }]));
function setStatus(id, state, err) {
  status[id] = { state, at: state === "live" ? Date.now() : status[id].at, err };
  renderLayers();
  renderSourceRow(id);
  if (state === "error") {
    renderKpis();
    ({ adv: renderAdvisories, kev: renderKEV, tor: renderTorTop })[id]?.();
  }
}

/* ---------- globe ---------- */
let globe = null;
if (webglAvailable()) {
  try {
    globe = createGlobe($("globe"), {
      dots: mobile ? 50000 : 75000,
      interactive: true, zoom: true, autoRotate: true, autoRotateSpeed: 0.35,
      fit: mobile ? 1.0 : 0.9, view: { lat: 2, lon: 112 }, cityLights: false,
      tooltip: tipHTML, onSelect: d => { if (d.lat != null) focus(d.lat, d.lon, d.color); },
    });
  } catch (err) {
    console.warn(err);
  }
}
if (!globe) $("globe").innerHTML = `<div class="nogl">WebGL tidak tersedia di browser ini, jadi globe 3D tidak bisa ditampilkan.<br>Data live tetap tersedia di panel samping.</div>`;

function applyTheme() {
  if (!globe) return;
  globe.setTheme(themeFromCSS());
  drawISS(); drawTor(); drawAurora(); drawMe();
}
function focus(lat, lon, color) {
  if (!globe) return;
  globe.flyTo(lat, lon);
  globe.pulse(lat, lon, { color: color || cssVar("--accent"), size: 0.12, repeat: 2 });
}

function tipHTML(d) {
  const k = (label, c) => `<div class="k" style="--c:${c}">${esc(label)}</div>`;
  switch (d.kind) {
    case "quake":
      return `${k(`Gempa · M${nf1.format(d.mag)}`, F.quakeColor(d.mag))}<b>${esc(d.place)}</b><br>
        <span>${timeAgo(d.time)} · kedalaman ${Math.round(d.depth)} km${d.tsunami ? " · ⚠ potensi tsunami" : ""}</span>`;
    case "eonet":
      return `${k(`${d.icon} ${d.catLabel}`, d.color)}<b>${esc(d.title)}</b><br>
        <span>${F.fmtDay(d.date)}${d.mag ? " · " + esc(d.mag) : ""}</span>`;
    case "iss":
      return `${k("Stasiun Luar Angkasa Internasional", cssVar("--c-iss"))}<b>${nf.format(Math.round(d.altKm))} km · ${nf.format(Math.round(d.velKmh))} km/j</b><br>
        <span>${d.lat.toFixed(2)}°, ${d.lon.toFixed(2)}° · ${d.visibility === "daylight" ? "terkena matahari" : "dalam bayangan Bumi"}</span>`;
    case "tor":
      return `${k("Relay exit Tor", cssVar("--c-tor"))}<b>${F.flag(d.cc)} ${esc(F.countryName(d.cc))}</b><br>
        <span>${nf.format(d.count)} relay · ${nf1.format(d.bw / 1e6)} MB/s teramati</span>`;
    case "me":
      return `${k("Anda (perkiraan dari IP)", cssVar("--c-you"))}<b>${esc([d.city, d.country].filter(Boolean).join(", "))}</b><br>
        <span>${esc(d.isp || "")}</span>`;
    default: return "";
  }
}

/* ---------- layers (toggle chips) ---------- */
const LAYERS = [
  { id: "quakes", label: "Gempa", c: () => "#f06a2a", ids: ["quakes"], n: () => S.quakes.length },
  { id: "eonet", label: "Peristiwa alam", c: () => "conic-gradient(#ff8a3d 0 25%, #8a7cff 0 50%, #3cc6e6 0 75%, #e8304d 0)", ids: ["eonet"], n: () => S.eonet.length },
  { id: "iss", label: "ISS", c: () => cssVar("--c-iss"), ids: ["iss", "iss-past", "iss-future"], n: () => S.iss ? `${Math.round(S.iss.altKm)} km` : "" },
  { id: "tor", label: "Exit Tor", c: () => cssVar("--c-tor"), ids: ["tor"], n: () => S.tor ? S.tor.total : "" },
  { id: "aurora", label: "Oval aurora", c: () => cssVar("--c-aurora"), ids: ["aurora-n", "aurora-s"], src: "kp", n: () => S.kp ? `Kp ${nf1.format(S.kp.kp)}` : "" },
  { id: "me", label: "Anda", c: () => cssVar("--c-you"), ids: ["me"], src: null, n: () => "", hidden: () => !S.me },
];
const layerOn = Object.fromEntries(LAYERS.map(l => [l.id, true]));
try {
  const saved = JSON.parse(localStorage.getItem("osint-layers") || "{}");
  for (const k in saved) if (k in layerOn) layerOn[k] = !!saved[k];
} catch (_) { /* private mode */ }
function applyLayerVisibility() {
  if (!globe) return;
  for (const l of LAYERS) for (const id of l.ids) globe.setVisible(id, layerOn[l.id]);
}
function renderLayers() {
  $("layers").innerHTML = LAYERS.filter(l => !(l.hidden && l.hidden())).map(l => {
    const st = l.src === null ? "live" : status[l.src || l.id]?.state;
    const n = l.n();
    return `<button class="layer" data-l="${l.id}" aria-pressed="${layerOn[l.id]}" style="--c:${l.c()}">
      <span class="sw"></span>${esc(l.label)}${n !== "" ? ` <span class="n">${esc(typeof n === "number" ? nf.format(n) : n)}</span>` : ""}
      <span class="st ${st}" title="${st === "live" ? "live" : st === "error" ? "gagal memuat" : "memuat"}"></span></button>`;
  }).join("");
}
$("layers").addEventListener("click", e => {
  const b = e.target.closest(".layer");
  if (!b) return;
  layerOn[b.dataset.l] = !layerOn[b.dataset.l];
  try { localStorage.setItem("osint-layers", JSON.stringify(layerOn)); } catch (_) { /* ignore */ }
  applyLayerVisibility();
  renderLayers();
});

/* ---------- drawing ---------- */
function drawQuakes() {
  globe?.setBars("quakes", S.quakes.map(q => ({
    lat: q.lat, lon: q.lon, height: F.quakeHeight(q.mag), width: 0.004 + q.mag * 0.0008,
    color: F.quakeColor(q.mag), data: { kind: "quake", ...q, color: F.quakeColor(q.mag) },
  })));
}
function drawEonet() {
  globe?.setPoints("eonet", S.eonet.map(e => ({
    lat: e.lat, lon: e.lon, color: e.color, size: e.cat === "wildfires" ? 0.75 : 1.15, data: { kind: "eonet", ...e },
  })));
}
function drawISS(tween = 0) {
  if (!globe || !S.iss) return;
  const c = cssVar("--c-iss");
  globe.setObject("iss", {
    lat: S.iss.lat, lon: S.iss.lon, alt: kmToAlt(S.iss.altKm), color: c, label: "ISS", tween, layer: "iss",
    data: { kind: "iss", ...S.iss, color: c },
  });
  if (S.issPath.length) {
    const now = Date.now();
    const here = { lat: S.iss.lat, lon: S.iss.lon, alt: kmToAlt(S.iss.altKm) };
    const pts = S.issPath.map(p => ({ lat: p.lat, lon: p.lon, alt: kmToAlt(p.altKm), ts: p.ts }));
    globe.setPath("iss-past", [...pts.filter(p => p.ts < now), here], { color: c, opacity: 0.75 });
    globe.setPath("iss-future", [here, ...pts.filter(p => p.ts > now)], { color: c, opacity: 0.45, dashed: true });
  }
  applyLayerVisibility();
}
function drawTor() {
  if (!globe || !S.tor) return;
  const c = cssVar("--c-tor");
  globe.setBars("tor", S.tor.countries.filter(t => CENTROIDS[t.cc]).map(t => ({
    lat: CENTROIDS[t.cc][0], lon: CENTROIDS[t.cc][1], height: 0.008 + Math.sqrt(t.count) * 0.011, width: 0.009,
    color: c, data: { kind: "tor", ...t, lat: CENTROIDS[t.cc][0], lon: CENTROIDS[t.cc][1], color: c },
  })));
  applyLayerVisibility();
}
// Rough auroral oval from Kp around the geomagnetic dipole poles (IGRF-14, 2025).
function drawAurora() {
  if (!globe || !S.kp) return;
  const kp = S.kp.kp;
  const boundary = 67 - 2.2 * kp; // equatorward edge, magnetic latitude
  const radius = 90 - (boundary + 4);
  const opts = { radiusDeg: radius, widthDeg: 3 + kp * 0.6, color: cssVar("--c-aurora"), opacity: 0.22 + kp * 0.05 };
  globe.setBand("aurora-n", { lat: 80.8, lon: -72.6, ...opts });
  globe.setBand("aurora-s", { lat: -80.8, lon: 107.4, ...opts });
  applyLayerVisibility();
}
function drawMe() {
  if (!globe || !S.me) return;
  const c = cssVar("--c-you");
  globe.setPoints("me", [{ lat: S.me.lat, lon: S.me.lon, color: c, size: 1.5, data: { kind: "me", ...S.me, color: c } }]);
  globe.stopPulse("me");
  globe.pulse(S.me.lat, S.me.lon, { color: c, size: 0.1, duration: 2400, repeat: Infinity, id: "me", layer: "me" });
  applyLayerVisibility();
}

/* ---------- KPIs ---------- */
function renderKpis() {
  const tile = (label, c, value, sub, st) =>
    `<div class="kpi"><div class="lb"><i style="--c:${c}"></i>${esc(label)}</div><b>${value}</b><small>${sub}</small></div>`;
  const dash = id => status[id].state === "error" ? "<span style=\"color:var(--bad)\">gagal</span>" : "—";
  const q = S.quakes, big = q.reduce((m, x) => (!m || x.mag > m.mag ? x : m), null);
  const cats = S.eonet.reduce((m, e) => (m[e.cat] = (m[e.cat] || 0) + 1, m), {});
  const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([k, n]) => `${n} ${(F.EONET_CATS[k]?.label || k).toLowerCase()}`).join(" · ");
  const iss = S.iss;
  $("kpis").innerHTML = [
    tile("Gempa 24 jam", "#f06a2a", q.length ? nf.format(q.length) : dash("quakes"),
      big ? `terbesar M${nf1.format(big.mag)} · ${esc(big.place)}` : "magnitudo ≥ 2,5"),
    tile("Peristiwa alam", "#ff8a3d", S.eonet.length ? nf.format(S.eonet.length) : dash("eonet"), topCats || "aktif, 30 hari terakhir"),
    tile("ISS", cssVar("--c-iss"), iss ? `${nf.format(Math.round(iss.altKm))} km` : dash("iss"),
      iss ? `${nf.format(Math.round(iss.velKmh))} km/j · di atas ${isLand(iss.lat, iss.lon) ? "daratan" : "lautan"}` : "ketinggian orbit"),
    tile("Relay exit Tor", cssVar("--c-tor"), S.tor ? nf.format(S.tor.total) : dash("tor"),
      S.tor ? `${S.tor.countries.length} negara · ${nf1.format(S.tor.bw * 8 / 1e9)} Gbit/s` : "sedang berjalan"),
    tile("Indeks Kp", cssVar("--c-aurora"), S.kp ? nf1.format(S.kp.kp) : dash("kp"), S.kp ? S.kp.label : "aktivitas geomagnetik"),
    tile("CVE dieksploitasi", "var(--bad)", S.kev ? `+${nf.format(S.kev.recent30)}` : dash("kev"),
      S.kev ? `30 hari · ${nf.format(S.kev.total)} total di KEV` : "katalog CISA KEV"),
  ].join("");
}

/* ---------- timeline ---------- */
const FILTERS = [["all", "Semua"], ["quake", "Gempa"], ["eonet", "Alam"], ["gh", "GitHub"]];
function feedItems() {
  const items = [];
  for (const q of S.quakes) items.push({
    kind: "quake", time: q.time, ico: `M${nf1.format(q.mag)}`, c: F.quakeColor(q.mag), title: q.place, url: q.url,
    meta: `kedalaman ${Math.round(q.depth)} km${q.tsunami ? " · ⚠ tsunami" : ""}`, lat: q.lat, lon: q.lon, isNew: S.newQuakes.has(q.id),
  });
  for (const e of S.eonet.slice(0, 80)) items.push({
    kind: "eonet", time: new Date(e.date).getTime(), ico: e.icon, c: e.color, title: e.title, url: e.url,
    meta: e.catLabel + (e.mag ? ` · ${e.mag}` : ""), lat: e.lat, lon: e.lon,
  });
  for (const g of S.gh) items.push({
    kind: "gh", time: new Date(g.time).getTime(), ico: "GIT", c: cssVar("--accent-2"), title: `${g.text} · ${g.repo.split("/")[1]}`,
    url: g.url, meta: `github.com/${g.repo}`,
  });
  return items.sort((a, b) => b.time - a.time);
}
function renderFeed() {
  const all = feedItems();
  const count = k => k === "all" ? all.length : all.filter(i => i.kind === k).length;
  $("feedFilters").innerHTML = FILTERS.map(([k, l]) =>
    `<button class="fchip" data-f="${k}" aria-pressed="${S.feedFilter === k}">${l} <span>${count(k)}</span></button>`).join("");
  const filtered = all.filter(i => S.feedFilter === "all" || i.kind === S.feedFilter);
  const list = filtered.slice(0, S.feedLimit);
  $("feed").innerHTML = list.length ? list.map((i, n) => `
    <li class="ev${i.lat != null ? " geo" : ""}" ${i.lat != null ? `tabindex="0" data-lat="${i.lat}" data-lon="${i.lon}" data-c="${i.c}"` : ""} style="--c:${i.c}">
      <span class="ico">${esc(i.ico)}</span>
      <div><div class="t">${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>` : esc(i.title)}${i.isNew ? '<span class="new">BARU</span>' : ""}</div>
      <small>${esc(i.meta)} · ${timeAgo(i.time)}</small></div>
    </li>`).join("") + (filtered.length > list.length
      ? `<li><button class="btn ghost more" id="feedMore">Tampilkan lebih banyak (${nf.format(filtered.length - list.length)} lagi)</button></li>` : "")
    : `<li class="empty">${Object.values(status).every(s => s.state === "loading") ? "Memuat data live…" : "Belum ada data untuk filter ini."}</li>`;
}
$("feedFilters").addEventListener("click", e => {
  const b = e.target.closest(".fchip");
  if (!b) return;
  S.feedFilter = b.dataset.f;
  S.feedLimit = 40;
  renderFeed();
});
function onGeoItem(e) {
  if (e.target.id === "feedMore") {
    if (e.type === "click") { S.feedLimit += 40; renderFeed(); }
    return;
  }
  if (e.target.closest("a")) return;
  const li = e.target.closest("[data-lat]");
  if (!li) return;
  if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  focus(+li.dataset.lat, +li.dataset.lon, li.dataset.c);
  if (mobile) document.querySelector(".stage").scrollIntoView({ behavior: "smooth", block: "start" });
}
for (const id of ["feed", "torTop"]) {
  $(id).addEventListener("click", onGeoItem);
  $(id).addEventListener("keydown", onGeoItem);
}

/* ---------- cyber panel ---------- */
const SEV = { critical: ["KRIT", "--sev-critical"], high: ["TINGGI", "--sev-high"], medium: ["SEDANG", "--sev-moderate"], moderate: ["SEDANG", "--sev-moderate"], low: ["RENDAH", "--sev-low"] };
function renderAdvisories() {
  $("advisories").innerHTML = S.adv.length ? S.adv.map(a => {
    const [lbl, v] = SEV[a.severity] || ["?", "--sev-low"];
    return `<li class="ev" style="--c:var(${v})"><span class="ico">${lbl}</span><div>
      <div class="t"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.summary)}</a></div>
      <small>${esc(a.cve || a.id)}${a.cvss ? ` · CVSS ${nf1.format(a.cvss)}` : ""}${a.pkgs[0] ? ` · ${esc(a.pkgs[0])}` : ""} · ${timeAgo(a.published)}</small></div></li>`;
  }).join("") : `<li class="empty">${status.adv.state === "error" ? "Gagal memuat (batas API GitHub mungkin tercapai — coba lagi nanti)." : "Memuat…"}</li>`;
}
function renderKEV() {
  const k = S.kev;
  if (!k) {
    $("kevStats").innerHTML = "";
    $("kev").innerHTML = `<li class="empty">${status.kev.state === "error" ? "Gagal memuat katalog KEV." : "Memuat…"}</li>`;
    return;
  }
  $("kevStats").innerHTML = `
    <div><b>${nf.format(k.total)}</b><span>total CVE</span></div>
    <div><b>+${nf.format(k.recent30)}</b><span>30 hari terakhir</span></div>
    <div><b>${nf.format(k.ransomware)}</b><span>dipakai ransomware</span></div>`;
  $("kev").innerHTML = k.latest.map(x => `
    <li class="ev" style="--c:var(--bad)"><span class="ico">KEV</span><div>
      <div class="t"><a href="https://nvd.nist.gov/vuln/detail/${encodeURIComponent(x.cve)}" target="_blank" rel="noopener">${esc(x.cve)}</a> — ${esc(x.vendor)} ${esc(x.product)}</div>
      <small>${esc(x.name)}</small>
      <span class="pill">ditambahkan ${F.fmtDay(x.added)}</span><span class="pill">tenggat ${F.fmtDay(x.due)}</span>${x.ransomware ? '<span class="pill rw">ransomware</span>' : ""}
    </div></li>`).join("");
}
function renderTorTop() {
  if (!S.tor) {
    $("torTop").innerHTML = `<li class="empty">${status.tor.state === "error" ? "Gagal memuat data Tor." : "Memuat…"}</li>`;
    return;
  }
  const top = S.tor.countries.slice(0, 10), max = top[0]?.count || 1;
  $("torTop").innerHTML = top.map(t => {
    const c = CENTROIDS[t.cc];
    return `<li ${c ? `tabindex="0" data-lat="${c[0]}" data-lon="${c[1]}" data-c="${cssVar("--c-tor")}"` : ""}>
      <span class="nm">${F.flag(t.cc)} ${esc(F.countryName(t.cc))}</span><span class="v">${nf.format(t.count)}</span>
      <span class="track"><i style="width:${(t.count / max * 100).toFixed(1)}%"></i></span></li>`;
  }).join("");
}

/* ---------- "your footprint" panel ---------- */
$("fp").innerHTML = F.localFingerprint().map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
$("ipBtn").addEventListener("click", async () => {
  const btn = $("ipBtn");
  btn.disabled = true;
  btn.textContent = "Memeriksa…";
  try {
    const me = await F.getMyIP();
    S.me = me;
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const rows = [
      ["IP", `${me.ip}${me.type ? ` (${me.type})` : ""}`],
      ["ISP", me.isp || "—"],
      ["ASN", me.asn ? `AS${me.asn}${me.org && me.org !== me.isp ? ` · ${me.org}` : ""}` : "—"],
      ["Lokasi", [me.city, me.region, me.country].filter(Boolean).join(", ") + (me.cc ? ` ${F.flag(me.cc)}` : "")],
      ["Koordinat", me.lat != null ? `${(+me.lat).toFixed(2)}, ${(+me.lon).toFixed(2)} (perkiraan)` : "—"],
      ["Zona waktu IP", me.tz || "—"],
      ["Sumber", me.source],
    ];
    const tzOk = me.tz && me.tz === browserTz;
    $("ipOut").innerHTML = `<dl class="kv" style="margin-top:12px">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <div class="verdict ${tzOk ? "ok" : "warn"}">${tzOk
        ? "✓ Zona waktu browser cocok dengan lokasi IP. Situs mana pun bisa melihat perkiraan lokasi ini dari IP Anda."
        : `⚠ Zona waktu browser (<b>${esc(browserTz)}</b>) berbeda dengan zona waktu IP (<b>${esc(me.tz || "?")}</b>). Ini tanda umum penggunaan VPN, proxy, atau Tor — atau geolokasi IP yang kurang akurat.`}</div>
      <div class="verdict" id="torCheck">Memeriksa apakah IP ini relay Tor…</div>`;
    btn.textContent = "Periksa ulang";
    renderLayers();
    if (me.lat != null) { drawMe(); focus(+me.lat, +me.lon, cssVar("--c-you")); }
    // Is this IP a Tor relay? (the request comes from the same IP, so nothing new is revealed)
    try {
      const j = await F.fetchJSON(`https://onionoo.torproject.org/summary?search=${encodeURIComponent(me.ip)}`, { timeout: 15000 });
      const hit = j.relays?.length;
      $("torCheck").innerHTML = hit
        ? `🧅 IP ini terdaftar sebagai <b>relay Tor</b> (${esc(j.relays[0].n)}). Anda kemungkinan sedang memakai Tor.`
        : "IP ini bukan relay Tor yang dikenal.";
    } catch (_) { $("torCheck").remove(); }
  } catch (err) {
    $("ipOut").innerHTML = `<div class="verdict warn">Gagal menghubungi layanan IP (${esc(err.message)}). Pemblokir iklan/pelacak sering memblokir layanan ini.</div>`;
    btn.textContent = "Coba lagi";
  } finally {
    btn.disabled = false;
  }
});

/* ---------- tabs ---------- */
const tabs = [...document.querySelectorAll(".tab")];
tabs.forEach(t => t.addEventListener("click", () => {
  tabs.forEach(x => {
    const on = x === t;
    x.setAttribute("aria-selected", on);
    $(x.getAttribute("aria-controls")).hidden = !on;
  });
}));

/* ---------- toast ---------- */
let toastTimer = 0;
function toast(html, color, onClick) {
  const el = $("toast");
  el.innerHTML = html;
  el.style.setProperty("--c", color);
  el.onclick = () => { onClick?.(); el.classList.remove("show"); };
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 7000);
}

/* ---------- sources list + clock ---------- */
$("sources").innerHTML = SOURCES.map(s => `
  <li id="src-${s.id}"><span class="st"></span><a href="${s.url}" target="_blank" rel="noopener">${esc(s.name)}</a><span class="when"></span></li>`).join("");
function renderSourceRow(id) {
  const li = $(`src-${id}`);
  if (!li) return;
  const st = status[id];
  li.querySelector(".st").className = `st ${st.state}`;
  li.querySelector(".when").textContent = st.state === "error" && !st.at ? "gagal" : st.at ? timeAgo(st.at) : "memuat…";
  li.title = st.err ? String(st.err.message || st.err) : "";
}
function tick() {
  const d = new Date();
  $("clock").innerHTML = `<span class="lbl">UTC </span>${d.toISOString().slice(11, 19)}`;
  SOURCES.forEach(s => renderSourceRow(s.id));
}
setInterval(tick, 1000);
tick();

/* ---------- polling ---------- */
function poll(id, fn, every, delay = 0) {
  let timer = 0, fails = 0;
  const run = async () => {
    clearTimeout(timer);
    if (document.hidden) { timer = setTimeout(run, 2000); return; }
    try {
      await fn();
      fails = 0;
      setStatus(id, "live");
    } catch (err) {
      fails++;
      console.warn(`[${id}]`, err);
      setStatus(id, "error", err);
    }
    // back off on repeated failures (max 10 min) so a dead source is not hammered
    timer = setTimeout(run, fails ? Math.min(Math.max(every, 15e3) * 2 ** (fails - 1), 10 * 60e3) : every);
  };
  timer = setTimeout(run, delay);
}

let firstQuakes = true;
poll("quakes", async () => {
  const qs = await F.getQuakes();
  if (!firstQuakes) {
    const known = new Set(S.quakes.map(q => q.id));
    const fresh = qs.filter(q => !known.has(q.id));
    fresh.forEach(q => S.newQuakes.add(q.id));
    fresh.forEach((q, i) => setTimeout(() => globe?.pulse(q.lat, q.lon, { color: F.quakeColor(q.mag), size: 0.06 + q.mag * 0.014, repeat: 4, layer: "quakes" }), i * 400));
    const top = fresh.sort((a, b) => b.mag - a.mag)[0];
    if (top) toast(`<span class="live-dot"></span><span>Gempa baru <b>M${nf1.format(top.mag)}</b> · ${esc(top.place)}</span>`,
      F.quakeColor(top.mag), () => focus(top.lat, top.lon, F.quakeColor(top.mag)));
  } else {
    [...qs].sort((a, b) => b.mag - a.mag).slice(0, 4).forEach((q, i) =>
      setTimeout(() => globe?.pulse(q.lat, q.lon, { color: F.quakeColor(q.mag), size: 0.06 + q.mag * 0.014, repeat: 2, layer: "quakes" }), 600 + i * 450));
  }
  firstQuakes = false;
  S.quakes = qs;
  drawQuakes();
  applyLayerVisibility();
  renderKpis();
  renderFeed();
}, 60e3);

poll("eonet", async () => {
  S.eonet = await F.getEonet();
  drawEonet();
  applyLayerVisibility();
  renderKpis();
  renderFeed();
}, 10 * 60e3, 300);

let pathAt = 0;
poll("iss", async () => {
  if (Date.now() - pathAt > 10 * 60e3) {
    try { S.issPath = await F.getISSPath(); pathAt = Date.now(); } catch (_) { /* path is optional */ }
  }
  const first = !S.iss;
  S.iss = await F.getISS();
  drawISS(first ? 0 : 5000);
  renderKpis();
  renderLayers();
}, 5e3, 500);

poll("tor", async () => {
  S.tor = await F.getTorExits();
  drawTor();
  renderKpis();
  renderTorTop();
}, 30 * 60e3, 900);

poll("kp", async () => {
  S.kp = await F.getKp();
  drawAurora();
  renderKpis();
}, 5 * 60e3, 1200);

poll("adv", async () => {
  S.adv = await F.getAdvisories();
  renderAdvisories();
}, 15 * 60e3, 1500);

poll("kev", async () => {
  S.kev = await F.getKEV();
  renderKpis();
  renderKEV();
}, 60 * 60e3, 2500);

poll("gh", async () => {
  S.gh = await F.getGitHubEvents(GH_USER);
  renderFeed();
}, 15 * 60e3, 1800);

// refresh relative times
setInterval(() => { if (!document.hidden) { renderFeed(); renderKpis(); } }, 30e3);

document.addEventListener("visibilitychange", () => { if (!document.hidden) renderFeed(); });

/* ---------- theme toggle ---------- */
const root = document.documentElement;
$("themeBtn").addEventListener("click", () => {
  const dark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : !matchMedia("(prefers-color-scheme: light)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch (_) { /* ignore */ }
});

renderLayers();
renderKpis();
renderFeed();
renderAdvisories();
renderKEV();
renderTorTop();
applyTheme();
onThemeChange(applyTheme);
applyLayerVisibility();
