// Client for the Internet Archive Wayback Machine's public APIs.
// Docs: https://archive.org/help/wayback_api.php and
//       https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server
// Everything is queried straight from the browser; nothing passes through a server of ours.

const WB = "https://web.archive.org";
const CDX = `${WB}/cdx/search/cdx`;

export class WaybackError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function get(url, { timeout = 45000, as = "json" } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, { signal: ctl.signal });
  } catch (err) {
    clearTimeout(t);
    if (err.name === "AbortError") throw new WaybackError("Waktu habis — server Wayback lambat merespons. Coba lagi atau persempit rentangnya.", 0);
    throw new WaybackError("Tidak dapat menghubungi Wayback Machine (jaringan, pemblokir, atau CORS).", 0);
  }
  clearTimeout(t);
  if (res.status === 429) throw new WaybackError("Wayback Machine membatasi jumlah permintaan (429). Tunggu ±1 menit lalu coba lagi.", 429);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new WaybackError(`Wayback Machine mengembalikan HTTP ${res.status}${txt ? ": " + txt.slice(0, 160) : ""}`, res.status);
  }
  return as === "text" ? res.text() : res.json();
}

/* ---------- small helpers ---------- */
/** Turn whatever the user typed into the pieces the APIs need. */
export function parseTarget(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "http://" + s;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (!u.hostname || !u.hostname.includes(".")) return null;
  const host = u.hostname.toLowerCase();
  const path = (u.pathname || "/") + (u.search || "");
  const isRoot = path === "/" || path === "";
  return {
    host,
    domain: host.replace(/^www\./, ""),
    path,
    isRoot,
    // canonical, scheme-less form used for display and for "exact" lookups
    url: host + (isRoot ? "" : path),
    full: u.href,
  };
}

/** Wayback 14-digit timestamp <-> Date */
export function tsToDate(ts) {
  const s = String(ts).padEnd(14, "0");
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)));
}
export function dateToTs(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/* ---------- links into the Wayback Machine UI ---------- */
export const links = {
  snapshot: (ts, url) => `${WB}/web/${ts}/${url}`,
  raw: (ts, url) => `${WB}/web/${ts}id_/${url}`,
  frame: (ts, url) => `${WB}/web/${ts}if_/${url}`,
  calendar: url => `${WB}/web/*/${url}`,
  urls: url => `${WB}/web/*/${url}*`,
  changes: url => `${WB}/web/changes/${url}`,
  sitemap: url => `${WB}/web/sitemap/${url}`,
  summary: url => `${WB}/details/${url}`,
  collections: url => `${WB}/web/collections/*/${url}`,
  diff: (a, b, url) => `${WB}/web/diff/${a}/${b}/${url}`,
  save: url => `${WB}/save/${url}`,
};

/* ---------- CDX server ---------- */
/**
 * Query the CDX server. params values may be arrays (e.g. several `filter`s).
 * Returns { header, rows: [{field: value}], resumeKey }.
 */
export async function cdx(params, opts) {
  const q = new URLSearchParams({ output: "json" });
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) v.forEach(x => q.append(k, x));
    else q.append(k, String(v));
  }
  const data = await get(`${CDX}?${q}`, opts);
  if (!Array.isArray(data) || !data.length) return { header: [], rows: [], resumeKey: null };
  let resumeKey = null;
  let body = data.slice(1);
  // with showResumeKey the response ends with: [], ["<resume key>"]
  if (params.showResumeKey && body.length >= 2 && body[body.length - 2].length === 0) {
    resumeKey = body[body.length - 1][0];
    body = body.slice(0, -2);
  }
  const header = [...data[0]];
  // some CDX builds append skipcount/endtimestamp columns without naming them in the header row
  const width = body.reduce((w, r) => Math.max(w, r.length), 0);
  if (width > header.length && params.showSkipCount) header.push("skipcount");
  if (width > header.length && params.lastSkipTimestamp) header.push("endtimestamp");
  const rows = body.filter(r => r.length).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  return { header, rows, resumeKey };
}

/* ---------- availability API ---------- */
/** Closest snapshot to `timestamp` (or the newest when omitted). */
export async function closest(url, timestamp) {
  const q = new URLSearchParams({ url });
  if (timestamp) q.set("timestamp", timestamp);
  const j = await get(`https://archive.org/wayback/available?${q}`, { timeout: 20000 });
  const c = j?.archived_snapshots?.closest;
  return c && c.available ? { ts: c.timestamp, status: c.status, url: c.url } : null;
}

/* ---------- first / last capture ---------- */
export async function firstCapture(url) {
  const r = await cdx({ url, fl: "timestamp,statuscode,original", limit: 1 }, { timeout: 30000 });
  return r.rows[0] || null;
}
export async function lastCapture(url) {
  const r = await cdx({ url, fl: "timestamp,statuscode,original", limit: -1, fastLatest: "true" }, { timeout: 30000 });
  return r.rows[r.rows.length - 1] || null;
}

/* ---------- capture counts per month ---------- */
/**
 * Monthly capture counts: { years: { "2014": [12 numbers] }, total, approx, source }.
 * Uses the sparkline endpoint the Wayback calendar uses; falls back to the CDX server.
 */
export async function monthlyCounts(url) {
  try {
    const j = await get(`${WB}/__wb/sparkline?output=json&collection=web&url=${encodeURIComponent(url)}`, { timeout: 25000 });
    if (j && j.years && Object.keys(j.years).length) {
      const years = {};
      let total = 0;
      for (const [y, arr] of Object.entries(j.years)) {
        years[y] = arr.slice(0, 12).map(n => +n || 0);
        total += years[y].reduce((a, b) => a + b, 0);
      }
      return { years, total, approx: false, source: "sparkline", first: j.first_ts, last: j.last_ts };
    }
    if (j && j.years) return { years: {}, total: 0, approx: false, source: "sparkline" };
  } catch (_) { /* fall back to CDX below */ }

  // One row per month; skipcount (when supported) says how many captures were collapsed into it.
  const r = await cdx({ url, fl: "timestamp", collapse: "timestamp:6", showSkipCount: "true" }, { timeout: 60000 });
  const years = {};
  let total = 0, approx = true;
  for (const row of r.rows) {
    const y = row.timestamp.slice(0, 4), m = +row.timestamp.slice(4, 6) - 1;
    const n = row.skipcount != null ? +row.skipcount + 1 : 1;
    if (row.skipcount != null) approx = false;
    (years[y] ||= Array(12).fill(0))[m] += n;
    total += n;
  }
  return { years, total, approx, source: "cdx" };
}

/* ---------- calendar ---------- */
/** Captures per day for one year: Map("YYYYMMDD" -> {count, status}). */
export async function yearDays(url, year) {
  const r = await cdx({
    url, from: String(year), to: String(year), fl: "timestamp,statuscode",
    collapse: "timestamp:8", showSkipCount: "true",
  }, { timeout: 60000 });
  const days = new Map();
  let approx = true;
  for (const row of r.rows) {
    const n = row.skipcount != null ? +row.skipcount + 1 : 1;
    if (row.skipcount != null) approx = false;
    days.set(row.timestamp.slice(0, 8), { count: n, status: row.statuscode });
  }
  return { days, approx };
}
/** Every capture of a URL on one day. */
export async function dayCaptures(url, ymd) {
  const r = await cdx({ url, from: ymd, to: ymd, fl: "timestamp,original,statuscode,mimetype,length,digest", limit: 1000 }, { timeout: 30000 });
  return r.rows;
}

/* ---------- changes ---------- */
/** Captures where the content changed (adjacent duplicates by digest collapsed). */
export async function contentVersions(url, from, to, limit = 3000) {
  const r = await cdx({
    url, from, to, fl: "timestamp,statuscode,digest,length,mimetype", collapse: "digest",
    filter: "!statuscode:[45]..", limit,
  }, { timeout: 60000 });
  return r.rows;
}

/* ---------- URLs under a site ---------- */
/**
 * Unique archived URLs. matchType: exact | prefix | host | domain.
 * The timestamp/status/mimetype returned belong to the first capture of each URL.
 */
export async function archivedUrls(url, matchType, { limit = 5000, resumeKey = null, filters = [] } = {}) {
  return cdx({
    url, matchType, collapse: "urlkey", fl: "original,mimetype,statuscode,timestamp,length",
    filter: filters, limit, showResumeKey: "true", resumeKey,
  }, { timeout: 90000 });
}

/* ---------- robots.txt history ---------- */
export async function robotsVersions(host) {
  const r = await cdx({ url: `${host}/robots.txt`, fl: "timestamp,original,statuscode,digest,length", collapse: "digest", filter: "statuscode:200", limit: 200 }, { timeout: 30000 });
  return r.rows;
}

/** Raw archived body of a capture (best effort — depends on the archive's CORS headers). */
export async function snapshotText(ts, url, timeout = 30000) {
  return get(links.raw(ts, url), { timeout, as: "text" });
}

/* ---------- analysis helpers (pure) ---------- */
export const MIME_GROUPS = [
  ["html", "HTML", m => /html|xhtml/.test(m)],
  ["script", "JavaScript", m => /javascript|ecmascript/.test(m)],
  ["css", "CSS", m => /css/.test(m)],
  ["image", "Gambar", m => m.startsWith("image/")],
  ["doc", "Dokumen", m => /pdf|msword|officedocument|opendocument|rtf|ms-excel|ms-powerpoint|epub/.test(m)],
  ["data", "Data", m => /json|xml|csv|yaml|rss|atom/.test(m) && !/xhtml/.test(m)],
  ["media", "Audio/Video", m => /^(audio|video)\//.test(m)],
  ["archive", "Arsip", m => /zip|tar|gzip|rar|7z|x-bzip|octet-stream/.test(m)],
];
export function mimeGroup(m = "") {
  m = m.toLowerCase();
  for (const [id, , test] of MIME_GROUPS) if (test(m)) return id;
  return "other";
}

const INTERESTING = [
  ["Dokumen", /\.(pdf|docx?|xlsx?|pptx?|odt|ods|rtf|csv)(\?|$)/i],
  ["Backup & arsip", /\.(zip|tar|tgz|gz|rar|7z|bak|old|backup|swp|sql|dump)(\?|$)/i],
  ["Konfigurasi & rahasia", /(\.env|\.git\/|\.svn\/|\.htaccess|\.htpasswd|web\.config|config\.(php|json|ya?ml|js)|\.ini|\.conf|\.pem|\.key|id_rsa|credentials|secrets?\.)/i],
  ["Data & API", /\.(json|xml|ya?ml|graphql)(\?|$)|\/(api|graphql|rest|v\d)\//i],
  ["Log & debug", /\.(log|trace)(\?|$)|phpinfo|debug|\/server-status/i],
  ["Panel admin & login", /\/(admin|administrator|wp-admin|wp-login|login|signin|dashboard|cpanel|phpmyadmin|manager)(\/|\.|\?|$)/i],
];
/** Group URLs by "interesting for an investigator" categories. */
export function interestingFiles(rows) {
  const out = INTERESTING.map(([label]) => ({ label, items: [] }));
  for (const r of rows) {
    const u = r.original;
    INTERESTING.forEach(([, re], i) => { if (re.test(u) && out[i].items.length < 400) out[i].items.push(r); });
  }
  return out.filter(g => g.items.length);
}

/** Query-string parameter names seen across URLs. */
export function paramStats(rows) {
  const m = new Map();
  for (const r of rows) {
    const q = r.original.indexOf("?");
    if (q < 0) continue;
    for (const part of r.original.slice(q + 1).split("&")) {
      const k = decodeURIComponentSafe(part.split("=")[0]).trim();
      if (!k || k.length > 60) continue;
      const e = m.get(k) || { name: k, count: 0, sample: r.original };
      e.count++;
      m.set(k, e);
    }
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (_) { return s; } }

/** Hostnames seen across URLs. */
export function hostStats(rows) {
  const m = new Map();
  for (const r of rows) {
    let h;
    try { h = new URL(r.original.startsWith("http") ? r.original : "http://" + r.original).hostname.toLowerCase(); } catch (_) { continue; }
    h = h.replace(/:\d+$/, "");
    const e = m.get(h) || { host: h, count: 0, first: r.timestamp };
    e.count++;
    if (r.timestamp < e.first) e.first = r.timestamp;
    m.set(h, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

/** Parse robots.txt into rules. */
export function parseRobots(text) {
  const rules = [];
  let agent = "*";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^(user-agent|disallow|allow|sitemap|crawl-delay)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") agent = v;
    else if (v) rules.push({ type: k, value: v, agent });
  }
  return rules;
}

/** Visible text of an HTML document, one block per line (for diffing). */
export function visibleText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,template,svg").forEach(n => n.remove());
  // drop the Wayback toolbar if a non-raw capture slipped through
  doc.querySelectorAll("#wm-ipp-base,#wm-ipp,#donato").forEach(n => n.remove());
  const root = doc.body || doc.documentElement;
  // detached documents have no layout, so mark block boundaries by hand before reading textContent
  root.querySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6,tr,br,section,article,header,footer,nav,aside,main,td,th,pre,blockquote,dt,dd,figcaption,option,a")
    .forEach(el => el.append("\n"));
  const lines = root.textContent.split(/\n+/).map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  const title = doc.title?.trim();
  return title ? [`[judul] ${title}`, ...lines] : lines;
}

/** Line diff (Myers, O(ND)). Returns [{t: "=", "+", "-", s}] */
export function diffLines(a, b, maxD = 1000) {
  const n = a.length, m = b.length, max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace = [];
  let found = false;
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[max + k - 1] < v[max + k + 1])) ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[max + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
    if (found) break;
  }
  if (!found) return null; // too different to diff cheaply
  const out = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d], k = x - y;
    const prevK = (k === -d || (k !== d && vv[max + k - 1] < vv[max + k + 1])) ? k + 1 : k - 1;
    const px = vv[max + prevK], py = px - prevK;
    while (x > px && y > py) out.push({ t: "=", s: a[--x] }), y--;
    if (d > 0) { if (x === px) out.push({ t: "+", s: b[--y] }); else out.push({ t: "-", s: a[--x] }); }
  }
  return out.reverse();
}
