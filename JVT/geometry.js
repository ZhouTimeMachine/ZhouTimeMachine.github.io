
let THREE, OrbitControls;
let importTimer;
try {
  const modules = await Promise.race([
    Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]),
    new Promise((_, reject) => { importTimer = setTimeout(() => reject(new Error('3D library timed out')), 12000); }),
  ]);
  THREE = modules[0];
  OrbitControls = modules[1].OrbitControls;
} catch {
  // Images, frame controls, and scene navigation also work without the 3D library.
} finally {
  clearTimeout(importTimer);
}
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.json();
}
function createRenderer() {
  if (!THREE) return null;
  try { return new THREE.WebGLRenderer({ antialias: true }); }
  catch { return null; }
}

const ROWS = [
  { key: 'gt', name: 'Ground truth' },
  { key: 'jvt', name: 'JVT', ours: true },
  { key: 'aether', name: 'Aether w/ depth' },
  { key: 'dmax1', name: 'Aether w/o depth' },
];
const COLS = ['RGB', 'Depth', 'Point cloud', '3D view'];
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
const BUCKET = { small: 'small motion', medium: 'medium motion', large: 'large motion' };
const SEC_PER_FRAME = 0.5;   // camera speed along the trajectory (same as the videos)
const HOLD = 0.5;            // pause at both ends, in frame units
const ORBIT_DEG = 30;        // third-person view swings +-30 deg over one forward-and-back cycle

const state = { cases: [], info: {}, seq: null, t: 0, phase: 0, k: -1, playing: false, userPaused: motionPreference.matches, visible: false };
const $ = id => document.getElementById(id);
window.__jvt = state;  // for debugging from the console
const dir = s => `data/${s}`;

// ------------------------------------------------------------------ shared geometry helpers
const cloudCache = {};
function loadCloud(seq, row) {
  const key = `${seq}/${row}`;
  return cloudCache[key] ??= (async () => {
    const c = state.info[seq].clouds[row];
    const response = await fetch(`${dir(seq)}/cloud_${row}.bin`);
    if (!response.ok) throw new Error('Point cloud unavailable');
    const buf = await response.arrayBuffer();
    if (buf.byteLength !== c.n * 9) throw new Error('Invalid point cloud size');
    const q = new Uint16Array(buf, 0, c.n * 3), rgb = new Uint8Array(buf, c.n * 6, c.n * 3);
    const pos = new Float32Array(c.n * 3);
    for (let i = 0; i < c.n * 3; i++) { const a = i % 3; pos[i] = c.lo[a] + (q[i] / 65535) * (c.hi[a] - c.lo[a]); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3, true));
    geo.computeBoundingSphere();
    return { geo, psize: c.psize };
  })().catch(error => { delete cloudCache[key]; throw error; });
}
function makePoints(cl) {
  const pts = new THREE.Points(cl.geo, new THREE.PointsMaterial({ size: cl.psize, vertexColors: true, sizeAttenuation: true }));
  pts.userData.base = cl.psize;
  pts.frustumCulled = false;
  return pts;
}
// three.js sizes attenuated points by the full drawing-buffer height; rescale for a viewport of height vpH
function setPointSize(pts, mult, vpH, bufH) { pts.material.size = pts.userData.base * mult * vpH / bufH; }

function poses(info) {
  return info._poses ??= info.cams.map(c => {
    const m = new THREE.Matrix4().fromArray(c.m), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    return { p, q, c };
  });
}
// camera on the input trajectory at continuous time t (frame units): slerp rotation, lerp centre and intrinsics
function poseAt(info, t) {
  const P = poses(info), n = P.length;
  const i = Math.max(0, Math.min(Math.floor(t), n - 2)), a = Math.min(Math.max(t - i, 0), 1);
  const l = k => P[i].c[k] * (1 - a) + P[i + 1].c[k] * a;
  return { pos: P[i].p.clone().lerp(P[i + 1].p, a), quat: P[i].q.clone().slerp(P[i + 1].q, a),
           fx: l('fx'), fy: l('fy'), cx: l('cx'), cy: l('cy'), w: P[0].c.w, h: P[0].c.h };
}
function poseMatrix(pose) { return new THREE.Matrix4().compose(pose.pos, pose.quat, new THREE.Vector3(1, 1, 1)); }
function frustumCorners(pose, s) {
  const m = poseMatrix(pose);
  const c = [[0, 0], [pose.w, 0], [pose.w, pose.h], [0, pose.h]].map(([u, v]) =>
    new THREE.Vector3((u - pose.cx) / pose.fx * s, -(v - pose.cy) / pose.fy * s, -s).applyMatrix4(m));
  return { o: pose.pos.clone(), c };
}
function frustumSegments({ o, c }) {
  const pts = [];
  c.forEach(p => pts.push(o, p));
  for (let i = 0; i < 4; i++) pts.push(c[i], c[(i + 1) % 4]);
  return pts;
}
// input cameras (grey), path (amber) and a movable current camera (red outline + translucent image plane)
function buildRig(info) {
  const g = new THREE.Group();
  const s = info.frustum;
  const grey = new THREE.LineBasicMaterial({ color: 0x94a3b8 });
  info.cams.forEach((_, t) => g.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(frustumSegments(frustumCorners(poseAt(info, t), s))), grey)));
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(poses(info).map(x => x.p)),
                       new THREE.LineBasicMaterial({ color: 0xf59e0b })));
  const red = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',
    new THREE.BufferAttribute(new Float32Array(16 * 3), 3)), new THREE.LineBasicMaterial({ color: 0xdc2626 }));
  const plane = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3)),
    new THREE.MeshBasicMaterial({ color: 0xdc2626, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  red.frustumCulled = plane.frustumCulled = false;
  g.add(red, plane);
  g.userData = { red, plane, info };
  return g;
}
function moveCurrent(rig, pose) {
  const fc = frustumCorners(pose, rig.userData.info.frustum * 1.25);
  const a = rig.userData.red.geometry.attributes.position;
  frustumSegments(fc).forEach((p, i) => a.setXYZ(i, p.x, p.y, p.z));
  a.needsUpdate = true;
  const b = rig.userData.plane.geometry.attributes.position, c = fc.c;
  [c[0], c[1], c[2], c[0], c[2], c[3]].forEach((p, i) => b.setXYZ(i, p.x, p.y, p.z));
  b.needsUpdate = true;
}
const vfov = pose => 2 * Math.atan(pose.h / 2 / pose.fy) * 180 / Math.PI;

// ------------------------------------------------------------------ time
function cycle() { const L = (state.info[state.seq]?.frames || 8) - 1; return { L, half: L + 2 * HOLD, total: 2 * (L + 2 * HOLD) }; }
function tFromPhase(ph) {
  const { L, half, total } = cycle();
  const p = ((ph % total) + total) % total;
  const clamp = x => Math.min(Math.max(x, 0), L);
  return p < half ? clamp(p - HOLD) : L - clamp(p - half - HOLD);
}
function orbitDeg() { const { total } = cycle(); return ORBIT_DEG * Math.sin(2 * Math.PI * state.phase / total); }
function setTime(t, fromUser) {
  const { L } = cycle();
  state.t = Math.min(Math.max(t, 0), L);
  if (fromUser) state.phase = state.t + HOLD;  // continue the forward pass from here
  if (document.activeElement !== $('frame')) $('frame').value = state.t;
  const k = Math.round(state.t);
  if (k !== state.k) {
    state.k = k;
    document.querySelectorAll('#grid .cell.strip').forEach(c => c.style.backgroundPosition = `${(k / L) * 100}% 0`);
    $('ticks').innerHTML = Array.from({ length: L + 1 }, (_, i) => i === k ? `<b>${i}</b>` : `<span>${i}</span>`).join('');
    viewer.setFrame(k);
  }
}
function setPlaying(on) { state.playing = on; $('play').innerHTML = on ? PAUSE : PLAY; $('play').setAttribute('aria-label', on ? 'Pause animation' : 'Play animation'); }

// ------------------------------------------------------------------ live grid renderer (one WebGL context, copied into cell canvases)

const live = (() => {
  const BW = 1600, BH = 700;  // drawing buffer; cells use its bottom-left corner
  const renderer = createRenderer();
  if (!renderer) return { available: false, setCase: async () => {}, draw: () => {} };
  renderer.setPixelRatio(1);
  renderer.setSize(BW, BH, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;  // vertex colours are display-referred sRGB bytes
  renderer.setClearColor(0xffffff, 1);
  renderer.setScissorTest(true);
  const camP = new THREE.PerspectiveCamera(60, 1, 0.01, 1000), camO = new THREE.PerspectiveCamera(60, 16 / 9, 0.01, 1000);
  let cur = null;

  async function setCase(seq) {
    const token = cur = { seq, ready: false };
    document.querySelectorAll('#grid .cell.livecell').forEach(c => c.classList.remove('ready'));
    const clouds = await Promise.all(ROWS.map(r => loadCloud(seq, r.key)));
    if (cur !== token) return;
    token.scenes = {};
    ROWS.forEach((r, i) => { const sc = new THREE.Scene(); const pts = makePoints(clouds[i]); sc.add(pts); token.scenes[r.key] = { sc, pts }; });
    token.rig = buildRig(state.info[seq]);
    token.ready = true;
    draw();
    document.querySelectorAll('#grid .cell.livecell').forEach(c => c.classList.add('ready'));
  }

  function draw() {
    if (!cur?.ready) return;
    const info = state.info[cur.seq];
    const pose = poseAt(info, state.t);
    camP.position.copy(pose.pos); camP.quaternion.copy(pose.quat); camP.fov = vfov(pose);
    const v = info.view, up = new THREE.Vector3(...v.up).normalize(), tgt = new THREE.Vector3(...v.target);
    camO.position.copy(new THREE.Vector3(...v.eye).sub(tgt).applyAxisAngle(up, orbitDeg() * Math.PI / 180).add(tgt));
    camO.up.copy(up); camO.lookAt(tgt);
    moveCurrent(cur.rig, pose);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    for (const cv of document.querySelectorAll('#grid canvas[data-r]')) {
      const r = cv.getBoundingClientRect();
      if (r.width < 2 || r.bottom < 0 || r.top > innerHeight) continue;
      const w = Math.min(Math.round(r.width * dpr), BW), h = Math.min(Math.round(r.height * dpr), BH);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const isOv = cv.dataset.t === 'ov';
      const { sc, pts } = cur.scenes[cv.dataset.r];
      sc.add(cur.rig); cur.rig.visible = isOv;
      setPointSize(pts, isOv ? 1.0 : 1.4, h, BH);
      const cam = isOv ? camO : camP;
      cam.aspect = w / h; cam.updateProjectionMatrix();
      renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
      renderer.render(sc, cam);
      cv.getContext('2d').drawImage(renderer.domElement, 0, BH - h, w, h, 0, 0, w, h);
    }
  }
  return { available: true, setCase, draw };
})();

// ------------------------------------------------------------------ grid
function buildGrid() {
  const g = $('grid');
  g.innerHTML = '<div></div>' + COLS.map((c, i) => `<div class="colhead${i === 3 ? ' ovcol' : ''}">${c}</div>`).join('');
  ROWS.forEach((r, i) => {
    if (i === 1) g.insertAdjacentHTML('beforeend', '<div class="gap"></div>');
    g.insertAdjacentHTML('beforeend', `<div class="rowhead${r.ours ? ' ours' : ''}">${r.name}</div>` +
      ['rgb', 'depth'].map(t => `<div class="cell strip row-${r.key}" data-t="${t}" data-r="${r.key}"></div>`).join('') +
      `<div class="cell strip click livecell row-${r.key}" data-t="pcv" data-r="${r.key}"><canvas data-t="pcv" data-r="${r.key}"></canvas></div>` +
      `<div class="cell ov click livecell ovcol row-${r.key}" data-t="ov" data-r="${r.key}"><canvas data-t="ov" data-r="${r.key}"></canvas></div>`);
  });
  g.querySelectorAll('.cell').forEach(c => {
    c.setAttribute('aria-label', `${ROWS.find(r => r.key === c.dataset.r).name}: ${COLS[['rgb', 'depth', 'pcv', 'ov'].indexOf(c.dataset.t)]}`);
    if (c.classList.contains('click') && live.available) {
      c.tabIndex = 0;
      c.setAttribute('role', 'button');
      c.setAttribute('aria-label', `Explore ${c.getAttribute('aria-label')} in 3D`);
      c.onclick = () => openViewer(c.dataset.r, c);
      c.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openViewer(c.dataset.r, c); }
      };
    } else {
      c.classList.remove('click');
      c.setAttribute('role', 'img');
    }
  });
}

let requestedCloudSeq = null;
function showCase(seq) {
  state.seq = seq;
  const info = state.info[seq];
  document.querySelectorAll('#geoDots button').forEach(b => { b.classList.toggle('on', b.dataset.seq === seq); b.setAttribute('aria-current', String(b.dataset.seq === seq)); });
  document.querySelectorAll('#grid .cell[data-t]').forEach(c => c.style.backgroundImage = `url(${dir(seq)}/${c.dataset.t}_${c.dataset.r}.jpg)`);
  $('caseMeta').textContent = `${seq.slice(0, 8)} · ${BUCKET[info.bucket] || ''}`;
  $('frame').max = info.frames - 1;
  state.k = -1; state.phase = 0;
  setTime(0);
  if (state.visible) loadVisibleClouds();
}
function loadVisibleClouds() {
  if (!live.available || !state.seq || requestedCloudSeq === state.seq) return;
  const seq = requestedCloudSeq = state.seq;
  $('geometryStatus').textContent = 'Loading point clouds…';
  live.setCase(seq).then(() => {
    if (state.seq === seq) $('geometryStatus').textContent = '';
  }).catch(() => {
    if (state.seq !== seq) return;
    requestedCloudSeq = null;
    $('geometryStatus').textContent = 'Point clouds could not load. Images and frame controls remain available; select a scene to retry.';
  });
}

// ------------------------------------------------------------------ 3D viewer (modal)
const viewer = (() => {
  const stage = $('vStage');
  const renderer = live.available ? createRenderer() : null;
  if (!renderer) return { open: async () => {}, setFrame: () => {}, render: () => {}, isOpen: () => false };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0xffffff, 1);
  renderer.setScissorTest(true);
  stage.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = true;

  const cache = {};
  let cur = null, mode = 'jvt', frame = 0, labels = [], divs = [];
  const tabs = $('vTabs');
  [...ROWS.map(r => [r.key, r.name]), ['all', 'Compare all']].forEach(([k, n]) => {
    const b = document.createElement('button');
    b.textContent = n; b.dataset.k = k; b.onclick = () => setMode(k);
    tabs.appendChild(b);
  });

  async function ensure(seq) {
    if (cache[seq]) return cache[seq];
    const info = state.info[seq];
    const clouds = await Promise.all(ROWS.map(r => loadCloud(seq, r.key)));
    const scenes = {}, points = {};
    ROWS.forEach((r, i) => { const sc = new THREE.Scene(); points[r.key] = makePoints(clouds[i]); sc.add(points[r.key]); scenes[r.key] = sc; });
    return (cache[seq] = { info, points, scenes, rig: buildRig(info) });
  }

  function resetView() {
    if (!cur) return;
    const v = cur.info.view;
    camera.position.set(...v.eye); camera.up.set(...v.up); controls.target.set(...v.target);
    camera.fov = 60;  // same vertical FOV as the 3D-view cells
    camera.updateProjectionMatrix(); controls.update();
  }
  function viewFromCamera() {
    if (!cur) return;
    const pose = poseAt(cur.info, frame);
    camera.position.copy(pose.pos);
    camera.up.set(0, 1, 0).applyQuaternion(pose.quat);
    controls.target.copy(pose.pos).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(pose.quat), cur.info.scene_depth);
    camera.fov = vfov(pose);
    camera.updateProjectionMatrix(); controls.update();
  }
  function setFrame(k) {
    frame = k;
    $('vCamIdx').textContent = k;
    if (cur) moveCurrent(cur.rig, poseAt(cur.info, k));
  }
  function setMode(k) {
    mode = k;
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
    layoutLabels();
  }
  function viewports() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (mode !== 'all') return [{ row: mode, x: 0, y: 0, w, h }];
    const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
    return ROWS.map((r, i) => ({ row: r.key, x: (i % 2) * hw, y: Math.floor(i / 2) * hh, w: i % 2 ? w - hw : hw, h: i < 2 ? hh : h - hh }));
  }
  function layoutLabels() {
    labels.forEach(l => l.remove()); divs.forEach(d => d.remove());
    labels = []; divs = [];
    viewports().forEach(vp => {
      const r = ROWS.find(x => x.key === vp.row);
      const l = document.createElement('div');
      l.className = 'vlabel' + (r.ours ? ' ours' : '');
      l.textContent = r.name;
      l.style.left = `${vp.x + 12}px`; l.style.top = `${vp.y + 12}px`;
      stage.appendChild(l); labels.push(l);
    });
    if (mode === 'all') {
      const w = stage.clientWidth, h = stage.clientHeight;
      [`left:${Math.floor(w / 2)}px;top:0;width:1px;height:100%`, `left:0;top:${Math.floor(h / 2)}px;width:100%;height:1px`].forEach(css => {
        const d = document.createElement('div'); d.className = 'vdiv'; d.style.cssText = css; stage.appendChild(d); divs.push(d);
      });
    }
  }
  function render() {
    if (!isOpen() || !cur) return;
    const w = stage.clientWidth, h = stage.clientHeight, canvas = renderer.domElement;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); layoutLabels();
    }
    controls.update();
    const size = +$('vSize').value, showCams = $('vCams').checked;
    for (const vp of viewports()) {
      const sc = cur.scenes[vp.row];
      sc.add(cur.rig); cur.rig.visible = showCams;
      setPointSize(cur.points[vp.row], size, vp.h, h);
      camera.aspect = vp.w / vp.h; camera.updateProjectionMatrix();
      const y = h - vp.y - vp.h;  // WebGL origin is bottom-left
      renderer.setViewport(vp.x, y, vp.w, vp.h); renderer.setScissor(vp.x, y, vp.w, vp.h);
      renderer.render(sc, camera);
    }
  }
  const isOpen = () => $('viewer').classList.contains('open');
  let openToken = 0;
  async function open(seq, row) {
    const token = ++openToken;
    $('viewer').classList.add('open');
    document.body.style.overflow = 'hidden';
    document.querySelector('main').inert = true;
    document.querySelector('header').inert = true;
    document.querySelector('footer').inert = true;
    $('vClose').focus();
    $('vLoading').textContent = 'Loading point clouds…';
    $('vTitle').textContent = `Scene ${seq.slice(0, 8)}`;
    $('vLoading').style.display = 'grid';
    setMode(row);
    cur = null;
    try {
      const result = await ensure(seq);
      if (token !== openToken || !isOpen()) return;
      cur = result;
    } catch {
      if (token === openToken) $('vLoading').textContent = 'Unable to load the point clouds. Close this viewer and try again.';
      return;
    }
    $('vLoading').style.display = 'none';
    setFrame(state.k);
    resetView();
    layoutLabels();
  }
  function close() {
    if (!isOpen()) return;
    openToken++;
    $('viewer').classList.remove('open');
    document.body.style.overflow = '';
    document.querySelector('main').inert = false;
    document.querySelector('header').inert = false;
    document.querySelector('footer').inert = false;
    restoreDemo();
    viewerTrigger?.focus({ preventScroll: true });
  }

  $('vReset').onclick = resetView;
  $('vFromCam').onclick = viewFromCamera;
  $('vClose').onclick = close;
  $('viewer').addEventListener('click', e => { if (e.target.id === 'viewer') close(); });
  window.addEventListener('keydown', e => {
    if (!isOpen()) return;
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const focusable = [...$('viewer').querySelectorAll('button, input, [tabindex="0"]')].filter(node => !node.disabled && node.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      setPlaying(false);
      const L = cycle().L;
      setTime(Math.min(L, Math.max(0, Math.round(state.t) + (e.key === 'ArrowRight' ? 1 : -1))), true);
    }
  });
  return { open, setFrame, render, isOpen };
})();

// the demo pauses while the viewer is open and returns to exactly where it was (frame, orbit, play/pause) on close;
// frames stepped inside the viewer with the arrow keys only affect the preview
let demoSnap = null, viewerTrigger = null;
function openViewer(row, trigger) {
  viewerTrigger = trigger;
  if (!viewer.isOpen()) demoSnap = { t: state.t, phase: state.phase, playing: state.playing, userPaused: state.userPaused };
  setPlaying(false);
  viewer.open(state.seq, row);
}
function restoreDemo() {
  if (!demoSnap) return;
  const s = demoSnap; demoSnap = null;
  state.userPaused = s.userPaused;
  state.phase = s.phase;
  setTime(s.t);
  last = performance.now();  // no time jump on the first frame after closing
  checkVisible();
  setPlaying(state.visible && s.playing);
  live.draw();
}

// ------------------------------------------------------------------ main loop
// autoplay only while the demo is on screen and the user has not paused it (left alone while the viewer is open)
function checkVisible() {
  if (viewer.isOpen() || !$('grid')) return;
  const r = $('grid').getBoundingClientRect();
  const vis = !document.hidden && r.bottom > innerHeight * 0.1 && r.top < innerHeight * 0.9;
  if (vis && !state.visible) loadVisibleClouds();
  if (vis !== state.visible) { state.visible = vis; setPlaying(vis && !state.userPaused); }
}
let last = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  if (viewer.isOpen()) { viewer.render(); return; }
  if (!state.seq || !state.visible) return;
  if (state.playing) {
    state.phase += dt / SEC_PER_FRAME;
    setTime(tFromPhase(state.phase));
    live.draw();
  }
}

export const ready = (async () => {
  const list = await fetchJSON('data/cases.json');
  if (!list.cases?.length) throw new Error('No geometry cases available');
  state.cases = list.cases;
  await Promise.all(state.cases.map(async s => { state.info[s] = await fetchJSON(`${dir(s)}/case.json`); }));
  $('geoDots').innerHTML = state.cases.map(s => `<button data-seq="${s}" aria-label="scene ${s.slice(0, 8)}"></button>`).join('');
  $('geoDots').querySelectorAll('button').forEach(b => b.onclick = () => showCase(b.dataset.seq));
  const step = d => showCase(state.cases[(state.cases.indexOf(state.seq) + d + state.cases.length) % state.cases.length]);
  $('geoPrev').onclick = () => step(-1);
  $('geoNext').onclick = () => step(1);
  $('geoPrev').disabled = $('geoNext').disabled = state.cases.length < 2;
  buildGrid();
  $('geometryControls').hidden = false;
  $('geometryStatus').textContent = live.available ? '' : '3D is unavailable in this browser. Browse the images with the scene arrows and frame controls.';
  showCase(state.cases[0]);
  $('frame').oninput = e => { state.userPaused = true; setPlaying(false); setTime(+e.target.value, true); live.draw(); };
  $('play').onclick = () => { state.userPaused = state.playing; setPlaying(!state.playing); };
  setPlaying(false);
  addEventListener('scroll', checkVisible, { passive: true });
  addEventListener('resize', () => { checkVisible(); live.draw(); });
  document.addEventListener('visibilitychange', checkVisible);
  motionPreference.addEventListener('change', () => {
    state.userPaused = motionPreference.matches;
    setPlaying(state.visible && !state.userPaused && !viewer.isOpen());
  });
  checkVisible();
  requestAnimationFrame(tick);
})();
