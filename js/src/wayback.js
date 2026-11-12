// Wayback Machine OSINT page.
import * as API from "./wayback-api.js";
import { createSkyline } from "./skyline.js";
import { esc, nf } from "./feeds.js";

const $ = id => document.getElementById(id);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const URL_PAGE = 5000;

/* ---------- formatting ---------- */
const fmtTs = ts => API.tsToDate(ts).toLocaleString("id-ID", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC";
const fmtDay = ts => API.tsToDate(ts).toLocaleDateString("id-ID", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const fmtTime = ts => API.tsToDate(ts).toLocaleTimeString("id-ID", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtSize = n => (n == null || n === "-" || isNaN(+n)) ? "—" : +n < 1024 ? `${n} B` : +n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const stBadge = s => `<span class="st ${/^[2-5]/.test(s || "") ? "s" + s[0] : "s-"}">${esc(s && s !== "-" ? s : "—")}</span>`;
const mimeShort = m => (m || "—").replace(/^(text|application)\//, "").replace(/^x-/, "").slice(0, 28);
const yearsAgo = ts => {
  const y = (Date.now() - API.tsToDate(ts).getTime()) / (365.25 * 864e5);
  return y < 1 ? "kurang dari setahun lalu" : `${Math.floor(y)} tahun lalu`;
};
const loadingHTML = msg => `<div class="loading">${esc(msg)}</div>`;
const retries = new Map();
let retrySeq = 0;
function errorHTML(err, retry) {
  const id = retry ? `r${++retrySeq}` : "";
  if (retry) retries.set(id, retry);
  return `<div class="err"><span>${esc(err?.message || String(err))}</span>${retry ? `<button class="btn ghost sm" type="button" data-retry="${id}">Coba lagi</button>` : ""}</div>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-retry]");
  if (b) { const fn = retries.get(b.dataset.retry); retries.delete(b.dataset.retry); fn?.(); }
});

/* ---------- request pacing + cache (be gentle with the archive) ---------- */
function limiter(n) {
  let active = 0;
  const q = [];
  const next = () => {
    if (active >= n || !q.length) return;
    active++;
    const { fn, res, rej } = q.shift();
    fn().then(res, rej).finally(() => { active--; next(); });
  };
  return fn => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}
const run = limiter(2);
const memo = new Map();
function cached(key, fn) {
  if (!memo.has(key)) {
    const p = run(fn);
    memo.set(key, p);
    p.catch(() => memo.delete(key));
  }
  return memo.get(key);
}

/* ---------- state ---------- */
let T = null;          // parsed target
let mode = "domain";   // URL-list scope
let gen = 0;           // bumps on every new search so stale responses are ignored
let tab = "summary";
let S = {};

function listQuery() {
  switch (mode) {
    case "domain": return { url: T.domain, matchType: "domain", label: `*.${T.domain}` };
    case "host": return { url: T.host, matchType: "host", label: T.host };
    case "prefix": return { url: T.isRoot ? `${T.host}/` : T.url, matchType: "prefix", label: `${T.isRoot ? T.host + "/" : T.url}*` };
    default: return { url: T.url, matchType: "exact", label: T.url };
  }
}

/* ---------- tooltip ---------- */
const tip = $("tip");
function showTip(html, x, y) {
  if (!html) { tip.hidden = true; return; }
  tip.innerHTML = html;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + 14, top = y - h - 10;
  if (left + w > innerWidth - 8) left = x - w - 14;
  if (top < 64) top = y + 16;
  tip.style.transform = `translate(${Math.max(8, left)}px, ${top}px)`;
}

/* ---------- preview dialog ---------- */
const dlg = $("preview");
function preview(ts, url) {
  $("pvUrl").textContent = url;
  $("pvWhen").textContent = `Tangkapan ${fmtTs(ts)}`;
  $("pvOpen").href = API.links.snapshot(ts, url);
  $("pvRaw").href = API.links.raw(ts, url);
  $("pvFrame").src = API.links.frame(ts, url);
  if (dlg.showModal) dlg.showModal(); else window.open(API.links.snapshot(ts, url), "_blank", "noopener");
}
$("pvClose").addEventListener("click", () => dlg.close());
dlg.addEventListener("close", () => { $("pvFrame").src = "about:blank"; });
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
document.addEventListener("click", e => {
  const b = e.target.closest("[data-pv]");
  if (!b) return;
  e.preventDefault();
  preview(b.dataset.pv, b.dataset.u);
});
const pvBtn = (ts, url, label = "Pratinjau") => `<button class="btn ghost sm" type="button" data-pv="${esc(ts)}" data-u="${esc(url)}">${label}</button>`;

/* ---------- search ---------- */
$("form").addEventListener("submit", e => {
  e.preventDefault();
  search($("q").value, $("mode").value, "summary");
});
$("examples").addEventListener("click", e => {
  const b = e.target.closest("[data-q]");
  if (!b) return;
  $("q").value = b.dataset.q;
  search(b.dataset.q, $("mode").value, "summary");
});

function search(input, m, startTab) {
  const t = API.parseTarget(input);
  if (!t) {
    $("q").setCustomValidity("Masukkan domain atau URL yang valid, mis. example.com");
    $("q").reportValidity();
    setTimeout(() => $("q").setCustomValidity(""), 2500);
    return;
  }
  T = t;
  mode = m || "domain";
  gen++;
  S = { calYear: null, uShown: 300, uGroup: "all", sel: [] };
  $("q").value = T.url;
  $("mode").value = mode;
  $("result").hidden = false;
  $("tTitle").innerHTML = `${esc(T.url)}<small>Cakupan daftar URL: ${esc(listQuery().label)}</small>`;
  $("aSave").href = API.links.save(T.full);
  $("aWb").href = API.links.calendar(T.url);
  $("lSummary").href = API.links.summary(T.domain);
  $("lCalendar").href = API.links.calendar(T.url);
  $("lChanges").href = API.links.changes(T.url);
  $("lSitemap").href = API.links.sitemap(T.host);
  $("lUrls").href = API.links.urls(listQuery().url);
  $("tDate").max = new Date().toISOString().slice(0, 10);
  ["calBody", "dayBody", "chBody", "diffBody", "uBody", "uGroups", "sun", "sunSide", "sBody", "oFiles", "oRobots", "oParams", "yearbars", "years"]
    .forEach(id => { $(id).innerHTML = ""; });
  $("cFrom").innerHTML = $("cTo").innerHTML = "";
  $("uSearch").value = "";
  $("uStatus").value = "all";
  updateUrl();
  loadSummary();
  showTab(startTab || "summary");
  $("result").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}
function updateUrl() {
  const p = new URLSearchParams({ url: T.url, mode });
  if (tab !== "summary") p.set("tab", tab);
  history.replaceState(null, "", `?${p}`);
}

/* ---------- summary (KPIs + skyline + years) ---------- */
function kpi(label, value, sub, href) {
  const inner = `<div class="lb">${esc(label)}</div><b>${value}</b><small>${sub}</small>`;
  return `<div class="kpi">${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>` : inner}</div>`;
}
function renderKpis() {
  const c = S.counts, f = S.first, l = S.last;
  const dash = key => S.err?.[key] ? `<span style="color:var(--bad)">gagal</span>` : "…";
  const ys = c ? Object.entries(c.years).filter(([, a]) => a.some(Boolean)) : [];
  let busiest = null;
  if (c) for (const [y, a] of Object.entries(c.years)) a.forEach((n, i) => { if (!busiest || n > busiest.n) busiest = { y, m: i, n }; });
  $("kpis").innerHTML = [
    kpi("Total tangkapan", c ? `${c.approx ? "≥ " : ""}${nf.format(c.total)}` : dash("counts"), c ? (c.approx ? "jumlah bulan bertangkapan" : "semua tangkapan URL ini") : "menghitung…"),
    kpi("Pertama diarsipkan", f ? fmtDay(f.timestamp) : S.first === null ? "—" : dash("first"), f ? yearsAgo(f.timestamp) : "tangkapan tertua", f && API.links.snapshot(f.timestamp, f.original)),
    kpi("Terakhir diarsipkan", l ? fmtDay(l.timestamp) : S.last === null ? "—" : dash("last"), l ? fmtTime(l.timestamp) + " UTC" : "tangkapan terbaru", l && API.links.snapshot(l.timestamp, l.original)),
    kpi("Tahun aktif", c ? (ys.length ? `${ys[0][0]}–${ys[ys.length - 1][0]}` : "—") : dash("counts"), c ? `${ys.length} tahun berisi tangkapan` : "rentang arsip"),
    kpi("Bulan tersibuk", busiest && busiest.n ? `${MON[busiest.m]} ${busiest.y}` : c ? "—" : dash("counts"), busiest && busiest.n ? `${nf.format(busiest.n)} tangkapan` : "puncak pengarsipan"),
    kpi("Status terakhir", l ? stBadge(l.statuscode) : S.last === null ? "—" : dash("last"), l ? (l.statuscode?.startsWith("2") ? "halaman tersedia" : l.statuscode?.startsWith("3") ? "dialihkan" : "galat/tidak tersedia") : "dari tangkapan terbaru"),
  ].join("");
}

let sky = null;
function skyTheme() {
  return { low: cssVar("--sky-low"), high: cssVar("--sky-high"), empty: cssVar("--sky-empty"), plate: cssVar("--sky-plate") };
}
function webgl() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (_) { return false; }
}

async function loadSummary() {
  const g = gen, url = T.url;
  S.err = {};
  renderKpis();
  $("yearbars").innerHTML = `<li>${loadingHTML("Mengambil jumlah tangkapan…")}</li>`;
  $("skyNote").textContent = "";
  const jobs = [
    cached(`counts|${url}`, () => API.monthlyCounts(url)).then(c => { if (g !== gen) return; S.counts = c; renderKpis(); renderSkyline(); renderYearBars(); populateYearSelects(); if (tab === "calendar") loadCalendar(); if (tab === "changes" && !S.versions) loadChanges(); })
      .catch(err => { if (g !== gen) return; S.err.counts = err; renderKpis(); $("yearbars").innerHTML = `<li>${errorHTML(err, loadSummary)}</li>`; }),
    cached(`first|${url}`, () => API.firstCapture(url)).then(f => { if (g !== gen) return; S.first = f; renderKpis(); populateYearSelects(); })
      .catch(err => { if (g !== gen) return; S.err.first = err; renderKpis(); }),
    cached(`last|${url}`, () => API.lastCapture(url)).then(l => { if (g !== gen) return; S.last = l; renderKpis(); populateYearSelects(); })
      .catch(err => { if (g !== gen) return; S.err.last = err; renderKpis(); }),
  ];
  await Promise.allSettled(jobs);
}

function renderSkyline() {
  const c = S.counts;
  if (!c) return;
  if (!Object.keys(c.years).length) {
    $("sky").innerHTML = `<div class="loading" style="justify-content:center;height:100%">Belum ada tangkapan untuk URL ini.</div>`;
    sky = null;
    return;
  }
  if (!sky) {
    if (!webgl()) {
      $("sky").innerHTML = `<div class="note" style="padding:16px">WebGL tidak tersedia, jadi skyline 3D tidak bisa ditampilkan. Lihat daftar per tahun di bawah.</div>`;
    } else {
      $("sky").innerHTML = "";
      sky = createSkyline($("sky"), {
        onHover: (cell, x, y) => showTip(cell ? `<b>${MONTHS[cell.month]} ${cell.year}</b><br><span>${nf.format(cell.count)} tangkapan${cell.count ? " · klik untuk kalender" : ""}</span>` : null, x, y),
        onSelect: cell => { S.calYear = cell.year; S.calMonth = cell.month; showTab("calendar"); },
      });
      sky.setTheme(skyTheme());
    }
  }
  sky?.setData(c.years);
  $("skyNote").textContent = c.source === "sparkline"
    ? "Sumber: data kalender Wayback Machine (sparkline). Tinggi batang memakai skala logaritmik."
    : c.approx ? "Sumber: CDX Server (perkiraan — dihitung per bulan yang memiliki tangkapan)." : "Sumber: CDX Server. Tinggi batang memakai skala logaritmik.";
}

function renderYearBars() {
  const ys = Object.entries(S.counts.years).map(([y, a]) => [y, a.reduce((s, n) => s + n, 0)]).sort((a, b) => b[0] - a[0]);
  if (!ys.length) { $("yearbars").innerHTML = `<li class="note">Belum ada tangkapan.</li>`; return; }
  const max = Math.max(...ys.map(y => y[1]), 1);
  $("yearbars").innerHTML = ys.map(([y, n]) =>
    `<li data-year="${y}" tabindex="0" title="Buka kalender ${y}"><span class="y">${y}</span><span class="bar"><i style="width:${(Math.max(n ? 1.5 : 0, n / max * 100)).toFixed(1)}%"></i></span><span class="v">${nf.format(n)}</span></li>`).join("");
}
$("yearbars").addEventListener("click", e => {
  const li = e.target.closest("[data-year]");
  if (li) { S.calYear = +li.dataset.year; S.calMonth = null; showTab("calendar"); }
});
$("yearbars").addEventListener("keydown", e => { if (e.key === "Enter") e.target.closest("[data-year]")?.click(); });

/* ---------- time travel + latest ---------- */
$("travel").addEventListener("submit", async e => {
  e.preventDefault();
  const v = $("tDate").value;
  if (!v || !T) return;
  await jumpTo(v.replaceAll("-", ""));
});
$("aLatest").addEventListener("click", () => T && jumpTo(null));
async function jumpTo(ts) {
  const btn = ts ? $("travel").querySelector("button") : $("aLatest");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Mencari…";
  try {
    const c = await API.closest(T.url, ts);
    if (c) preview(c.ts, T.url);
    else if (S.last) preview(S.last.timestamp, S.last.original);
    else alert("Tidak ada tangkapan untuk URL ini.");
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* ---------- tabs ---------- */
$("tabs").addEventListener("click", e => {
  const b = e.target.closest(".tab");
  if (b) showTab(b.dataset.tab);
});
function showTab(name) {
  tab = name;
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => { p.hidden = p.id !== `p-${name}`; });
  if (T) updateUrl();
  ({
    summary: () => sky?.resize(),
    calendar: loadCalendar,
    changes: () => { if (!S.versions) loadChanges(); },
    urls: () => withUrls(renderUrls),
    sitemap: () => withUrls(renderSunburst),
    subdomains: () => withUrls(renderSubdomains),
    osint: () => { withUrls(renderOsintFromUrls); loadRobots(); },
  })[name]?.();
}

/* ---------- calendar ---------- */
function calendarYears() {
  const c = S.counts;
  let ys = c ? Object.entries(c.years).filter(([, a]) => a.some(Boolean)).map(([y]) => +y) : [];
  if (!ys.length && S.first && S.last) {
    const a = +S.first.timestamp.slice(0, 4), b = +S.last.timestamp.slice(0, 4);
    for (let y = a; y <= b; y++) ys.push(y);
  }
  return ys.sort((a, b) => a - b);
}
async function loadCalendar() {
  const ys = calendarYears();
  if (!ys.length) {
    $("years").innerHTML = "";
    $("calBody").innerHTML = S.counts || S.err?.counts ? `<p class="note">Belum ada tangkapan untuk URL ini.</p>` : loadingHTML("Menunggu data ringkasan…");
    return;
  }
  if (!S.calYear || !ys.includes(S.calYear)) S.calYear = ys[ys.length - 1];
  $("years").innerHTML = ys.map(y => `<button class="chip" type="button" data-y="${y}" aria-pressed="${y === S.calYear}">${y}</button>`).join("");
  $("years").querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  const g = gen, year = S.calYear, url = T.url;
  $("calBody").innerHTML = loadingHTML(`Memuat kalender ${year}…`);
  try {
    const r = await cached(`year|${url}|${year}`, () => API.yearDays(url, year));
    if (g !== gen || year !== S.calYear) return;
    renderCalendar(year, r);
  } catch (err) {
    if (g === gen) $("calBody").innerHTML = errorHTML(err, loadCalendar);
  }
}
$("years").addEventListener("click", e => {
  const b = e.target.closest("[data-y]");
  if (!b) return;
  S.calYear = +b.dataset.y;
  S.calMonth = null;
  $("dayBody").innerHTML = "";
  loadCalendar();
});
function renderCalendar(year, { days, approx }) {
  let max = 1, total = 0;
  for (const d of days.values()) { max = Math.max(max, d.count); total += d.count; }
  const level = c => !c ? 0 : approx ? 3 : Math.min(4, 1 + Math.floor(3 * Math.log(c) / Math.log(max + 1) + 0.0001));
  let html = `<p class="note">${nf.format(days.size)} hari bertangkapan di ${year}${approx ? "" : ` · ${nf.format(total)} tangkapan`}${approx ? " · jumlah per hari tidak tersedia; warna hanya menandai ada/tidaknya tangkapan" : ""}. Klik sebuah hari untuk melihat tangkapannya.</p><div class="months">`;
  for (let m = 0; m < 12; m++) {
    const first = new Date(Date.UTC(year, m, 1));
    const nDays = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    const pad = (first.getUTCDay() + 6) % 7;
    let cells = "", mTotal = 0;
    for (let i = 0; i < pad; i++) cells += `<span class="day pad"></span>`;
    for (let d = 1; d <= nDays; d++) {
      const key = `${year}${String(m + 1).padStart(2, "0")}${String(d).padStart(2, "0")}`;
      const info = days.get(key);
      mTotal += info?.count || 0;
      cells += info
        ? `<button class="day has" type="button" data-l="${level(info.count)}" data-d="${key}" aria-label="${d} ${MONTHS[m]} ${year}: ${approx ? "ada tangkapan" : nf.format(info.count) + " tangkapan"}" data-tip="${d} ${MON[m]} ${year} · ${approx ? "ada tangkapan" : nf.format(info.count) + " tangkapan"}">${d}</button>`
        : `<span class="day" aria-hidden="true"></span>`;
    }
    html += `<div class="month" id="m-${m}"><h4>${MONTHS[m]} <span>${mTotal ? nf.format(mTotal) : ""}</span></h4><div class="days">${cells}</div></div>`;
  }
  html += `</div><div class="legend">Sedikit <i style="background:var(--h0)"></i><i style="background:var(--h1)"></i><i style="background:var(--h2)"></i><i style="background:var(--h3)"></i><i style="background:var(--h4)"></i> Banyak</div>`;
  $("calBody").innerHTML = html;
  if (S.calMonth != null) $(`m-${S.calMonth}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
$("calBody").addEventListener("click", e => {
  const b = e.target.closest("[data-d]");
  if (!b) return;
  $("calBody").querySelectorAll(".day.sel").forEach(x => x.classList.remove("sel"));
  b.classList.add("sel");
  loadDay(b.dataset.d);
});
$("calBody").addEventListener("mousemove", e => {
  const b = e.target.closest("[data-tip]");
  showTip(b ? esc(b.dataset.tip) : null, e.clientX, e.clientY);
});
$("calBody").addEventListener("mouseleave", () => showTip(null));
async function loadDay(ymd) {
  const g = gen, url = T.url;
  const label = API.tsToDate(ymd).toLocaleDateString("id-ID", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("dayBody").innerHTML = `<h3>Tangkapan ${esc(label)}</h3>${loadingHTML("Memuat…")}`;
  $("dayBody").scrollIntoView({ block: "nearest", behavior: "smooth" });
  try {
    const rows = await cached(`day|${url}|${ymd}`, () => API.dayCaptures(url, ymd));
    if (g !== gen) return;
    $("dayBody").innerHTML = `<h3>Tangkapan ${esc(label)} <span>${nf.format(rows.length)}</span></h3><ul class="list">${rows.map(r => `
      <li class="row"><div><div class="t">${fmtTime(r.timestamp)} UTC ${stBadge(r.statuscode)} <span class="pill">${esc(mimeShort(r.mimetype))}</span><span class="pill">${fmtSize(r.length)}</span></div>
      <small>${esc(r.original)} · digest ${esc((r.digest || "").slice(0, 10))}…</small></div>
      <div class="act">${pvBtn(r.timestamp, r.original)}<a class="btn ghost sm" href="${API.links.snapshot(r.timestamp, r.original)}" target="_blank" rel="noopener">Buka ↗</a><a class="btn ghost sm" href="${API.links.raw(r.timestamp, r.original)}" target="_blank" rel="noopener">Mentah ↗</a></div></li>`).join("")}</ul>`;
  } catch (err) {
    if (g === gen) $("dayBody").innerHTML = errorHTML(err, () => loadDay(ymd));
  }
}

/* ---------- changes ---------- */
function populateYearSelects() {
  const ys = calendarYears();
  if (!ys.length || $("cFrom").options.length) return;
  const opts = ys.map(y => `<option value="${y}">${y}</option>`).join("");
  $("cFrom").innerHTML = opts;
  $("cTo").innerHTML = opts;
  $("cTo").value = ys[ys.length - 1];
  $("cFrom").value = ys[Math.max(0, ys.length - 3)];
}
$("cLoad").addEventListener("click", () => loadChanges());
async function loadChanges() {
  populateYearSelects();
  if (!$("cFrom").options.length) {
    $("chBody").innerHTML = S.counts || S.err?.counts ? `<p class="note">Belum ada tangkapan untuk URL ini.</p>` : loadingHTML("Menunggu data ringkasan…");
    return;
  }
  let from = +$("cFrom").value, to = +$("cTo").value;
  if (from > to) [from, to] = [to, from];
  const g = gen, url = T.url;
  S.sel = [];
  $("cCompare").disabled = true;
  $("diffBody").innerHTML = "";
  $("chBody").innerHTML = loadingHTML(`Mencari versi konten ${from}–${to}…`);
  try {
    const rows = await cached(`ver|${url}|${from}|${to}`, () => API.contentVersions(url, String(from), String(to)));
    if (g !== gen) return;
    S.versions = rows;
    renderVersions(rows, from, to);
  } catch (err) {
    if (g === gen) $("chBody").innerHTML = errorHTML(err, loadChanges);
  }
}
function renderVersions(rows, from, to) {
  if (!rows.length) { $("chBody").innerHTML = `<p class="note">Tidak ada tangkapan yang berhasil (2xx/3xx) pada ${from}–${to}.</p>`; return; }
  // size-over-time chart
  const pts = rows.map(r => ({ t: API.tsToDate(r.timestamp).getTime(), v: +r.length || 0 }));
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1, vmax = Math.max(...pts.map(p => p.v), 1);
  const W = 1000, H = 150, P = 8;
  const X = t => P + (t1 === t0 ? (W - 2 * P) / 2 : (t - t0) / (t1 - t0) * (W - 2 * P));
  const Y = v => H - P - (v / vmax) * (H - 2 * P - 14);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  const svg = `<svg class="vchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Ukuran arsip tiap versi dari waktu ke waktu">
    <line x1="${P}" x2="${W - P}" y1="${H - P}" y2="${H - P}" stroke="var(--line)"/>
    <path d="${line}" fill="none" stroke="var(--accent-2)" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <text x="${P}" y="12" fill="var(--muted)" font-size="11" font-family="var(--mono)">${fmtSize(vmax)}</text></svg>`;
  let prev = null;
  const items = rows.map((r, i) => {
    const sz = +r.length || 0;
    const delta = prev ? Math.round((sz - prev) / Math.max(prev, 1) * 100) : null;
    prev = sz;
    return `<li class="row vrow"><input type="checkbox" data-i="${i}" aria-label="Pilih versi ${fmtTs(r.timestamp)}">
      <div><div class="t">${fmtTs(r.timestamp)} ${stBadge(r.statuscode)} <span class="pill">${esc(mimeShort(r.mimetype))}</span></div>
      <small>${fmtSize(r.length)}${delta != null ? ` · ${delta > 0 ? "+" : ""}${delta}% dari versi sebelumnya` : " · versi pertama dalam rentang"} · digest ${esc((r.digest || "").slice(0, 10))}…</small></div>
      <div class="act">${pvBtn(r.timestamp, T.url)}<a class="btn ghost sm" href="${API.links.snapshot(r.timestamp, T.url)}" target="_blank" rel="noopener">Buka ↗</a></div></li>`;
  }).reverse();
  $("chBody").innerHTML = `${svg}<p class="note">${nf.format(rows.length)} versi berbeda${rows.length >= 3000 ? " (dibatasi 3.000 versi pertama — persempit rentang tahun)" : ""}. Terbaru di atas.</p><ul class="list" id="vlist">${items.join("")}</ul>`;
}
$("chBody").addEventListener("change", e => {
  const cb = e.target.closest("input[data-i]");
  if (!cb) return;
  const i = +cb.dataset.i;
  S.sel = S.sel.filter(x => x !== i);
  if (cb.checked) S.sel.push(i);
  while (S.sel.length > 2) {
    const drop = S.sel.shift();
    $("chBody").querySelector(`input[data-i="${drop}"]`).checked = false;
  }
  $("cCompare").disabled = S.sel.length !== 2;
});
$("cCompare").addEventListener("click", compareVersions);
async function compareVersions() {
  if (S.sel.length !== 2 || !S.versions) return;
  const [a, b] = [...S.sel].sort((x, y) => x - y).map(i => S.versions[i]);
  const g = gen, url = T.url;
  const wbDiff = API.links.diff(a.timestamp, b.timestamp, url);
  $("diffBody").innerHTML = `<h3>Perbandingan ${fmtDay(a.timestamp)} → ${fmtDay(b.timestamp)} <a href="${wbDiff}" target="_blank" rel="noopener">Diff di Wayback ↗</a></h3>${loadingHTML("Mengambil isi kedua versi dari arsip…")}`;
  $("diffBody").scrollIntoView({ block: "start", behavior: "smooth" });
  try {
    const [ta, tb] = await Promise.all([
      cached(`txt|${a.timestamp}|${url}`, () => API.snapshotText(a.timestamp, url)),
      cached(`txt|${b.timestamp}|${url}`, () => API.snapshotText(b.timestamp, url)),
    ]);
    if (g !== gen) return;
    const isHtml = m => /html/.test(m || "");
    const la = (isHtml(a.mimetype) ? API.visibleText(ta) : ta.split(/\r?\n/)).slice(0, 1500);
    const lb = (isHtml(b.mimetype) ? API.visibleText(tb) : tb.split(/\r?\n/)).slice(0, 1500);
    const ops = API.diffLines(la, lb);
    if (!ops) {
      $("diffBody").querySelector(".loading").outerHTML = `<p class="note">Kedua versi terlalu berbeda untuk dibandingkan baris per baris. Gunakan diff di Wayback.</p>`;
      return;
    }
    const added = ops.filter(o => o.t === "+").length, removed = ops.filter(o => o.t === "-").length;
    // keep 2 lines of context around changes, collapse the rest
    const keep = new Uint8Array(ops.length);
    ops.forEach((o, i) => { if (o.t !== "=") for (let k = Math.max(0, i - 2); k <= Math.min(ops.length - 1, i + 2); k++) keep[k] = 1; });
    let html = "", skipped = 0;
    ops.forEach((o, i) => {
      if (!keep[i]) { skipped++; return; }
      if (skipped) { html += `<div class="gap">… ${nf.format(skipped)} baris sama …</div>`; skipped = 0; }
      html += `<div class="${o.t === "+" ? "a" : o.t === "-" ? "d" : "e"}">${esc(o.s)}</div>`;
    });
    if (skipped) html += `<div class="gap">… ${nf.format(skipped)} baris sama …</div>`;
    $("diffBody").querySelector(".loading").outerHTML = `<p class="note"><b style="color:var(--s2)">+${nf.format(added)}</b> baris ditambahkan · <b style="color:var(--s5)">−${nf.format(removed)}</b> baris dihapus (teks yang terlihat${la.length >= 1500 || lb.length >= 1500 ? ", 1.500 baris pertama" : ""}).</p>
      <div class="diff">${added || removed ? html : '<div class="e">Teks yang terlihat identik — perbedaannya ada di markup, skrip, atau gaya.</div>'}</div>`;
  } catch (err) {
    if (g !== gen) return;
    const l = $("diffBody").querySelector(".loading");
    if (l) l.outerHTML = errorHTML({ message: `Isi arsip tidak bisa diambil langsung oleh browser (${err.message}). Buka "Diff di Wayback" untuk perbandingan resmi.` });
  }
}

/* ---------- archived URL list (shared by URL, Site Map, Subdomain, OSINT tabs) ---------- */
async function withUrls(render) {
  const g = gen, q = listQuery();
  const panel = { urls: "uBody", sitemap: "sun", subdomains: "sBody", osint: "oFiles" }[tab];
  if (!S.urls) {
    if (panel) $(panel).innerHTML = loadingHTML(`Mengambil daftar URL arsip untuk ${q.label}… (bisa memakan waktu untuk situs besar)`);
    try {
      const r = await cached(`urls|${q.matchType}|${q.url}`, () => API.archivedUrls(q.url, q.matchType, { limit: URL_PAGE }));
      if (g !== gen) return;
      S.urls = { rows: r.rows, resumeKey: r.resumeKey };
    } catch (err) {
      if (g === gen && panel) $(panel).innerHTML = errorHTML(err, () => withUrls(render));
      return;
    }
  }
  render();
}
async function loadMoreUrls() {
  if (!S.urls?.resumeKey) return;
  const g = gen, q = listQuery();
  const btn = $("uMore");
  if (btn) { btn.disabled = true; btn.textContent = "Memuat…"; }
  try {
    const r = await run(() => API.archivedUrls(q.url, q.matchType, { limit: URL_PAGE, resumeKey: S.urls.resumeKey }));
    if (g !== gen) return;
    S.urls.rows.push(...r.rows);
    S.urls.resumeKey = r.resumeKey;
    showTab(tab);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = `Gagal: ${err.message} — coba lagi`; }
  }
}
document.addEventListener("click", e => { if (e.target.id === "uMore") loadMoreUrls(); });
const moreBtn = () => S.urls?.resumeKey
  ? `<button class="btn ghost sm" id="uMore" type="button">Ambil ${nf.format(URL_PAGE)} URL berikutnya dari arsip</button>` : "";

function filteredUrls() {
  const q = $("uSearch").value.trim().toLowerCase();
  const st = $("uStatus").value;
  return S.urls.rows.filter(r =>
    (S.uGroup === "all" || API.mimeGroup(r.mimetype) === S.uGroup) &&
    (st === "all" || (r.statuscode || "").startsWith(st)) &&
    (!q || r.original.toLowerCase().includes(q)));
}
function renderUrls() {
  const rows = S.urls.rows;
  const q = listQuery();
  $("uTitle").textContent = `URL yang diarsipkan · ${q.label}`;
  const counts = { all: rows.length };
  for (const r of rows) { const gk = API.mimeGroup(r.mimetype); counts[gk] = (counts[gk] || 0) + 1; }
  const groups = [["all", "Semua"], ...API.MIME_GROUPS.map(([id, l]) => [id, l]), ["other", "Lainnya"]].filter(([id]) => counts[id]);
  $("uGroups").innerHTML = groups.map(([id, l]) => `<button class="chip" type="button" data-g="${id}" aria-pressed="${S.uGroup === id}">${l}<span class="n">${nf.format(counts[id])}</span></button>`).join("");
  const list = filteredUrls();
  const shown = list.slice(0, S.uShown);
  $("uBody").innerHTML = `<p class="note">${nf.format(rows.length)} URL unik${S.urls.resumeKey ? " (sebagian — masih ada lagi di arsip)" : ""} · ${nf.format(list.length)} cocok dengan filter. Tanggal = tangkapan pertama tiap URL.</p>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>URL</th><th>Tipe</th><th>Status</th><th class="hide-sm">Pertama</th><th class="hide-sm">Ukuran</th><th></th></tr></thead><tbody>
    ${shown.map(r => `<tr><td class="u"><a href="${esc(API.links.calendar(r.original))}" target="_blank" rel="noopener" title="Kalender tangkapan URL ini">${esc(r.original)}</a></td>
      <td class="n">${esc(mimeShort(r.mimetype))}</td><td>${stBadge(r.statuscode)}</td><td class="n hide-sm">${fmtDay(r.timestamp)}</td><td class="n hide-sm">${fmtSize(r.length)}</td>
      <td>${pvBtn(r.timestamp, r.original, "▶")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Tidak ada URL yang cocok.</p>`}
    <div class="toolbar" style="margin-top:12px">${list.length > shown.length ? `<button class="btn ghost sm" id="uShowMore" type="button">Tampilkan ${nf.format(Math.min(300, list.length - shown.length))} lagi</button>` : ""}${moreBtn()}</div>`;
}
$("uGroups").addEventListener("click", e => {
  const b = e.target.closest("[data-g]");
  if (!b) return;
  S.uGroup = b.dataset.g;
  S.uShown = 300;
  renderUrls();
});
let searchTimer = 0;
$("uSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { S.uShown = 300; if (S.urls) renderUrls(); }, 150); });
$("uStatus").addEventListener("change", () => { S.uShown = 300; if (S.urls) renderUrls(); });
document.addEventListener("click", e => { if (e.target.id === "uShowMore") { S.uShown += 300; renderUrls(); } });

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const slug = () => (listQuery().url).replace(/[^a-z0-9.-]+/gi, "_");
document.querySelectorAll("[data-export]").forEach(b => b.addEventListener("click", () => {
  if (!S.urls) return;
  const rows = filteredUrls();
  const kind = b.dataset.export;
  if (kind === "txt") download(`wayback-${slug()}.txt`, rows.map(r => r.original).join("\n") + "\n", "text/plain");
  else if (kind === "csv") {
    const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
    download(`wayback-${slug()}.csv`, "url,mimetype,status,first_timestamp,length\n" + rows.map(r => [r.original, r.mimetype, r.statuscode, r.timestamp, r.length].map(q).join(",")).join("\n") + "\n", "text/csv");
  } else download(`wayback-${slug()}.json`, JSON.stringify({ query: listQuery(), exported: new Date().toISOString(), rows }, null, 2), "application/json");
}));

/* ---------- site map (sunburst) ---------- */
const PALETTE = ["#2f9e74", "#3b82c4", "#c9822b", "#a35fd0", "#d1495b", "#2aa1a8", "#8a9a2b", "#c25e9a"];
function buildTree(rows) {
  const root = { name: listQuery().label, count: 0, children: new Map(), path: "" };
  for (const r of rows) {
    let u;
    try { u = new URL(/^https?:\/\//i.test(r.original) ? r.original : "http://" + r.original); } catch (_) { continue; }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const segs = u.pathname.split("/").filter(Boolean).slice(0, 3).map(s => { try { return decodeURIComponent(s); } catch (_) { return s; } });
    root.count++;
    let node = root, path = host;
    for (const seg of [host, ...segs]) {
      if (node !== root) path += "/" + seg;
      let child = node.children.get(seg);
      if (!child) { child = { name: seg, count: 0, children: new Map(), path: node === root ? host : path }; node.children.set(seg, child); }
      child.count++;
      node = child;
    }
  }
  return root;
}
function arcPath(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r, a) => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  return `M${p(r1, a0)}A${r1},${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}
function renderSunburst() {
  const rows = S.urls.rows;
  if (!rows.length) { $("sun").innerHTML = `<p class="note">Tidak ada URL arsip.</p>`; $("sunSide").innerHTML = ""; return; }
  const tree = buildTree(rows);
  const size = 640, c = size / 2, ring = 64, inner = 62;
  const paths = [], nodes = [];
  function walk(node, depth, a0, a1, color) {
    const kids = [...node.children.values()].sort((a, b) => b.count - a.count);
    let a = a0;
    kids.forEach((k, i) => {
      const span = (a1 - a0) * k.count / node.count;
      const col = depth === 0 ? PALETTE[i % PALETTE.length] : color;
      if (span > 0.004) {
        const r0 = inner + depth * ring, r1 = r0 + ring - 2;
        nodes.push(k);
        paths.push(`<path d="${arcPath(c, c, r0, r1, a, a + span)}" fill="${col}" fill-opacity="${(1 - depth * 0.2).toFixed(2)}" data-n="${nodes.length - 1}"></path>`);
        if (depth < 3) walk(k, depth + 1, a, a + span, col);
      }
      a += span;
    });
  }
  walk(tree, 0, 0, Math.PI * 2, null);
  S.sunNodes = nodes;
  $("sun").innerHTML = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Peta situs sunburst dari ${nf.format(tree.count)} URL arsip">
    ${paths.join("")}
    <circle cx="${c}" cy="${c}" r="${inner - 4}" fill="var(--card)" stroke="var(--line)"></circle>
    <text x="${c}" y="${c - 2}" text-anchor="middle">${nf.format(tree.count)}</text>
    <text class="sub" x="${c}" y="${c + 16}" text-anchor="middle">URL</text></svg>`;
  const top = [...tree.children.values()].flatMap(h => [h, ...[...h.children.values()]]).sort((a, b) => b.count - a.count).slice(0, 16);
  const max = top[0]?.count || 1;
  $("sunSide").innerHTML = `<h3>Cabang terbesar</h3><ul class="yearbars">${top.map(n => `
    <li data-href="${esc(API.links.urls(n.path))}" tabindex="0" title="${esc(n.path)}" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) 64px">
      <span class="y" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.path)}</span><span class="bar"><i style="width:${(n.count / max * 100).toFixed(1)}%"></i></span><span class="v">${nf.format(n.count)}</span></li>`).join("")}</ul>
    <p class="note">Ukuran irisan = jumlah URL di bawah jalur tersebut (hingga 3 tingkat). Klik irisan untuk membuka daftar URL-nya di Wayback.${S.urls.resumeKey ? " Berdasarkan sebagian URL pertama." : ""}</p>${moreBtn()}`;
}
$("sun").addEventListener("mousemove", e => {
  const p = e.target.closest("path[data-n]");
  const n = p && S.sunNodes[+p.dataset.n];
  showTip(n ? `<b>${esc(n.path)}</b><br><span>${nf.format(n.count)} URL</span>` : null, e.clientX, e.clientY);
});
$("sun").addEventListener("mouseleave", () => showTip(null));
$("sun").addEventListener("click", e => {
  const p = e.target.closest("path[data-n]");
  const n = p && S.sunNodes[+p.dataset.n];
  if (n) window.open(API.links.urls(n.path), "_blank", "noopener");
});
$("sunSide").addEventListener("click", e => {
  const li = e.target.closest("[data-href]");
  if (li) window.open(li.dataset.href, "_blank", "noopener");
});

/* ---------- subdomains ---------- */
function renderSubdomains() {
  const hosts = API.hostStats(S.urls.rows);
  S.hosts = hosts;
  const hint = mode !== "domain"
    ? `<div class="err" style="border-color:var(--line);background:var(--card)"><span>Mode saat ini hanya mencakup ${esc(listQuery().label)}. Gunakan mode <b>Domain + subdomain</b> untuk menemukan semua subdomain.</span><button class="btn ghost sm" type="button" id="toDomain">Ganti ke mode domain</button></div>` : "";
  $("sBody").innerHTML = `${hint}<p class="note">${nf.format(hosts.length)} host dari ${nf.format(S.urls.rows.length)} URL arsip${S.urls.resumeKey ? " (sebagian)" : ""}. Klik host untuk menelusurinya.</p>
    <div class="table-wrap"><table><thead><tr><th>Host</th><th>URL</th><th>Pertama terlihat</th><th></th></tr></thead><tbody>
    ${hosts.map(h => `<tr><td class="u"><button class="lnk" type="button" data-host="${esc(h.host)}">${esc(h.host)}</button></td><td class="n">${nf.format(h.count)}</td><td class="n">${fmtDay(h.first)}</td>
      <td><a class="lnk" href="${API.links.calendar(h.host)}" target="_blank" rel="noopener">Kalender ↗</a></td></tr>`).join("")}</tbody></table></div>
    <div class="toolbar" style="margin-top:12px">${moreBtn()}</div>`;
}
$("sBody").addEventListener("click", e => {
  const h = e.target.closest("[data-host]");
  if (h) { search(h.dataset.host, "host", "summary"); return; }
  if (e.target.id === "toDomain") search(T.url, "domain", "subdomains");
});
$("sExport").addEventListener("click", () => { if (S.hosts) download(`subdomain-${T.domain}.txt`, S.hosts.map(h => h.host).join("\n") + "\n", "text/plain"); });

/* ---------- OSINT findings ---------- */
function renderOsintFromUrls() {
  const rows = S.urls.rows;
  const groups = API.interestingFiles(rows);
  $("oFiles").innerHTML = groups.length ? groups.map((g, i) => `
    <details class="grp"${i === 0 ? " open" : ""}><summary>${esc(g.label)} <span>${nf.format(g.items.length)}${g.items.length >= 400 ? "+" : ""}</span></summary>
    <ul>${g.items.map(r => `<li><a href="${API.links.snapshot(r.timestamp, r.original)}" target="_blank" rel="noopener">${esc(r.original)}</a> <span class="pill">${fmtDay(r.timestamp)}</span>${stBadge(r.statuscode)}</li>`).join("")}</ul></details>`).join("")
    + `<p class="note">Berdasarkan ${nf.format(rows.length)} URL${S.urls.resumeKey ? " pertama" : ""}.</p>${moreBtn()}`
    : `<p class="note">Tidak ada file atau jalur menarik di ${nf.format(rows.length)} URL arsip.</p>${moreBtn()}`;

  const params = API.paramStats(rows).slice(0, 80);
  $("oParams").innerHTML = params.length
    ? `<p class="note">${nf.format(params.length)} nama parameter. Klik untuk melihat URL-nya.</p><div class="params">${params.map(p => `<button class="chip" type="button" data-param="${esc(p.name)}" title="${esc(p.sample)}">${esc(p.name)}<span class="n">×${nf.format(p.count)}</span></button>`).join("")}</div>`
    : `<p class="note">Tidak ada URL dengan parameter query.</p>`;
}
$("oParams").addEventListener("click", e => {
  const b = e.target.closest("[data-param]");
  if (!b) return;
  $("uSearch").value = `${b.dataset.param}=`;
  S.uShown = 300;
  showTab("urls");
});

async function loadRobots() {
  if (S.robots) return renderRobots();
  const g = gen, host = T.host;
  $("oRobots").innerHTML = loadingHTML("Mencari versi robots.txt…");
  try {
    const rows = await cached(`robots|${host}`, () => API.robotsVersions(host));
    if (g !== gen) return;
    S.robots = { rows, rules: null };
    renderRobots();
  } catch (err) {
    if (g === gen) $("oRobots").innerHTML = errorHTML(err, loadRobots);
  }
}
function renderRobots() {
  const { rows, rules, ruleErr } = S.robots;
  if (!rows.length) { $("oRobots").innerHTML = `<p class="note">Tidak ada robots.txt yang diarsipkan untuk ${esc(T.host)}.</p>`; return; }
  let html = `<p class="note">${nf.format(rows.length)} versi robots.txt yang berbeda (${fmtDay(rows[0].timestamp)} – ${fmtDay(rows[rows.length - 1].timestamp)}).</p>
    <ul class="list">${rows.slice().reverse().slice(0, 12).map(r => `<li class="row"><div><div class="t">${fmtTs(r.timestamp)}</div><small>${fmtSize(r.length)}</small></div>
    <div class="act">${pvBtn(r.timestamp, r.original)}<a class="btn ghost sm" href="${API.links.raw(r.timestamp, r.original)}" target="_blank" rel="noopener">Mentah ↗</a></div></li>`).join("")}</ul>`;
  if (rules) {
    html += rules.length ? `<h3>Jalur yang pernah disebut di robots.txt</h3><div class="table-wrap"><table><thead><tr><th>Aturan</th><th>Jalur</th><th>Pertama</th><th>Terakhir</th></tr></thead><tbody>
      ${rules.map(r => `<tr><td class="n">${esc(r.type)}</td><td class="u r">${r.type === "sitemap" ? `<a href="${esc(r.value)}" target="_blank" rel="noopener">${esc(r.value)}</a>` : `<a href="${esc(API.links.urls(T.host + r.value.replace(/\*.*$/, "")))}" target="_blank" rel="noopener" title="Cari di arsip">${esc(r.value)}</a>`}</td>
      <td class="n">${fmtDay(r.first)}</td><td class="n">${r.gone ? fmtDay(r.last) : "masih ada"}</td></tr>`).join("")}</tbody></table></div>
      <p class="note">"Disallow" sering membocorkan jalur yang ingin disembunyikan pemilik situs. Klik jalur untuk mencarinya di arsip.</p>` : `<p class="note">Tidak ada aturan yang bisa diekstrak.</p>`;
  } else if (ruleErr) {
    html += `<div class="err" style="margin-top:10px"><span>${esc(ruleErr)}</span></div>`;
  } else {
    html += `<button class="btn ghost sm" type="button" id="rExtract" style="margin-top:8px">Ekstrak semua jalur Disallow/Allow/Sitemap</button>`;
  }
  $("oRobots").innerHTML = html;
}
$("oRobots").addEventListener("click", async e => {
  if (e.target.id !== "rExtract") return;
  const g = gen, rows = S.robots.rows.slice(-20);
  e.target.disabled = true;
  e.target.textContent = `Mengambil ${rows.length} versi…`;
  const seen = new Map();
  let ok = 0, lastErr = null;
  for (const r of rows) {
    try {
      const txt = await cached(`txt|${r.timestamp}|${r.original}`, () => API.snapshotText(r.timestamp, r.original, 20000));
      if (g !== gen) return;
      ok++;
      for (const rule of API.parseRobots(txt)) {
        const k = `${rule.type}|${rule.value}`;
        const e2 = seen.get(k) || { type: rule.type, value: rule.value, first: r.timestamp, last: r.timestamp };
        e2.last = r.timestamp;
        seen.set(k, e2);
      }
    } catch (err) { lastErr = err; }
  }
  if (g !== gen) return;
  const newest = rows[rows.length - 1].timestamp;
  if (!ok) S.robots.ruleErr = `Isi robots.txt tidak bisa diambil langsung oleh browser (${lastErr?.message || "galat"}). Buka versinya lewat tombol "Mentah".`;
  else S.robots.rules = [...seen.values()].map(r => ({ ...r, gone: r.last !== newest }))
    .sort((a, b) => (a.type > b.type ? 1 : a.type < b.type ? -1 : a.first.localeCompare(b.first)));
  renderRobots();
});

/* ---------- theme ---------- */
const root = document.documentElement;
$("themeBtn").addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch (_) { /* ignore */ }
});
const retheme = () => sky?.setTheme(skyTheme());
new MutationObserver(retheme).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", retheme);

/* ---------- deep link ---------- */
{
  const p = new URLSearchParams(location.search);
  const u = p.get("url");
  const m = p.get("mode");
  const t = p.get("tab");
  if (u) {
    $("q").value = u;
    search(u, ["domain", "host", "prefix", "exact"].includes(m) ? m : "domain",
      ["summary", "calendar", "changes", "urls", "sitemap", "subdomains", "osint"].includes(t) ? t : "summary");
  }
}
