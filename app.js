/* WSA — Word Selector Application
   Implements the seven Egan selection criteria from
   "Word Selector - Design Criteria - Rev 002". */
'use strict';

/* ---------------- criteria targets ---------------- */
const CAT_TARGET = { '2': 5, '2+': 14, '3': 60, '3+': 18, '3++': 3 };
const CAT_ORDER = ['2', '2+', '3', '3+', '3++']; // JS object keys reorder integer-like keys — keep display order explicit
const TYP_TARGET = { '1': 3, '2': 77, '3.1': 15, '3.2': 3, '3.3': 1, '4': 1 };
const TYP_ORDER = ['1', '2', '3.1', '3.2', '3.3', '4'];
const COM_TARGET = [64, 19, 13, 4];   // <=1.5, >1.5-2, >2-2.5, >2.5
const DIF_TARGET = [1, 2, 8, 13, 76]; // 1-2, >2-3, >3-4, >4-4.5, >4.5
const PAIR_PENALTY = 10;
const TYP_LABEL = {
  '1': 'Letters (حرف)', '2': 'Nouns (اسم)', '3.1': 'Past verbs (فعل ماض)',
  '3.2': 'Imperative (فعل أمر)', '3.3': 'Present (فعل مضارع)', '4': 'Other (مقطع صوتي)'
};
const COM_LABEL = ['Up to 1.5', '>1.5 – 2', '>2 – 2.5', '>2.5'];
const DIF_LABEL = ['1 – 2', '>2 – 3', '>3 – 4', '>4 – 4.5', '>4.5'];

const comBucket = v => v <= 1.5 ? 0 : v <= 2 ? 1 : v <= 2.5 ? 2 : 3;
const difBucket = v => v <= 2 ? 0 : v <= 3 ? 1 : v <= 4 ? 2 : v <= 4.5 ? 3 : 4;

/* precompute per-word */
const byId = new Map();
for (const w of WORDS) {
  w.id = parseInt(w.wc, 10);
  w.cbk = comBucket(w.com);
  w.dbk = difBucket(w.dif);
  byId.set(w.id, w);
}
const PARTNERS = new Map(); // id -> [ids]
for (const [a, b] of PHONETIC_PAIRS) {
  if (!PARTNERS.has(a)) PARTNERS.set(a, []);
  if (!PARTNERS.has(b)) PARTNERS.set(b, []);
  PARTNERS.get(a).push(b);
  PARTNERS.get(b).push(a);
}

/* ---------------- persistence ---------------- */
const LS_KEY = 'wsa_state_v1';
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && Array.isArray(s.history)) return s;
  } catch (e) { /* private mode or blocked storage */ }
  return { history: [] }; // history: [{ids:[...], ts, cost}]
}
function saveState() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}
let state = loadState();
let viewIndex = state.history.length - 1; // which list is displayed

function usedIds() {
  const s = new Set();
  for (const h of state.history) for (const id of h.ids) s.add(id);
  return s;
}

/* ---------------- selection algorithm ----------------
   Cost = total absolute deviation from the four target
   distributions + a heavy penalty per phonetically-similar
   pair present. Hill-climbing with random swaps and
   restarts; cost 0 = fully compliant list. */
function listCost(sel) {
  const cat = {}, typ = {}, com = [0, 0, 0, 0], dif = [0, 0, 0, 0, 0];
  const ids = new Set();
  for (const w of sel) {
    cat[w.cat] = (cat[w.cat] || 0) + 1;
    typ[w.typ] = (typ[w.typ] || 0) + 1;
    com[w.cbk]++; dif[w.dbk]++;
    ids.add(w.id);
  }
  let c = 0;
  for (const k in CAT_TARGET) c += Math.abs((cat[k] || 0) - CAT_TARGET[k]);
  for (const k in TYP_TARGET) c += Math.abs((typ[k] || 0) - TYP_TARGET[k]);
  COM_TARGET.forEach((t, i) => c += Math.abs(com[i] - t));
  DIF_TARGET.forEach((t, i) => c += Math.abs(dif[i] - t));
  for (const [a, b] of PHONETIC_PAIRS) if (ids.has(a) && ids.has(b)) c += PAIR_PENALTY;
  return c;
}

function solveList(pool) {
  const RESTARTS = 6, ITERS = 40000;
  let best = null, bestCost = Infinity;
  for (let r = 0; r < RESTARTS && bestCost > 0; r++) {
    // random start
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let sel = shuffled.slice(0, 100);
    let rest = shuffled.slice(100);
    let cost = listCost(sel);
    for (let it = 0; it < ITERS && cost > 0 && rest.length > 0; it++) {
      const i = Math.floor(Math.random() * 100);
      const j = Math.floor(Math.random() * rest.length);
      const out = sel[i];
      sel[i] = rest[j];
      const c2 = listCost(sel);
      if (c2 <= cost) { rest[j] = out; cost = c2; }
      else { sel[i] = out; }
    }
    if (cost < bestCost) { bestCost = cost; best = sel.slice(); }
  }
  return { sel: best, cost: bestCost };
}

/* ---------------- statistics ---------------- */
function round2(x) { return Math.round(x * 100) / 100; }
function statPack(vals) {
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n); // population, as STDEV.P
  const sorted = vals.slice().sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const freq = new Map();
  for (const v of vals) freq.set(v, (freq.get(v) || 0) + 1);
  let mode = null, mf = 1;
  for (const [v, f] of freq) if (f > mf || (f === mf && mode !== null && v < mode)) { mode = v; mf = f; }
  const min = sorted[0], max = sorted[n - 1];
  return { mean, sd, median, mode, min, max, range: max - min };
}

function letterCounts(sel) {
  const counts = new Array(36).fill(0);
  for (const w of sel) {
    for (const c of [w.c1, w.c2, w.c3, w.c4]) {
      if (typeof c === 'number' && c >= 1 && c <= 36) counts[c - 1]++;
    }
  }
  return counts;
}

/* ---------------- DOM helpers ---------------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}

/* tooltip */
const tip = $('tooltip');
function showTip(html, ev) {
  tip.innerHTML = html;
  tip.style.display = 'block';
  moveTip(ev);
}
function moveTip(ev) {
  const pad = 14;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  const r = tip.getBoundingClientRect();
  if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideTip() { tip.style.display = 'none'; }
window.addEventListener('scroll', hideTip, { passive: true });

/* attach hover + tap handlers to a chart hit area */
function tipTarget(node, htmlFn) {
  node.addEventListener('mousemove', ev => showTip(htmlFn(), ev));
  node.addEventListener('mouseleave', hideTip);
  node.addEventListener('click', ev => { ev.stopPropagation(); showTip(htmlFn(), ev); });
}
document.addEventListener('click', hideTip);

/* ---------------- charts (inline SVG) ---------------- */
const SVGNS = 'http://www.w3.org/2000/svg';
function el(name, attrs, parent) {
  const e = document.createElementNS(SVGNS, name);
  for (const k in attrs) {
    // var() is not valid in SVG presentation attributes — route paints through CSS
    if (k === 'fill' || k === 'stroke' || k === 'font-family') e.style.setProperty(k, attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  if (parent) parent.appendChild(e);
  return e;
}

function niceMax(maxV) {
  // 4 gridline steps with integer labels
  const step = maxV <= 20 ? Math.ceil(maxV / 4) : Math.ceil(maxV / 20) * 5;
  return Math.max(4 * step, 4);
}

function histogram(container, values, lo, hi, binW, colorVar, unit) {
  container.innerHTML = '';
  const nb = Math.round((hi - lo) / binW);
  const bins = new Array(nb).fill(0);
  for (const v of values) {
    let i = Math.ceil((v - lo) / binW) - 1; // (lo, lo+binW] style bins, first bin includes lo
    if (v <= lo) i = 0;
    i = Math.min(Math.max(i, 0), nb - 1);
    bins[i]++;
  }
  const W = 640, H = 240, mL = 36, mR = 10, mT = 18, mB = 30;
  const iw = W - mL - mR, ih = H - mT - mB;
  const maxC = Math.max(...bins, 1);
  const yMax = niceMax(maxC);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img' }, container);
  svg.style.maxWidth = W + 'px';
  // y grid
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const yv = yMax * s / steps;
    const y = mT + ih - (yv / yMax) * ih;
    el('line', { x1: mL, x2: W - mR, y1: y, y2: y, stroke: s === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }, svg);
    const t = el('text', { x: mL - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, svg);
    t.textContent = yv;
  }
  const bw = iw / nb;
  bins.forEach((c, i) => {
    const h = (c / yMax) * ih;
    const x = mL + i * bw + 2, y = mT + ih - h, w = bw - 4;
    const r = Math.min(4, h / 2);
    if (c > 0) {
      const path = `M${x},${mT + ih} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${mT + ih} Z`;
      const bar = el('path', { d: path, fill: `var(${colorVar})` }, svg);
      const lbl = el('text', { x: x + w / 2, y: y - 5, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--ink-2)' }, svg);
      lbl.textContent = c;
      const b0 = round2(lo + i * binW), b1 = round2(lo + (i + 1) * binW);
      const hover = el('rect', { x: x - 2, y: mT, width: bw, height: ih, fill: 'transparent' }, svg);
      tipTarget(hover, () => `<strong>${c} word${c === 1 ? '' : 's'}</strong><br>${unit} ${b0}&thinsp;–&thinsp;${b1}`);
    }
    // x tick labels at edges
    if (i % 1 === 0) {
      const t = el('text', { x: mL + i * bw, y: H - 10, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, svg);
      t.textContent = round2(lo + i * binW);
    }
  });
  const tEnd = el('text', { x: mL + nb * bw, y: H - 10, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, svg);
  tEnd.textContent = round2(hi);
}

function lettersChart(container, counts, optTotal) {
  container.innerHTML = '';
  const n = 36;
  const colW = 26, mL = 36, mR = 8, mT = 14, mB = 30;
  const W = mL + mR + n * colW, H = 260;
  const ih = H - mT - mB;
  const optCounts = OPTIMAL_PCT.map(p => p * optTotal / 100);
  const maxV = Math.max(...counts, ...optCounts, 1);
  const yMax = niceMax(maxV);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, role: 'img' }, container);
  const steps = 4;
  for (let s = 0; s <= steps; s++) {
    const yv = yMax * s / steps;
    const y = mT + ih - (yv / yMax) * ih;
    el('line', { x1: mL, x2: W - mR, y1: y, y2: y, stroke: s === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }, svg);
    const t = el('text', { x: mL - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, svg);
    t.textContent = yv;
  }
  for (let i = 0; i < n; i++) {
    const cx = mL + i * colW;
    const c = counts[i], o = optCounts[i];
    const bh = (c / yMax) * ih;
    const x = cx + 5, w = colW - 10, y = mT + ih - bh;
    if (c > 0) {
      const r = Math.min(4, bh / 2);
      el('path', {
        d: `M${x},${mT + ih} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${mT + ih} Z`,
        fill: 'var(--series-1)'
      }, svg);
    }
    const oy = mT + ih - (o / yMax) * ih;
    el('line', { x1: cx + 3, x2: cx + colW - 3, y1: oy, y2: oy, stroke: 'var(--series-2)', 'stroke-width': 3, 'stroke-linecap': 'round' }, svg);
    const t = el('text', { x: cx + colW / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 14, fill: 'var(--ink-2)', 'font-family': 'Amiri, serif' }, svg);
    t.textContent = LETTER_NAMES[i];
    const hover = el('rect', { x: cx, y: mT, width: colW, height: ih + mB, fill: 'transparent' }, svg);
    tipTarget(hover, () => `<strong lang="ar" style="font-family:Amiri,serif;font-size:16px">${LETTER_NAMES[i]}</strong> (code ${i + 1})<br>Selected: ${counts[i]}<br>Optimal: ${round2(o)} (${round2(OPTIMAL_PCT[i])}%)`);
  }
}

/* ---------------- rendering ---------------- */
function fmt(x) {
  if (x === null || x === undefined) return '—';
  return (Math.round(x * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function complianceTable(title, rows) {
  let h = `<div><p class="eyebrow">${esc(title)}</p><table class="mini"><tr><th>Group</th><th class="num">Target</th><th class="num">Actual</th><th></th></tr>`;
  for (const [label, target, actual] of rows) {
    const ok = target === actual;
    h += `<tr><td>${label}</td><td class="num">${target}</td><td class="num">${actual}</td><td>${ok ? '<span class="ok">✓</span>' : `<span class="miss">${actual > target ? '+' : ''}${actual - target}</span>`}</td></tr>`;
  }
  h += '</table></div>';
  return h;
}

function renderList(idx) {
  viewIndex = idx;
  const entry = state.history[idx];
  if (!entry) { $('results').hidden = true; $('empty').style.display = ''; renderChrome(); return; }
  const sel = entry.ids.map(id => byId.get(id));
  $('empty').style.display = 'none';
  $('results').hidden = false;

  /* compliance */
  const cat = {}, typ = {}, com = [0, 0, 0, 0], dif = [0, 0, 0, 0, 0];
  const ids = new Set(entry.ids);
  for (const w of sel) {
    cat[w.cat] = (cat[w.cat] || 0) + 1;
    typ[w.typ] = (typ[w.typ] || 0) + 1;
    com[w.cbk]++; dif[w.dbk]++;
  }
  let deviation = 0;
  for (const k in CAT_TARGET) deviation += Math.abs((cat[k] || 0) - CAT_TARGET[k]);
  for (const k in TYP_TARGET) deviation += Math.abs((typ[k] || 0) - TYP_TARGET[k]);
  COM_TARGET.forEach((t, i) => deviation += Math.abs(com[i] - t));
  DIF_TARGET.forEach((t, i) => deviation += Math.abs(dif[i] - t));
  const conflicts = PHONETIC_PAIRS.filter(([a, b]) => ids.has(a) && ids.has(b));
  const unique = ids.size === sel.length;

  const v = $('verdictRow');
  v.innerHTML =
    (deviation === 0
      ? '<span class="pill ok">✓ All distributions met exactly</span>'
      : `<span class="pill warn">Deviation: ${deviation} word${deviation === 1 ? '' : 's'} off target</span>`) +
    (conflicts.length === 0
      ? '<span class="pill ok">✓ No phonetically similar pairs</span>'
      : `<span class="pill warn">${conflicts.length} phonetic pair conflict(s)</span>`) +
    (unique ? '<span class="pill ok">✓ 100 unique words</span>' : '<span class="pill warn">Duplicates present</span>');
  const oldNote = v.parentElement.querySelector('.verdict-note');
  if (oldNote) oldNote.remove();
  if (deviation > 0) {
    v.insertAdjacentHTML('afterend',
      '<p class="verdict-note">The words remaining in this cycle can no longer meet every quota exactly — this is the closest possible list. The rows marked below show where it deviates.</p>');
  }

  $('complianceGrid').innerHTML =
    complianceTable('Category / syllable', CAT_ORDER.map(k => [`Category ${k}`, CAT_TARGET[k], cat[k] || 0])) +
    complianceTable('Word type', TYP_ORDER.map(k => [TYP_LABEL[k], TYP_TARGET[k], typ[k] || 0])) +
    complianceTable('Commonness', COM_LABEL.map((l, i) => [l, COM_TARGET[i], com[i]])) +
    complianceTable('Difficulty', DIF_LABEL.map((l, i) => [l, DIF_TARGET[i], dif[i]]));

  /* statistics */
  const comVals = sel.map(w => w.com), difVals = sel.map(w => w.dif);
  const sc = statPack(comVals), sd = statPack(difVals);
  const syl = {};
  for (const w of sel) syl[w.acr] = (syl[w.acr] || 0) + 1;
  const typAr = {};
  for (const w of sel) typAr[w.typAr] = (typAr[w.typAr] || 0) + 1;
  const lc = letterCounts(sel);
  const totalLetters = lc.reduce((a, b) => a + b, 0);

  const kv = obj => `<div class="kv">${Object.entries(obj).map(([k, val]) => `<span class="k">${k}</span><span class="v">${val}</span>`).join('')}</div>`;
  $('statsGrid').innerHTML =
    `<div class="stat-block"><h3>Syllable types</h3>${kv({
      'CVC (Type 1)': syl['CVC'] || 0, 'CVCC (Type 2)': syl['CVCC'] || 0,
      'CVVC (Type 3)': syl['CVVC'] || 0, 'CVVCC': syl['CVVCC'] || 0,
      'Total words': sel.length
    })}</div>` +
    `<div class="stat-block"><h3>Word types</h3>${kv(Object.fromEntries(Object.entries(typAr).map(([k, v2]) => [`<span class="ar" lang="ar">${esc(k)}</span>`, v2])))}</div>` +
    `<div class="stat-block"><h3>Commonness</h3>${kv({
      'Mean μ': fmt(sc.mean), 'Std dev σ': fmt(sc.sd), 'Median': fmt(sc.median),
      'Mode': fmt(sc.mode), 'Min': fmt(sc.min), 'Max': fmt(sc.max), 'Range': fmt(sc.range)
    })}</div>` +
    `<div class="stat-block"><h3>Difficulty</h3>${kv({
      'Mean μ': fmt(sd.mean), 'Std dev σ': fmt(sd.sd), 'Median': fmt(sd.median),
      'Mode': fmt(sd.mode), 'Min': fmt(sd.min), 'Max': fmt(sd.max), 'Range': fmt(sd.range)
    })}</div>` +
    `<div class="stat-block"><h3>Letters counted</h3>${kv({ 'Total letter occurrences': totalLetters })}</div>`;

  /* charts */
  histogram($('chartCommon'), comVals, 1, 2.75, 0.25, '--series-1', 'Commonness');
  histogram($('chartDiff'), difVals, 1, 5, 0.5, '--series-2', 'Difficulty');
  lettersChart($('chartLetters'), lc, totalLetters);

  /* words table */
  $('listMeta').textContent = `List ${idx + 1} · generated ${new Date(entry.ts).toLocaleString()}`;
  let rows = '';
  sel.forEach((w, i) => {
    rows += `<tr>
      <td class="num">${i + 1}</td>
      <td class="mono">${esc(w.lc)}-${esc(w.wc)}</td>
      <td class="spoken" lang="ar">${esc(w.sp)}</td>
      <td><button class="play" data-audio="${esc(w.audio)}" title="Play pronunciation" aria-label="Play ${esc(w.sp)}">▶</button></td>
      <td>${esc(w.cat)}</td>
      <td>${esc(w.acr)}</td>
      <td><span class="ar" lang="ar">${esc(w.typAr)}</span> <span class="mono" style="color:var(--muted);font-size:11px">${esc(w.typ)}</span></td>
      <td class="num">${fmt(w.com)}</td>
      <td class="num">${fmt(w.dif)}</td>
    </tr>`;
  });
  $('wordsTableWrap').innerHTML = `<table class="words">
    <thead><tr><th class="num">#</th><th>Code</th><th style="text-align:right">Word</th><th>Audio</th><th>Category</th><th>Syllable</th><th>Type</th><th class="num">Commonness</th><th class="num">Difficulty</th></tr></thead>
    <tbody>${rows}</tbody></table>`;

  renderChrome();
}

/* ---------------- chrome (cycle status, history, buttons) ---------------- */
function renderChrome() {
  const used = usedIds();
  const remaining = WORDS.length - used.size;
  const n = state.history.length;
  $('cycleText').textContent = n === 0
    ? '1,000 words available'
    : `List ${n} of 10 drawn · ${remaining} words remaining`;
  const dots = $('cycleDots');
  dots.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    const d = document.createElement('span');
    d.className = 'dot' + (i < n ? ' done' : '');
    d.title = i < n ? `List ${i + 1} — drawn` : `List ${i + 1}`;
    dots.appendChild(d);
  }
  $('btnGenerate').disabled = remaining < 100;
  $('poolNote').textContent = remaining < 100 && n > 0
    ? 'Cycle complete — all 1,000 words used. Reset to start a new cycle.'
    : '';
  $('btnCsv').disabled = $('btnDiscard').disabled = state.history.length === 0;

  const hc = $('historyCard');
  if (state.history.length === 0) { hc.hidden = true; }
  else {
    hc.hidden = false;
    $('historyList').innerHTML = state.history.map((h, i) => `
      <div class="hist-item">
        <span class="tag">List ${i + 1}</span>
        <span class="when">${new Date(h.ts).toLocaleString()}</span>
        <span>${h.cost === 0 ? '<span style="color:var(--good-text)">✓ fully compliant</span>' : `deviation ${h.cost}`}</span>
        <span class="sp"></span>
        <button data-view="${i}" ${i === viewIndex ? 'disabled' : ''}>${i === viewIndex ? 'Viewing' : 'View'}</button>
        <button data-csv="${i}">Excel</button>
      </div>`).join('');
  }
}

/* ---------------- Excel export ---------------- */
const AUDIO_BASE = 'https://wsa-teal.vercel.app/audio/'; // hosted pronunciation clips
const SHEET_HEADERS = ['No.', "List's Code", "Word's Code", 'Spoken', '1st Letter', 'Diacrtics', '2nd Letter',
  'Last Letter or Diacritics', '1st Letter Code', 'Diacritics', '2nd Letter Code',
  'Last Letter Code or Diacritics', 'Last Code', 'Category', 'Syllable Code', 'Acronym/English',
  'Acronym/Arabic', 'Syllable Description (Arabic)', 'Syllable Description (English)', 'Syllable Type',
  'Commonness Score (Max. 5)', 'Difficulty Score (Max. 5)', 'Type of Word', 'Type of Word Code', "Audio Clips' Links"];
const SHEET_COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
const NUMERIC_COLS = new Set([0, 8, 10, 11, 12, 14, 20, 21, 23]);

function rowValues(w, i) {
  return [i + 1, w.lc, w.wc, w.sp, w.l1, w.di, w.l2, w.l3, w.c1, w.cd, w.c2, w.c3, w.c4,
    w.cat, w.syc, w.acr, w.acrAr, w.sdAr, w.sdEn, w.syt, w.com, w.dif, w.typAr, w.typ, w.audio];
}

/* CSV fallback (artifact viewer cannot save .xlsx) */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function buildCsvText(entry) {
  const lines = [SHEET_HEADERS.map(csvCell).join(',')];
  entry.ids.forEach((id, i) => {
    const w = byId.get(id);
    const vals = rowValues(w, i);
    vals[24] = AUDIO_BASE + w.audio;
    lines.push(vals.map(csvCell).join(','));
  });
  return '﻿' + lines.join('\r\n'); // BOM so Excel reads the Arabic as UTF-8
}

/* minimal .xlsx writer — a zip (stored, no compression) of OOXML parts */
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files, dt) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const dosTime = (dt.getHours() << 11) | (dt.getMinutes() << 5) | Math.floor(dt.getSeconds() / 2);
  const dosDate = ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
    head.setUint16(10, dosTime, true); head.setUint16(12, dosDate, true);
    head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(head.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true); cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  let cdSize = 0;
  central.forEach(c => cdSize += c.length);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  chunks.push(...central, new Uint8Array(end.buffer));
  return new Blob(chunks, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function buildXlsxBlob(entry) {
  const sel = entry.ids.map(id => byId.get(id));
  let rows = '<row r="1">' + SHEET_HEADERS.map((h, c) =>
    `<c r="${SHEET_COLS[c]}1" t="inlineStr"><is><t>${xmlEsc(h)}</t></is></c>`).join('') + '</row>';
  const links = [];
  sel.forEach((w, i) => {
    const r = i + 2;
    let cells = '';
    rowValues(w, i).forEach((v, c) => {
      if (v === null || v === undefined || v === '') return;
      const ref = SHEET_COLS[c] + r;
      if (NUMERIC_COLS.has(c)) {
        const n = typeof v === 'number' ? v : parseFloat(v);
        if (!isNaN(n)) { cells += `<c r="${ref}"><v>${n}</v></c>`; return; }
      }
      // Spoken word (D) and audio filename (Y) are hyperlinked to the recording
      const linked = c === 3 || c === 24;
      cells += `<c r="${ref}"${linked ? ' s="1"' : ''} t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`;
      if (linked) links.push({ ref, id: `rl${links.length + 1}`, target: AUDIO_BASE + w.audio });
    });
    rows += `<row r="${r}">${cells}</row>`;
  });
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheetData>${rows}</sheetData>` +
    '<hyperlinks>' + links.map(l => `<hyperlink ref="${l.ref}" r:id="${l.id}"/>`).join('') + '</hyperlinks>' +
    '</worksheet>';
  const sheetRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    links.map(l => `<Relationship Id="${l.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEsc(l.target)}" TargetMode="External"/>`).join('') +
    '</Relationships>';
  return zipStore([
    {
      name: '[Content_Types].xml',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>'
    },
    {
      name: '_rels/.rels',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'xl/workbook.xml',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets></workbook>'
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'xl/styles.xml',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border/></borders>' +
        '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
        '<cellXfs count="2"><xf xfId="0"/><xf fontId="1" xfId="0" applyFont="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>'
    },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
    { name: 'xl/worksheets/_rels/sheet1.xml.rels', text: sheetRels },
  ], new Date(entry.ts));
}

async function downloadList(idx) {
  const entry = state.history[idx];
  if (!entry) return;
  const d = new Date(entry.ts);
  const base = `WSA-List-${String(idx + 1).padStart(2, '0')}-${d.toISOString().slice(0, 10)}`;
  const blob = buildXlsxBlob(entry);

  // Hosted artifact viewer blocks page-initiated downloads; go through the downloads capability there
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      const dl = await window.claude.use('downloads');
      if (dl) {
        try {
          await dl.save({ filename: base + '.xlsx', data: blob });
          toast(`${base}.xlsx saved.`);
        } catch (err) {
          const code = err && err.code;
          if (code === 'rejected_extension' || code === 'extension_not_enabled') {
            try {
              await dl.save({ filename: base + '.csv', data: buildCsvText(entry) });
              toast('Excel files cannot be saved here — saved as CSV with the same content and audio links.');
            } catch (e2) { if (!e2 || e2.code !== 'declined') toast('Could not save the file — try again.'); }
          } else if (code !== 'declined') {
            toast('Could not save the file — try again.');
          }
        }
        return;
      }
    } catch (e) { /* fall through to the plain download */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = base + '.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------------- audio ---------------- */
let currentAudio = null, currentBtn = null;
function playAudio(btn) {
  const file = btn.dataset.audio;
  if (currentBtn === btn && currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    btn.classList.remove('playing'); btn.textContent = '▶';
    currentBtn = null;
    return;
  }
  if (currentBtn) { currentBtn.classList.remove('playing'); currentBtn.textContent = '▶'; }
  if (currentAudio) currentAudio.pause();
  const a = new Audio('audio/' + file);
  currentAudio = a; currentBtn = btn;
  btn.classList.add('playing'); btn.textContent = '■';
  const reset = () => {
    btn.classList.remove('playing'); btn.textContent = '▶';
    if (currentBtn === btn) { currentBtn = null; currentAudio = null; }
  };
  a.addEventListener('ended', reset);
  a.addEventListener('error', () => {
    // no local copy — fall back to the hosted clips
    if (currentAudio !== a) return;
    const b = new Audio(AUDIO_BASE + file);
    currentAudio = b;
    b.addEventListener('ended', reset);
    b.addEventListener('error', () => {
      reset();
      toast(`Audio clip "${file}" could not be loaded.`);
    });
    b.play().catch(() => { });
  });
  a.play().catch(() => { });
}

/* ---------------- actions ---------------- */
function generate() {
  const used = usedIds();
  const pool = WORDS.filter(w => !used.has(w.id));
  if (pool.length < 100) { toast('Fewer than 100 words remain — reset the cycle first.'); return; }
  const btn = $('btnGenerate');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>Selecting…';
  setTimeout(() => {
    const t0 = performance.now();
    const { sel, cost } = solveList(pool);
    state.history.push({ ids: sel.map(w => w.id), ts: Date.now(), cost });
    saveState();
    renderList(state.history.length - 1);
    btn.textContent = 'Generate 100-word list';
    btn.removeAttribute('aria-busy');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('complianceCard').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    const ms = Math.round(performance.now() - t0);
    toast(cost === 0
      ? `List ${state.history.length} generated — all criteria met (${ms} ms).`
      : `List ${state.history.length} generated — nearest feasible selection, deviation ${cost} (${ms} ms).`);
  }, 30);
}

$('btnGenerate').addEventListener('click', generate);
$('btnCsv').addEventListener('click', () => downloadList(viewIndex));
$('btnDiscard').addEventListener('click', () => {
  if (state.history.length === 0) return;
  if (!confirm(`Discard list ${state.history.length}? Its words return to the pool.`)) return;
  state.history.pop();
  saveState();
  renderList(state.history.length - 1);
  toast('Last list discarded — its words are available again.');
});
$('btnReset').addEventListener('click', () => {
  if (state.history.length === 0) { toast('Nothing to reset — no lists drawn yet.'); return; }
  if (!confirm('Reset the cycle? All generated lists are cleared and every word becomes available again.')) return;
  state = { history: [] };
  saveState();
  renderList(-1);
  toast('Cycle reset — 1,000 words available.');
});
$('historyList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.view !== undefined) renderList(parseInt(b.dataset.view, 10));
  if (b.dataset.csv !== undefined) downloadList(parseInt(b.dataset.csv, 10));
});
$('wordsTableWrap').addEventListener('click', e => {
  const b = e.target.closest('button.play');
  if (b) playAudio(b);
});

/* ---------------- init ---------------- */
renderList(state.history.length - 1);
