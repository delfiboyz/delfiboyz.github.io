// Interactive 3D globe built on three.js.
// Everything lives in an Earth-fixed frame: the camera orbits, the planet does not spin,
// so the real-time sun direction (day/night) stays correct while the view rotates.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, BufferGeometry, Float32BufferAttribute,
  Points, ShaderMaterial, Mesh, SphereGeometry, Color, Vector3, Vector2, BackSide,
  InstancedMesh, CylinderGeometry, Matrix4, Quaternion, RingGeometry, DoubleSide, Line,
  LineBasicMaterial, LineDashedMaterial, MeshBasicMaterial, MeshLambertMaterial,
  HemisphereLight, DirectionalLight, OctahedronGeometry, ColorManagement, LinearSRGBColorSpace,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LAND_W, LAND_H, LAND_B64 } from "./geo-data.js";

const DEG = Math.PI / 180;
const EARTH_KM = 6371;
const UP = new Vector3(0, 1, 0);
// Colours are authored as plain sRGB hex values and written straight to the screen.
ColorManagement.enabled = false;

/* ---------- geo helpers ---------- */
export function toVec(lat, lon, alt = 0, out = new Vector3()) {
  const r = 1 + alt;
  const la = lat * DEG, lo = lon * DEG;
  return out.set(Math.cos(la) * Math.sin(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.cos(lo) * r);
}
export function kmToAlt(km) { return km / EARTH_KM; }

/** Sub-solar point (where the sun is overhead) for a date, ~0.1° accuracy. */
export function subsolar(date = new Date()) {
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5;
  const g = (357.529 + 0.98560028 * d) * DEG;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  let lon = (ra / DEG / 15 - gmst) * 15;
  lon = ((lon + 540) % 360) - 180;
  return { lat: dec / DEG, lon };
}

/** Is a lat/lon on land according to the bundled 0.5° mask? */
const landBits = (() => {
  const bin = atob(LAND_B64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
})();
export function isLand(lat, lon) {
  const x = Math.min(LAND_W - 1, Math.max(0, Math.floor((lon + 180) / 360 * LAND_W)));
  const y = Math.min(LAND_H - 1, Math.max(0, Math.floor((90 - lat) / 180 * LAND_H)));
  const i = y * LAND_W + x;
  return (landBits[i >> 3] >> (i & 7)) & 1;
}

/* ---------- shaders ---------- */
const dotVert = /* glsl */`
  uniform float uSize;
  uniform float uScale;
  uniform vec3 uSun;
  attribute float aRand;
  varying float vLight;
  varying float vRand;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uScale / -mv.z;
    vLight = dot(normalize(position), uSun);
    vRand = aRand;
  }`;
const dotFrag = /* glsl */`
  uniform vec3 uDay;
  uniform vec3 uNight;
  uniform vec3 uCity;
  uniform float uCityAmt;
  uniform float uTime;
  varying float vLight;
  varying float vRand;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.32, d);
    float day = smoothstep(-0.12, 0.18, vLight);
    vec3 col = mix(uNight, uDay, day);
    // a few twinkling "city lights" on the night side
    float lit = step(0.965, vRand) * (1.0 - day) * (0.65 + 0.35 * sin(uTime * 1.7 + vRand * 80.0));
    col = mix(col, uCity, lit * uCityAmt);
    gl_FragColor = vec4(col, a);
  }`;

const oceanVert = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vWorld = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const oceanFrag = /* glsl */`
  uniform vec3 uOcean;
  uniform vec3 uRim;
  uniform vec3 uSun;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    float rim = pow(1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 2.5);
    float day = smoothstep(-0.2, 0.35, dot(vWorld, uSun));
    vec3 col = uOcean * (0.78 + 0.22 * day);
    col = mix(col, uRim, rim * 0.55);
    gl_FragColor = vec4(col, 1.0);
  }`;

const atmoVert = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const atmoFrag = /* glsl */`
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // back faces: dot is ~-0.5 right at the planet's limb and 0 at the outer edge of the shell
    float d = clamp(-dot(normalize(vNormal), normalize(vView)) * 1.5, 0.0, 1.0);
    float i = pow(d, 2.6);
    gl_FragColor = vec4(uColor, clamp(i * uStrength, 0.0, 1.0));
  }`;

const markVert = /* glsl */`
  uniform float uScale;
  uniform float uTime;
  attribute vec3 color;
  attribute float size;
  attribute float phase;
  varying vec3 vColor;
  varying float vFacing;
  varying float vPulse;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vec3 n = normalize((modelViewMatrix * vec4(normalize(position), 0.0)).xyz);
    vFacing = smoothstep(-0.05, 0.25, dot(n, normalize(-mv.xyz)));
    vPulse = 0.5 + 0.5 * sin(uTime * 2.6 + phase * 6.2831);
    gl_PointSize = size * uScale / -mv.z;
    vColor = color;
  }`;
const markFrag = /* glsl */`
  varying vec3 vColor;
  varying float vFacing;
  varying float vPulse;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0 || vFacing < 0.01) discard;
    float core = smoothstep(0.42, 0.28, d);
    float ring = smoothstep(0.08, 0.0, abs(d - (0.62 + 0.3 * vPulse))) * (1.0 - vPulse * 0.6);
    float halo = (1.0 - d) * 0.35;
    float a = max(core, max(ring, halo)) * vFacing;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.25), a);
  }`;

/* ---------- globe ---------- */
/**
 * @param {HTMLElement} container
 * @param {object} opts
 *   dots: number of points on the full sphere used to sample land (default 60000)
 *   interactive: allow drag/zoom
 *   zoom: allow wheel/pinch zoom
 *   autoRotate: rotate when idle
 *   fit: framing factor (1 = globe+atmosphere fills the shorter side)
 *   view: {lat, lon} initial view
 *   tooltip: (data) => html string, enables hover tooltips on markers
 *   onSelect: (data) => void, click/tap on a marker
 *   cityLights: decorative twinkling dots on the night side (default true)
 */
export function createGlobe(container, opts = {}) {
  const o = {
    dots: 60000, interactive: true, zoom: true, autoRotate: true, autoRotateSpeed: 0.55,
    fit: 1, view: { lat: 10, lon: 110 }, tooltip: null, onSelect: null, cityLights: true, ...opts,
  };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = LinearSRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = "globe-canvas";
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.05, 100);
  const world = new Group();
  scene.add(world);
  const t0 = performance.now();
  let last = t0;

  const hemi = new HemisphereLight(0xffffff, 0x445566, 2.2);
  scene.add(hemi);
  const key = new DirectionalLight(0xffffff, 2.0);
  camera.add(key);
  key.position.set(1, 1.5, 2);
  scene.add(camera);

  /* sun */
  const sun = new Vector3();
  function updateSun() {
    const s = subsolar(new Date());
    toVec(s.lat, s.lon, 0, sun).normalize();
  }
  updateSun();

  /* ocean sphere */
  const oceanMat = new ShaderMaterial({
    vertexShader: oceanVert, fragmentShader: oceanFrag,
    uniforms: { uOcean: { value: new Color() }, uRim: { value: new Color() }, uSun: { value: sun } },
  });
  const ocean = new Mesh(new SphereGeometry(0.994, 96, 64), oceanMat);
  world.add(ocean);

  /* land dots (Fibonacci sphere sampled against land mask) */
  const pos = [], rnd = [];
  const N = o.dots, golden = Math.PI * (3 - Math.sqrt(5));
  const v = new Vector3();
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + 0.5) * 2 / N;
    const r = Math.sqrt(1 - y * y);
    const t = i * golden;
    v.set(Math.cos(t) * r, y, Math.sin(t) * r);
    const lat = Math.asin(v.y) / DEG;
    const lon = Math.atan2(v.x, v.z) / DEG;
    if (!isLand(lat, lon)) continue;
    pos.push(v.x, v.y, v.z);
    rnd.push(Math.random());
  }
  const dotGeo = new BufferGeometry();
  dotGeo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  dotGeo.setAttribute("aRand", new Float32BufferAttribute(rnd, 1));
  const spacing = Math.sqrt(4 * Math.PI / N);
  const dotMat = new ShaderMaterial({
    vertexShader: dotVert, fragmentShader: dotFrag, transparent: true, depthWrite: false,
    uniforms: {
      uSize: { value: spacing * 0.62 }, uScale: { value: 500 }, uSun: { value: sun }, uTime: { value: 0 },
      uDay: { value: new Color() }, uNight: { value: new Color() }, uCity: { value: new Color("#ffd27a") },
      uCityAmt: { value: o.cityLights ? 1 : 0 },
    },
  });
  const landDots = new Points(dotGeo, dotMat);
  world.add(landDots);

  /* atmosphere */
  const atmoMat = new ShaderMaterial({
    vertexShader: atmoVert, fragmentShader: atmoFrag, side: BackSide, transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new Color() }, uStrength: { value: 1.6 } },
  });
  const atmo = new Mesh(new SphereGeometry(1.18, 64, 48), atmoMat);
  scene.add(atmo);

  /* camera + controls */
  const dir0 = toVec(o.view.lat, o.view.lon).normalize();
  let baseDist = 3;
  camera.position.copy(dir0).multiplyScalar(baseDist);
  camera.lookAt(0, 0, 0);

  let controls = null;
  if (o.interactive) {
    controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.6;
    controls.enableZoom = !!o.zoom;
    controls.autoRotate = o.autoRotate && !reduceMotion;
    controls.autoRotateSpeed = o.autoRotateSpeed;
    if (!o.zoom) canvas.style.touchAction = "pan-y";
  }
  let idleTimer = 0;
  function pauseAutoRotate(ms = 6000) {
    if (!controls || !o.autoRotate || reduceMotion) return;
    controls.autoRotate = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { controls.autoRotate = true; }, ms);
  }
  controls?.addEventListener("start", () => { pauseAutoRotate(8000); flight = null; });

  /* ---------- marker layers ---------- */
  const layers = new Map(); // id -> { group, items, visible, kind }
  const pickables = []; // rebuilt from layers: {pos:Vector3, data}
  let pickDirty = true;

  function layer(id) {
    let L = layers.get(id);
    if (!L) {
      L = { id, group: new Group(), items: [], visible: true, objs: [] };
      world.add(L.group);
      layers.set(id, L);
    }
    return L;
  }
  function clearLayer(L) {
    for (const ob of L.objs) {
      L.group.remove(ob);
      ob.geometry?.dispose();
      ob.material?.dispose();
    }
    L.objs = [];
    L.items = [];
  }

  const markMats = [];
  /** Glowing dots, e.g. events. items: {lat, lon, alt?, color, size?, data} */
  function setPoints(id, items) {
    const L = layer(id);
    clearLayer(L);
    L.items = items.map(it => ({ ...it, pos: toVec(it.lat, it.lon, (it.alt || 0) + 0.004) }));
    if (!items.length) { pickDirty = true; return; }
    const p = [], c = [], s = [], ph = [];
    const col = new Color();
    for (const it of L.items) {
      p.push(it.pos.x, it.pos.y, it.pos.z);
      col.set(it.color);
      c.push(col.r, col.g, col.b);
      s.push((it.size || 1) * 0.034);
      ph.push(Math.random());
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(p, 3));
    g.setAttribute("color", new Float32BufferAttribute(c, 3));
    g.setAttribute("size", new Float32BufferAttribute(s, 1));
    g.setAttribute("phase", new Float32BufferAttribute(ph, 1));
    const m = new ShaderMaterial({
      vertexShader: markVert, fragmentShader: markFrag, transparent: true, depthWrite: false,
      uniforms: { uScale: { value: dotMat.uniforms.uScale.value }, uTime: { value: 0 } },
    });
    markMats.push(m);
    m.addEventListener("dispose", () => markMats.splice(markMats.indexOf(m), 1));
    const pts = new Points(g, m);
    pts.renderOrder = 3;
    L.group.add(pts);
    L.objs.push(pts);
    pickDirty = true;
  }

  /** 3D bars standing on the surface. items: {lat, lon, height, width?, color, data} */
  const barGeo = new CylinderGeometry(1, 1, 1, 8, 1, false);
  barGeo.translate(0, 0.5, 0);
  function setBars(id, items) {
    const L = layer(id);
    for (const ob of L.objs) { L.group.remove(ob); ob.material?.dispose(); ob.dispose?.(); }
    L.objs = [];
    L.items = items.map(it => ({ ...it, pos: toVec(it.lat, it.lon, it.height + 0.002) }));
    if (!items.length) { pickDirty = true; return; }
    const mesh = new InstancedMesh(barGeo, new MeshLambertMaterial({ transparent: true, opacity: 0.92 }), items.length);
    const m = new Matrix4(), q = new Quaternion(), n = new Vector3(), sc = new Vector3(), col = new Color();
    items.forEach((it, i) => {
      toVec(it.lat, it.lon, 0, n).normalize();
      q.setFromUnitVectors(UP, n);
      const w = it.width || 0.0055;
      sc.set(w, Math.max(0.004, it.height), w);
      m.compose(n.clone().multiplyScalar(0.998), q, sc);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(it.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.renderOrder = 2;
    L.group.add(mesh);
    L.objs.push(mesh);
    pickDirty = true;
  }

  /** Polyline following the surface (slerp-interpolated). points: [{lat, lon, alt?}] */
  function makeArcPositions(points, steps = 24) {
    const out = [];
    const a = new Vector3(), b = new Vector3(), tmp = new Vector3();
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i], p1 = points[i + 1];
      toVec(p0.lat, p0.lon, 0, a).normalize();
      toVec(p1.lat, p1.lon, 0, b).normalize();
      const ang = a.angleTo(b);
      for (let k = 0; k <= steps; k++) {
        if (i > 0 && k === 0) continue;
        const t = k / steps;
        if (ang < 1e-6) tmp.copy(a);
        else {
          const s = Math.sin(ang);
          tmp.copy(a).multiplyScalar(Math.sin((1 - t) * ang) / s).addScaledVector(b, Math.sin(t * ang) / s);
        }
        const alt = (p0.alt || 0) + ((p1.alt || 0) - (p0.alt || 0)) * t;
        tmp.normalize().multiplyScalar(1 + alt);
        out.push(tmp.x, tmp.y, tmp.z);
      }
    }
    return out;
  }
  function setPath(id, points, { color = "#ffffff", opacity = 0.8, dashed = false } = {}) {
    const L = layer(id);
    clearLayer(L);
    if (points.length < 2) return;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(makeArcPositions(points), 3));
    const mat = dashed
      ? new LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.02, gapSize: 0.016 })
      : new LineBasicMaterial({ color, transparent: true, opacity });
    const line = new Line(g, mat);
    if (dashed) line.computeLineDistances();
    L.group.add(line);
    L.objs.push(line);
  }

  /** Glowing band ring around an axis (used for the aurora oval). */
  function setBand(id, { lat, lon, radiusDeg, widthDeg = 3, color = "#3ddc97", opacity = 0.35, alt = 0.012 }) {
    const L = layer(id);
    clearLayer(L);
    const P = toVec(lat, lon).normalize();
    const U = new Vector3().crossVectors(P, Math.abs(P.y) < 0.9 ? UP : new Vector3(1, 0, 0)).normalize();
    const V = new Vector3().crossVectors(P, U).normalize();
    const segs = 160, pts = [], idx = [], al = [];
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      for (const [off, alpha] of [[-widthDeg, 0], [0, 1], [widthDeg, 0]]) {
        const th = (radiusDeg + off) * DEG;
        const dir = new Vector3().copy(U).multiplyScalar(Math.cos(a)).addScaledVector(V, Math.sin(a));
        const p = new Vector3().copy(P).multiplyScalar(Math.cos(th)).addScaledVector(dir, Math.sin(th)).multiplyScalar(1 + alt);
        pts.push(p.x, p.y, p.z);
        al.push(alpha);
      }
    }
    for (let k = 0; k < segs; k++) {
      const a = k * 3, b = (k + 1) * 3;
      idx.push(a, b, a + 1, b, b + 1, a + 1, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    g.setAttribute("aAlpha", new Float32BufferAttribute(al, 1));
    g.setIndex(idx);
    const m = new ShaderMaterial({
      transparent: true, depthWrite: false, side: DoubleSide,
      uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: opacity }, uTime: { value: 0 } },
      vertexShader: `attribute float aAlpha; varying float vA; varying vec3 vP;
        void main(){ vA=aAlpha; vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying float vA; varying vec3 vP;
        void main(){ float w = 0.75 + 0.25*sin(uTime*1.3 + atan(vP.x, vP.z)*7.0);
          gl_FragColor = vec4(uColor, vA*vA*uOpacity*w);} `,
    });
    markMats.push(m);
    m.addEventListener("dispose", () => markMats.splice(markMats.indexOf(m), 1));
    const mesh = new Mesh(g, m);
    mesh.renderOrder = 1;
    L.group.add(mesh);
    L.objs.push(mesh);
  }

  /** A single moving object (e.g. ISS), smoothly tweened between updates. */
  const objects = new Map();
  function setObject(id, { lat, lon, alt = 0, color = "#ffffff", data = null, label = "", tween = 0, layer: layerId = null }) {
    let ob = objects.get(id);
    const target = toVec(lat, lon, alt);
    if (!ob) {
      const g = new Group();
      const body = new Mesh(new OctahedronGeometry(0.014, 0), new MeshBasicMaterial({ color }));
      const halo = new Points(
        (() => {
          const bg = new BufferGeometry();
          bg.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3));
          bg.setAttribute("color", new Float32BufferAttribute(new Color(color).toArray(), 3));
          bg.setAttribute("size", new Float32BufferAttribute([0.09], 1));
          bg.setAttribute("phase", new Float32BufferAttribute([0], 1));
          return bg;
        })(),
        new ShaderMaterial({
          vertexShader: markVert, fragmentShader: markFrag, transparent: true, depthWrite: false,
          uniforms: { uScale: { value: dotMat.uniforms.uScale.value }, uTime: { value: 0 } },
        })
      );
      markMats.push(halo.material);
      halo.material.addEventListener("dispose", () => markMats.splice(markMats.indexOf(halo.material), 1));
      g.add(body, halo);
      (layerId ? layer(layerId).group : world).add(g);
      const el = document.createElement("div");
      el.className = "globe-label";
      container.appendChild(el);
      ob = { g, body, el, from: target.clone(), to: target.clone(), t0: 0, dur: 0, data };
      g.position.copy(target);
      objects.set(id, ob);
    }
    ob.from.copy(ob.g.position);
    ob.to.copy(target);
    ob.t0 = performance.now();
    ob.dur = reduceMotion ? 0 : tween;
    ob.data = data;
    ob.lat = lat; ob.lon = lon;
    ob.el.textContent = label;
    ob.el.hidden = !label;
    pickDirty = true;
  }
  function removeObject(id) {
    const ob = objects.get(id);
    if (!ob) return;
    ob.g.parent?.remove(ob.g);
    ob.g.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
    ob.el.remove();
    objects.delete(id);
    pickDirty = true;
  }

  /** Expanding ring on the surface. */
  const pulses = new Set();
  const ringGeo = new RingGeometry(0.86, 1, 64);
  function pulse(lat, lon, { color = "#ffffff", size = 0.08, duration = 2200, repeat = 1, id = null, layer: layerId = null } = {}) {
    if (reduceMotion && repeat !== Infinity) repeat = 1;
    const m = new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false });
    const mesh = new Mesh(ringGeo, m);
    const p = toVec(lat, lon, 0.003);
    mesh.position.copy(p);
    mesh.lookAt(p.clone().multiplyScalar(2));
    mesh.renderOrder = 4;
    (layerId ? layer(layerId).group : world).add(mesh);
    const P = { mesh, t0: performance.now(), duration, size, repeat, id };
    pulses.add(P);
    return P;
  }
  function stopPulse(id) {
    for (const P of pulses) if (P.id === id) { P.mesh.parent?.remove(P.mesh); P.mesh.material.dispose(); pulses.delete(P); }
  }

  function setVisible(id, vis) {
    const L = layer(id);
    L.visible = vis;
    L.group.visible = vis;
    pickDirty = true;
  }

  /* ---------- camera flights ---------- */
  let flight = null;
  function flyTo(lat, lon, { dist = null, duration = 1400 } = {}) {
    const from = camera.position.clone();
    const r0 = from.length();
    const r1 = dist ?? Math.min(r0, baseDist * 0.82);
    const to = toVec(lat, lon).normalize();
    flight = { from: from.normalize(), to, r0, r1, t0: performance.now(), duration: reduceMotion ? 1 : duration };
    pauseAutoRotate(12000);
  }

  /* ---------- picking + tooltip ---------- */
  let tipEl = null;
  if (o.tooltip || o.onSelect) {
    tipEl = document.createElement("div");
    tipEl.className = "globe-tip";
    tipEl.hidden = true;
    container.appendChild(tipEl);
  }
  function rebuildPickables() {
    pickables.length = 0;
    for (const L of layers.values()) {
      if (!L.visible) continue;
      for (const it of L.items) if (it.data) pickables.push({ pos: it.pos, data: it.data });
    }
    for (const ob of objects.values()) if (ob.data && ob.g.parent?.visible !== false) pickables.push({ pos: ob.g.position, data: ob.data, live: true });
    pickDirty = false;
  }
  const proj = new Vector3(), camDir = new Vector3(), nrm = new Vector3();
  function pick(clientX, clientY, radius) {
    if (pickDirty) rebuildPickables();
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    let best = null, bestD = radius * radius;
    camDir.copy(camera.position).normalize();
    for (const pk of pickables) {
      nrm.copy(pk.pos).normalize();
      if (nrm.dot(camDir) < 0.15) continue; // behind the planet
      proj.copy(pk.pos).project(camera);
      const sx = (proj.x + 1) / 2 * rect.width, sy = (1 - proj.y) / 2 * rect.height;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bestD) { bestD = d; best = { ...pk, sx, sy }; }
    }
    return best;
  }
  function showTip(hit) {
    if (!tipEl) return;
    if (!hit || !o.tooltip) { tipEl.hidden = true; canvas.style.cursor = ""; return; }
    tipEl.innerHTML = o.tooltip(hit.data);
    tipEl.hidden = false;
    const cw = container.clientWidth;
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let left = hit.sx + 14, top = hit.sy - th - 10;
    if (left + tw > cw - 8) left = hit.sx - tw - 14;
    if (top < 8) top = hit.sy + 14;
    tipEl.style.transform = `translate(${Math.max(8, left)}px, ${top}px)`;
    canvas.style.cursor = o.onSelect ? "pointer" : "";
  }
  let hoverEv = null, downAt = null;
  const coarse = matchMedia("(pointer: coarse)").matches;
  if (tipEl) {
    canvas.addEventListener("pointermove", e => { if (e.pointerType === "mouse") hoverEv = e; });
    canvas.addEventListener("pointerleave", () => { hoverEv = null; showTip(null); });
    canvas.addEventListener("pointerdown", e => { downAt = new Vector2(e.clientX, e.clientY); });
    canvas.addEventListener("pointerup", e => {
      if (!downAt || downAt.distanceTo(new Vector2(e.clientX, e.clientY)) > 6) return;
      const hit = pick(e.clientX, e.clientY, e.pointerType === "mouse" ? 14 : 26);
      if (e.pointerType !== "mouse") showTip(hit);
      if (hit && o.onSelect) o.onSelect(hit.data);
    });
  }

  /* ---------- theme ---------- */
  function setTheme(t) {
    oceanMat.uniforms.uOcean.value.set(t.ocean);
    oceanMat.uniforms.uRim.value.set(t.rim);
    dotMat.uniforms.uDay.value.set(t.land);
    dotMat.uniforms.uNight.value.set(t.landNight);
    dotMat.uniforms.uCity.value.set(t.city || "#ffd27a");
    atmoMat.uniforms.uColor.value.set(t.atmosphere);
    atmoMat.uniforms.uStrength.value = t.atmosphereStrength ?? 1.6;
    hemi.intensity = t.light ?? 2.2;
  }

  /* ---------- sizing ---------- */
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const vf = camera.fov * DEG;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const f = Math.min(vf, hf);
    const newBase = 1.2 / Math.sin(f / 2) / o.fit;
    // keep the user's zoom ratio when the container changes size
    const ratio = camera.position.length() / baseDist;
    baseDist = newBase;
    camera.position.setLength(baseDist * ratio);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.minDistance = 1.25;
      controls.maxDistance = baseDist * 1.6;
    }
    const scale = renderer.getDrawingBufferSize(new Vector2()).y / (2 * Math.tan(vf / 2));
    dotMat.uniforms.uScale.value = scale;
    for (const m of markMats) if (m.uniforms.uScale) m.uniforms.uScale.value = scale;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  /* ---------- loop ---------- */
  let running = true, inView = true, raf = 0, sunTick = 0;
  const io = new IntersectionObserver(([en]) => { inView = en.isIntersecting; kick(); });
  io.observe(container);
  document.addEventListener("visibilitychange", kick);
  function kick() {
    if (!raf && running && inView && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  const tmpV = new Vector3(), tmpB = new Vector3();
  function frame(now) {
    raf = 0;
    if (!running || !inView || document.hidden) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const t = (now - t0) / 1000;

    if (now - sunTick > 30000) { updateSun(); sunTick = now; }

    if (flight) {
      const k = Math.min(1, (now - flight.t0) / flight.duration);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const ang = flight.from.angleTo(flight.to);
      if (ang > 1e-4) {
        const s = Math.sin(ang);
        tmpV.copy(flight.from).multiplyScalar(Math.sin((1 - e) * ang) / s).addScaledVector(flight.to, Math.sin(e * ang) / s);
      } else tmpV.copy(flight.to);
      const lift = Math.sin(Math.PI * e) * Math.min(0.6, ang * 0.35);
      camera.position.copy(tmpV.normalize().multiplyScalar(flight.r0 + (flight.r1 - flight.r0) * e + lift));
      camera.lookAt(0, 0, 0);
      if (k >= 1) flight = null;
    } else if (controls) {
      controls.update(dt);
    } else if (o.autoRotate && !reduceMotion) {
      camera.position.applyAxisAngle(UP, dt * (Math.PI * 2 / 60) * o.autoRotateSpeed);
      camera.lookAt(0, 0, 0);
    }

    dotMat.uniforms.uTime.value = t;
    for (const m of markMats) if (m.uniforms.uTime) m.uniforms.uTime.value = t;

    for (const ob of objects.values()) {
      if (ob.dur > 0) {
        const k = Math.min(1, (now - ob.t0) / ob.dur);
        // slerp along the surface, keep altitude
        const r0 = ob.from.length(), r1 = ob.to.length();
        const ang = ob.from.angleTo(ob.to);
        if (ang > 1e-6 && ang < 1) {
          const s = Math.sin(ang);
          tmpB.copy(ob.to).normalize();
          tmpV.copy(ob.from).normalize().multiplyScalar(Math.sin((1 - k) * ang) / s).addScaledVector(tmpB, Math.sin(k * ang) / s);
          ob.g.position.copy(tmpV.normalize().multiplyScalar(r0 + (r1 - r0) * k));
        } else ob.g.position.copy(ob.to);
      } else ob.g.position.copy(ob.to);
      ob.body.rotation.y += dt * 1.5;
      const shown = ob.g.parent?.visible !== false;
      ob.el.style.display = shown ? "" : "none";
      if (!ob.el.hidden && shown) {
        camDir.copy(camera.position).normalize();
        const facing = nrm.copy(ob.g.position).normalize().dot(camDir);
        proj.copy(ob.g.position).project(camera);
        const x = (proj.x + 1) / 2 * container.clientWidth, y = (1 - proj.y) / 2 * container.clientHeight;
        ob.el.style.transform = `translate(${x + 12}px, ${y - 10}px)`;
        ob.el.style.opacity = facing > 0.05 ? 1 : 0;
      }
    }

    for (const P of pulses) {
      let k = (now - P.t0) / P.duration;
      if (k >= 1) {
        if (P.repeat === Infinity || --P.repeat > 0) { P.t0 = now; k = 0; }
        else { P.mesh.parent?.remove(P.mesh); P.mesh.material.dispose(); pulses.delete(P); continue; }
      }
      const s = P.size * (0.15 + 0.85 * (1 - Math.pow(1 - k, 2)));
      P.mesh.scale.setScalar(s);
      P.mesh.material.opacity = 0.85 * (1 - k);
    }

    if (hoverEv) { showTip(pick(hoverEv.clientX, hoverEv.clientY, 14)); }

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  kick();

  function dispose() {
    running = false;
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    controls?.dispose();
    renderer.dispose();
    canvas.remove();
    tipEl?.remove();
  }

  return {
    setPoints, setBars, setPath, setBand, setObject, removeObject, pulse, stopPulse,
    setVisible, flyTo, setTheme, dispose, hideTip: () => showTip(null),
    get landDotCount() { return pos.length / 3; },
  };
}

/** Read globe colours from CSS custom properties so the globe follows the page theme. */
export function themeFromCSS(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const v = (name, fb) => (cs.getPropertyValue(name).trim() || fb);
  return {
    ocean: v("--globe-ocean", "#0e1822"),
    rim: v("--globe-rim", "#1f3b4d"),
    land: v("--globe-land", "#3ddc97"),
    landNight: v("--globe-land-night", "#1d4d3c"),
    city: v("--globe-city", "#ffd27a"),
    atmosphere: v("--globe-atmo", "#4cc2ff"),
    atmosphereStrength: parseFloat(v("--globe-atmo-strength", "1.6")),
    light: parseFloat(v("--globe-light", "2.2")),
  };
}

/** Call fn whenever the page theme changes (data-theme attribute or OS preference). */
export function onThemeChange(fn) {
  new MutationObserver(fn).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", fn);
}

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch (_) { return false; }
}

