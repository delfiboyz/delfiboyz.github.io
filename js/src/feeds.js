// Live open-source data feeds. Every source is public, needs no API key and allows
// cross-origin requests, so the browser fetches them directly — no server in between.

export async function fetchJSON(url, { timeout = 15000, ...init } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/* ---------- formatting ---------- */
const rtf = new Intl.RelativeTimeFormat("id", { numeric: "auto" });
export function timeAgo(t, now = Date.now()) {
  const s = Math.round((new Date(t).getTime() - now) / 1000);
  const a = Math.abs(s);
  if (a < 45) return rtf.format(s, "second");
  if (a < 2700) return rtf.format(Math.round(s / 60), "minute");
  if (a < 64800) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 2592000) return rtf.format(Math.round(s / 86400), "day");
  return rtf.format(Math.round(s / 2592000), "month");
}
export const nf = new Intl.NumberFormat("id-ID");
export const nf1 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const fmtDate = d => new Date(d).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtDay = d => new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let regionNames = null;
export function countryName(cc) {
  if (!cc) return "";
  try {
    regionNames ||= new Intl.DisplayNames(["id"], { type: "region" });
    return regionNames.of(cc.toUpperCase()) || cc.toUpperCase();
  } catch (_) { return cc.toUpperCase(); }
}
export function flag(cc) {
  if (!cc || cc.length !== 2) return "";
  return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0)));
}

/* ---------- earthquakes: USGS ---------- */
export const USGS_DAY = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";
export async function getQuakes(url = USGS_DAY) {
  const j = await fetchJSON(url);
  return j.features
    .filter(f => f.geometry && f.properties.mag != null)
    .map(f => ({
      id: f.id,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depth: f.geometry.coordinates[2],
      mag: f.properties.mag,
      place: f.properties.place || f.properties.title || "Lokasi tidak diketahui",
      time: f.properties.time,
      url: f.properties.url,
      tsunami: !!f.properties.tsunami,
      alert: f.properties.alert,
    }))
    .sort((a, b) => b.time - a.time);
}
export function quakeColor(m) {
  if (m >= 7) return "#b23dff";
  if (m >= 5.5) return "#e8304d";
  if (m >= 4) return "#f06a2a";
  return "#f0a020";
}
export const quakeHeight = m => 0.012 + Math.pow(Math.max(0, m - 2), 1.6) * 0.012;

/* ---------- natural events: NASA EONET ---------- */
export const EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=400";
export const EONET_CATS = {
  wildfires: { label: "Kebakaran", color: "#ff8a3d", icon: "🔥" },
  volcanoes: { label: "Gunung api", color: "#e8304d", icon: "🌋" },
  severeStorms: { label: "Badai", color: "#8a7cff", icon: "🌀" },
  floods: { label: "Banjir", color: "#2f8cff", icon: "🌊" },
  seaLakeIce: { label: "Es laut/danau", color: "#3cc6e6", icon: "🧊" },
  drought: { label: "Kekeringan", color: "#c9a227", icon: "☀️" },
  dustHaze: { label: "Debu & asap", color: "#b8a07a", icon: "🌫️" },
  landslides: { label: "Longsor", color: "#a0703c", icon: "⛰️" },
  snow: { label: "Salju", color: "#9fb8cc", icon: "❄️" },
  tempExtremes: { label: "Suhu ekstrem", color: "#ff5fa2", icon: "🌡️" },
  earthquakes: { label: "Gempa", color: "#f06a2a", icon: "〰️" },
  manmade: { label: "Ulah manusia", color: "#9aa5b1", icon: "🏭" },
  waterColor: { label: "Warna air", color: "#2fb5a0", icon: "💧" },
};
function centroid(coords) {
  // Polygon: [[[lon,lat],...]] -> average of the outer ring
  const ring = coords[0];
  let x = 0, y = 0;
  for (const [lo, la] of ring) { x += lo; y += la; }
  return [x / ring.length, y / ring.length];
}
export async function getEonet() {
  const j = await fetchJSON(EONET_URL, { timeout: 25000 });
  return j.events.map(e => {
    const g = e.geometry[e.geometry.length - 1];
    if (!g) return null;
    const [lon, lat] = g.type === "Point" ? g.coordinates : centroid(g.coordinates);
    const cat = e.categories?.[0]?.id || "manmade";
    return {
      id: e.id, title: e.title, cat,
      catLabel: EONET_CATS[cat]?.label || e.categories?.[0]?.title || "Peristiwa",
      color: EONET_CATS[cat]?.color || "#e6c229",
      icon: EONET_CATS[cat]?.icon || "📍",
      lat, lon, date: g.date,
      mag: g.magnitudeValue != null ? `${g.magnitudeValue} ${g.magnitudeUnit || ""}`.trim() : "",
      url: e.sources?.[0]?.url || e.link,
      steps: e.geometry.length,
    };
  }).filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date));
}

/* ---------- International Space Station: wheretheiss.at ---------- */
const ISS = "https://api.wheretheiss.at/v1/satellites/25544";
export async function getISS() {
  const j = await fetchJSON(ISS, { timeout: 8000 });
  return { lat: j.latitude, lon: j.longitude, altKm: j.altitude, velKmh: j.velocity, visibility: j.visibility, ts: j.timestamp * 1000 };
}
/** Ground track from 50 min ago to 40 min ahead (10 samples, the API maximum). */
export async function getISSPath() {
  const now = Math.floor(Date.now() / 1000);
  const ts = Array.from({ length: 10 }, (_, i) => now + (i - 5) * 600);
  const j = await fetchJSON(`${ISS}/positions?timestamps=${ts.join(",")}&units=kilometers`, { timeout: 10000 });
  return j.map(p => ({ lat: p.latitude, lon: p.longitude, altKm: p.altitude, ts: p.timestamp * 1000 }));
}

/* ---------- Tor exit relays: Tor Project Onionoo ---------- */
const ONIONOO = "https://onionoo.torproject.org/details?type=relay&running=true&flag=Exit&fields=country,observed_bandwidth";
export async function getTorExits() {
  const j = await fetchJSON(ONIONOO, { timeout: 25000 });
  const by = new Map();
  let bw = 0;
  for (const r of j.relays) {
    const cc = (r.country || "??").toUpperCase();
    const e = by.get(cc) || { cc, count: 0, bw: 0 };
    e.count++;
    e.bw += r.observed_bandwidth || 0;
    bw += r.observed_bandwidth || 0;
    by.set(cc, e);
  }
  const countries = [...by.values()].filter(c => c.cc !== "??").sort((a, b) => b.count - a.count);
  return { total: j.relays.length, countries, bw, published: j.relays_published };
}

/* ---------- geomagnetic activity: NOAA SWPC ---------- */
const KP = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json";
export async function getKp() {
  const j = await fetchJSON(KP);
  const last = j[j.length - 1];
  const kp = Number(last.estimated_kp ?? last.kp_index ?? parseFloat(last.kp));
  return { kp, time: last.time_tag + (last.time_tag.endsWith("Z") ? "" : "Z"), ...kpLabel(kp) };
}
export function kpLabel(kp) {
  if (kp >= 9) return { label: "Badai G5 · ekstrem", level: 5 };
  if (kp >= 8) return { label: "Badai G4 · parah", level: 4 };
  if (kp >= 7) return { label: "Badai G3 · kuat", level: 3 };
  if (kp >= 6) return { label: "Badai G2 · sedang", level: 2 };
  if (kp >= 5) return { label: "Badai G1 · minor", level: 1 };
  if (kp >= 4) return { label: "Aktif", level: 0 };
  return { label: "Tenang", level: 0 };
}

/* ---------- security advisories: GitHub Advisory Database ---------- */
const GHSA = "https://api.github.com/advisories?type=reviewed&sort=published&direction=desc&per_page=15";
export async function getAdvisories() {
  const j = await fetchJSON(GHSA, { headers: { Accept: "application/vnd.github+json" } });
  return j.map(a => ({
    id: a.ghsa_id, cve: a.cve_id, summary: a.summary, severity: a.severity || "unknown",
    published: a.published_at, url: a.html_url,
    cvss: a.cvss?.score ?? a.cvss_severities?.cvss_v4?.score ?? a.cvss_severities?.cvss_v3?.score ?? null,
    pkgs: (a.vulnerabilities || []).map(v => v.package && `${v.package.ecosystem}/${v.package.name}`).filter(Boolean),
  }));
}

/* ---------- actively exploited CVEs: CISA KEV (mirrored on GitHub by CISA) ---------- */
const KEV = "https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json";
export async function getKEV() {
  const j = await fetchJSON(KEV, { timeout: 30000 });
  const v = j.vulnerabilities || [];
  const since = Date.now() - 30 * 864e5;
  const sorted = [...v].sort((a, b) => (b.dateAdded > a.dateAdded ? 1 : b.dateAdded < a.dateAdded ? -1 : 0));
  return {
    total: v.length,
    recent30: v.filter(x => new Date(x.dateAdded).getTime() >= since).length,
    ransomware: v.filter(x => x.knownRansomwareCampaignUse === "Known").length,
    released: j.dateReleased,
    latest: sorted.slice(0, 12).map(x => ({
      cve: x.cveID, vendor: x.vendorProject, product: x.product, name: x.vulnerabilityName,
      added: x.dateAdded, due: x.dueDate, ransomware: x.knownRansomwareCampaignUse === "Known",
    })),
  };
}

/* ---------- my own public GitHub activity ---------- */
export async function getGitHubEvents(user) {
  const j = await fetchJSON(`https://api.github.com/users/${user}/events/public?per_page=20`, { headers: { Accept: "application/vnd.github+json" } });
  const verb = {
    PushEvent: e => {
      const n = e.payload.size ?? e.payload.commits?.length;
      const ref = (e.payload.ref || "").replace("refs/heads/", "");
      return n ? `push ${n} commit` : `push ke ${ref || "repo"}`;
    },
    CreateEvent: e => `membuat ${e.payload.ref_type}${e.payload.ref ? " " + e.payload.ref : ""}`,
    PullRequestEvent: e => `${e.payload.action} pull request #${e.payload.number}`,
    IssuesEvent: e => `${e.payload.action} issue #${e.payload.issue?.number}`,
    IssueCommentEvent: () => "berkomentar di issue",
    WatchEvent: () => "memberi bintang",
    ForkEvent: () => "fork repositori",
    ReleaseEvent: e => `rilis ${e.payload.release?.tag_name || ""}`,
    PublicEvent: () => "membuka repositori ke publik",
    DeleteEvent: e => `menghapus ${e.payload.ref_type} ${e.payload.ref || ""}`,
  };
  return j.map(e => ({
    id: e.id, type: e.type, repo: e.repo.name, time: e.created_at,
    text: (verb[e.type] || (() => e.type.replace(/Event$/, "")))(e),
    url: `https://github.com/${e.repo.name}`,
  }));
}

/* ---------- the visitor's own connection (opt-in) ---------- */
export async function getMyIP() {
  try {
    const j = await fetchJSON("https://ipwho.is/", { timeout: 10000 });
    if (j.success === false) throw new Error(j.message || "ipwho.is gagal");
    return {
      source: "ipwho.is", ip: j.ip, type: j.type, city: j.city, region: j.region, country: j.country, cc: j.country_code,
      lat: j.latitude, lon: j.longitude, isp: j.connection?.isp, org: j.connection?.org, asn: j.connection?.asn,
      tz: j.timezone?.id,
    };
  } catch (_) {
    const j = await fetchJSON("https://ipapi.co/json/", { timeout: 10000 });
    if (j.error) throw new Error(j.reason || "ipapi.co gagal");
    return {
      source: "ipapi.co", ip: j.ip, type: j.version, city: j.city, region: j.region, country: j.country_name, cc: j.country_code,
      lat: j.latitude, lon: j.longitude, isp: j.org, org: j.org, asn: (j.asn || "").replace(/^AS/, ""), tz: j.timezone,
    };
  }
}

/** What any website can read from this browser without asking — computed locally, never sent. */
export function localFingerprint() {
  const n = navigator;
  let gpu = "";
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) || "";
  } catch (_) { /* ignore */ }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const off = -new Date().getTimezoneOffset();
  const offStr = `UTC${off >= 0 ? "+" : "−"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
  const uaPlatform = n.userAgentData?.platform || n.platform || "";
  const brands = n.userAgentData?.brands?.filter(b => !/Not.?A.?Brand/i.test(b.brand)).map(b => `${b.brand} ${b.version}`).join(", ");
  return [
    ["Zona waktu", `${tz} (${offStr})`],
    ["Bahasa", (n.languages || [n.language]).join(", ")],
    ["Platform", uaPlatform || "—"],
    ["Browser", brands || n.userAgent.split(") ").pop()],
    ["Layar", `${screen.width}×${screen.height} @${devicePixelRatio}x, ${screen.colorDepth}-bit`],
    ["Jendela", `${innerWidth}×${innerHeight}`],
    ["Inti CPU", n.hardwareConcurrency ? String(n.hardwareConcurrency) : "—"],
    ["Memori", n.deviceMemory ? `≥ ${n.deviceMemory} GB` : "—"],
    ["GPU", gpu || "—"],
    ["Layar sentuh", n.maxTouchPoints > 0 ? `Ya (${n.maxTouchPoints} titik)` : "Tidak"],
    ["Jaringan", n.connection?.effectiveType ? `${n.connection.effectiveType}${n.connection.downlink ? `, ~${n.connection.downlink} Mbps` : ""}` : "—"],
    ["Do Not Track / GPC", `${n.doNotTrack === "1" ? "DNT aktif" : "DNT mati"} · ${n.globalPrivacyControl ? "GPC aktif" : "GPC mati"}`],
    ["Cookie", n.cookieEnabled ? "Diizinkan" : "Diblokir"],
  ];
}
