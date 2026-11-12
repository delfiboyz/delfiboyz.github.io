// 3D "skyline" of archive captures: one bar per month, years along the x axis.
import {
  WebGLRenderer, Scene, PerspectiveCamera, BoxGeometry, InstancedMesh, MeshLambertMaterial, Matrix4,
  Color, HemisphereLight, DirectionalLight, Raycaster, Vector2, Vector3, Mesh, PlaneGeometry,
  MeshBasicMaterial, ColorManagement, LinearSRGBColorSpace, Group,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

ColorManagement.enabled = false;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/**
 * @param {HTMLElement} container
 * @param {{onHover?: (cell|null, x, y) => void, onSelect?: (cell) => void}} opts
 */
export function createSkyline(container, { onHover, onSelect } = {}) {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setClearColor(0, 0);
  const canvas = renderer.domElement;
  canvas.className = "sky-canvas";
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 500);
  const hemi = new HemisphereLight(0xffffff, 0x334455, 2.0);
  scene.add(hemi);
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(-6, 14, 10);
  scene.add(sun);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.minPolarAngle = 0.15;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.5;
  controls.enableZoom = true;
  let framing = null; // auto-framing until the user takes over the camera
  controls.addEventListener("start", () => { controls.autoRotate = false; framing = null; });
  function frameView() {
    if (!framing) return;
    // narrow (portrait) viewports need the camera further back to fit the whole grid
    const k = Math.max(1, 2.1 / camera.aspect);
    camera.position.copy(framing).sub(controls.target).multiplyScalar(k).add(controls.target);
    controls.update();
  }

  const group = new Group();
  scene.add(group);
  const geo = new BoxGeometry(0.78, 1, 0.78);
  geo.translate(0, 0.5, 0);
  let mesh = null, plate = null, cells = [], labels = [];
  let theme = { low: "#4cc2ff", high: "#3ddc97", empty: "#22303c", plate: "#131b23" };

  function clear() {
    if (mesh) { group.remove(mesh); mesh.material.dispose(); mesh.dispose(); mesh = null; }
    if (plate) { group.remove(plate); plate.geometry.dispose(); plate.material.dispose(); plate = null; }
    labels.forEach(l => l.el.remove());
    labels = [];
    cells = [];
  }

  let data = null;
  /** years: { "2014": [12 counts] } */
  function setData(years) {
    data = years;
    clear();
    const ys = Object.keys(years).sort();
    if (!ys.length) return;
    const nY = ys.length;
    let max = 1;
    for (const y of ys) for (const c of years[y]) max = Math.max(max, c);
    const lmax = Math.log1p(max);

    mesh = new InstancedMesh(geo, new MeshLambertMaterial(), nY * 12);
    const m = new Matrix4(), col = new Color(), lo = new Color(theme.low), hi = new Color(theme.high), empty = new Color(theme.empty);
    const ox = -(nY - 1) / 2, oz = -5.5;
    let i = 0;
    ys.forEach((y, xi) => {
      years[y].forEach((c, mi) => {
        const h = c > 0 ? 0.12 + 5.5 * Math.log1p(c) / lmax : 0.03;
        m.makeScale(1, h, 1).setPosition(ox + xi, 0, oz + mi);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c > 0 ? col.copy(lo).lerp(hi, Math.log1p(c) / lmax) : empty);
        cells.push({ year: +y, month: mi, count: c, top: new Vector3(ox + xi, h, oz + mi) });
        i++;
      });
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    group.add(mesh);

    plate = new Mesh(new PlaneGeometry(nY + 1.4, 13.4), new MeshBasicMaterial({ color: theme.plate, transparent: true, opacity: 0.9 }));
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = -0.01;
    group.add(plate);

    // labels: years along the front edge, months along the left edge
    const step = nY > 24 ? 3 : nY > 12 ? 2 : 1;
    ys.forEach((y, xi) => {
      if (xi % step && xi !== nY - 1) return;
      addLabel(y, new Vector3(ox + xi, 0, oz + 12.3), "year");
    });
    MONTHS.forEach((mn, mi) => { if (mi % 3 === 0) addLabel(mn, new Vector3(ox - 1.4, 0, oz + mi), "month"); });

    // frame the whole skyline
    const span = Math.max(nY, 12);
    controls.target.set(0, 0.6, 0.8);
    framing = new Vector3(span * 0.42, span * 0.38 + 4.5, span * 0.72 + 6);
    frameView();
    kick();
  }
  function addLabel(text, pos, cls) {
    const el = document.createElement("div");
    el.className = `sky-label ${cls}`;
    el.textContent = text;
    container.appendChild(el);
    labels.push({ el, pos });
  }

  function setTheme(t) {
    theme = { ...theme, ...t };
    if (data) setData(data);
  }

  /* picking */
  const ray = new Raycaster(), ndc = new Vector2();
  let hoverId = -1;
  function pick(e) {
    if (!mesh) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(mesh, false)[0];
    return hit ? hit.instanceId : -1;
  }
  canvas.addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse") return;
    const id = pick(e);
    hoverId = id;
    canvas.style.cursor = id >= 0 && cells[id].count ? "pointer" : "";
    onHover?.(id >= 0 ? cells[id] : null, e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerleave", () => { hoverId = -1; onHover?.(null); });
  let down = null;
  canvas.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener("pointerup", e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const id = pick(e);
    if (id >= 0) {
      if (e.pointerType !== "mouse") onHover?.(cells[id], e.clientX, e.clientY);
      if (cells[id].count) onSelect?.(cells[id]);
    }
  });

  /* sizing + loop */
  let raf = 0, inView = true, last = performance.now();
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    frameView();
    kick();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const io = new IntersectionObserver(([en]) => { inView = en.isIntersecting; kick(); });
  io.observe(container);
  document.addEventListener("visibilitychange", kick);
  function kick() {
    if (!raf && inView && !document.hidden && container.isConnected) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  const p = new Vector3();
  function frame(now) {
    raf = 0;
    if (!inView || document.hidden || !container.clientWidth) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    controls.update(dt);
    renderer.render(scene, camera);
    const w = container.clientWidth, h = container.clientHeight;
    for (const l of labels) {
      p.copy(l.pos).project(camera);
      l.el.style.transform = `translate(-50%, -50%) translate(${(p.x + 1) / 2 * w}px, ${(1 - p.y) / 2 * h}px)`;
      l.el.style.opacity = p.z < 1 ? 1 : 0;
    }
    raf = requestAnimationFrame(frame);
  }

  return { setData, setTheme, resize, get hoverId() { return hoverId; } };
}
