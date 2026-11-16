
// ------------------------------------------------------------------ camera control (static, annotated)
async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load ${url}`);
  return response.json();
}
const ready = (() => {
  const D = 'data/camctrl/';
  const COLORS = ['#f97316', '#0891b2', '#7c3aed', '#16a34a'];
  const el = id => document.getElementById(id);
  const ours = k => k.startsWith('jvt');
  // boxes {x, y, w, h} in 256 px frame coordinates, drawn at the same position in every method
  function svgFor(boxes) {
    let s = '';
    boxes.forEach((b, i) => {
      const at = `x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4" fill="none"`;
      s += `<rect ${at} stroke="#fff" stroke-width="6"/><rect ${at} stroke="${COLORS[i % COLORS.length]}" stroke-width="3"/>`;
    });
    return `<svg viewBox="0 0 256 256">${s}</svg>`;
  }
  // manual boxes (data/camctrl/boxes.json, from the annotation page) override the automatic ones
  let manual = null;
  const framesOf = c => manual?.cases?.[c.seq]?.frames || c.frames;
  const hasManual = c => Object.values(manual?.cases?.[c.seq]?.boxes || {}).some(x => x.length);
  const boxesOf = (c, t) => hasManual(c) ? (manual.cases[c.seq].boxes[t] || []) :
    (c.marks[t] || []).map(r => ({ x: r.gt[0] - r.w / 2, y: r.gt[1] - (r.h || r.w) / 2, w: r.w, h: r.h || r.w }));
  function show(c) {
    const g = el('ccGrid'), M = c.methods;
    let h = '<div></div>' + M.map(k => `<div class="colhead${ours(k) ? ' ours' : ''}">${c.names[k]}</div>`).join('');
    framesOf(c).forEach((t, r) => {
      if (r === 1) h += '<div></div><div class="sep"></div>';
      h += `<div class="rowhead">Frame ${t}</div>`;
      h += M.map(k => `<div class="cccell" role="img" aria-label="${c.names[k]}, frame ${t}" style="background-image:url(${D}${c.seq}/rgb_${k}.jpg);background-position:${t / 7 * 100}% 0">` +
                     svgFor(boxesOf(c, t)) + '</div>').join('');
    });
    g.innerHTML = h;
  }
  return (async () => {
    let list = (await fetchJSON(D + 'cases.json')).cases;
    manual = await fetch(D + 'boxes.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    if (manual?.order) list = manual.order.filter(q => list.includes(q) && manual.cases?.[q]?.show !== false);
    const cases = await Promise.all(list.map(s => fetchJSON(`${D}${s}/case.json`)));
    if (!cases.length) throw new Error('No camera scenes available');
    const dots = el('ccDots');
    let cur = 0;
    const go = i => {
      cur = (i + cases.length) % cases.length;
      dots.querySelectorAll('button').forEach((b, j) => { b.classList.toggle('on', j === cur); b.setAttribute('aria-current', String(j === cur)); });
      show(cases[cur]);
    };
    dots.innerHTML = cases.map((c, i) => `<button data-i="${i}" aria-label="scene ${c.seq.slice(0, 8)}"></button>`).join('');
    dots.querySelectorAll('button').forEach(b => b.onclick = () => go(+b.dataset.i));
    el('ccPrev').onclick = () => go(cur - 1);
    el('ccNext').onclick = () => go(cur + 1);
    el('ccPrev').disabled = el('ccNext').disabled = cases.length < 2;
    if (cases.length < 2) { el('ccPrev').style.display = el('ccNext').style.display = dots.style.display = 'none'; }
    go(0);
    el('cameraStatus').textContent = '';
  })();
})();

export { ready };
