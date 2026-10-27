/**
 * Gráficos em SVG puro, sem bibliotecas externas.
 *  - lineChart: séries temporais, com faixas dos mandatos presidenciais, crosshair e tooltip
 *  - barChart: barras horizontais em HTML (aceita valores negativos)
 *  - sparkline: minigráfico para cartões
 * Cores vêm de variáveis CSS (--series-n); o texto sempre usa tons de tinta.
 */
import { GOVERNMENTS, governmentForPeriod } from '../data/governments.js';
import { fmtAxis, fmtPeriod, fmtValue, escapeHtml } from '../core/format.js';

const NS = 'http://www.w3.org/2000/svg';
export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

export function periodToX(p) {
  if (/^\d{4}$/.test(p)) return +p + 0.5;
  const [y, m] = p.split('-').map(Number);
  return y + (m - 0.5) / 12;
}
const dateToX = iso => { const [y, m, d] = iso.split('-').map(Number); return y + (m - 1) / 12 + (d - 1) / 365; };

export function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : +v.toFixed(10));
  return ticks;
}

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
}

/**
 * @param {HTMLElement} container
 * @param {{series: {name:string, points:[string,number][], color?:string}[], ind:object, freq?:string,
 *          height?:number, bands?:boolean, includeZero?:boolean, label?:string}} opts
 */
export function lineChart(container, opts) {
  container.classList.add('chart');
  container.innerHTML = '';
  const series = opts.series.filter(s => s.points.length);
  if (!series.length) { container.innerHTML = '<div class="empty">Sem dados para o período selecionado.</div>'; return { destroy() {} }; }

  const tip = document.createElement('div');
  tip.className = 'tooltip'; tip.setAttribute('role', 'status'); tip.setAttribute('aria-live', 'polite');
  const svg = el('svg', { role: 'img', tabindex: '0', 'aria-label': opts.label || `Gráfico: ${series.map(s => s.name).join(', ')}` });
  container.append(svg, tip);

  // períodos únicos (eixo do tempo) a partir de todas as séries
  const periods = [...new Set(series.flatMap(s => s.points.map(p => p[0])))].sort();
  const maps = series.map(s => new Map(s.points));
  let idx = periods.length - 1;
  let geom = null;

  function render() {
    const W = Math.max(280, container.clientWidth);
    const H = opts.height || (W < 520 ? 240 : 320);
    const bandsOn = opts.bands !== false;
    const m = { top: bandsOn ? 22 : 10, right: 14, bottom: 26, left: 0 };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('height', H);
    svg.innerHTML = '';

    const values = series.flatMap(s => s.points.map(p => p[1])).filter(v => v != null);
    let ymin = Math.min(...values), ymax = Math.max(...values);
    if (opts.includeZero || (ymin < 0 && ymax > 0)) { ymin = Math.min(0, ymin); ymax = Math.max(0, ymax); }
    const pad = (ymax - ymin) * 0.06 || 1;
    const ticks = niceTicks(ymin - (ymin === 0 ? 0 : pad), ymax + pad, H < 260 ? 4 : 5);
    const y0 = ticks[0], y1 = ticks.at(-1);

    // margem esquerda conforme o maior rótulo
    const labels = ticks.map(t => (opts.axisFormat ? opts.axisFormat(t) : fmtAxis(t, opts.ind?.unit)));
    m.left = Math.max(...labels.map(l => l.length)) * 6.4 + 10;

    const x0 = periodToX(periods[0]) - (opts.freq === 'A' ? 0.5 : 1 / 24);
    const x1 = periodToX(periods.at(-1)) + (opts.freq === 'A' ? 0.5 : 1 / 24);
    const sx = x => m.left + ((x - x0) / (x1 - x0 || 1)) * (W - m.left - m.right);
    const sy = v => m.top + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.top - m.bottom);
    geom = { sx, sy, m, W, H };

    // faixas dos mandatos (tons neutros alternados — nunca cores partidárias)
    if (bandsOn) {
      const g = el('g', { 'aria-hidden': 'true' }, svg);
      GOVERNMENTS.forEach((gov, i) => {
        const a = Math.max(dateToX(gov.start), x0);
        const b = Math.min(gov.end ? dateToX(gov.end) + 1 / 365 : x1, x1);
        if (b <= a) return;
        const xa = sx(a), xb = sx(b);
        if (i % 2 === 0) el('rect', { class: 'band', x: xa, y: m.top - 18, width: xb - xa, height: H - m.bottom - m.top + 18 }, g);
        if (dateToX(gov.start) > x0) el('line', { class: 'band-sep', x1: xa, x2: xa, y1: m.top - 18, y2: H - m.bottom }, g);
        const label = el('text', { class: 'band-label', x: (xa + xb) / 2, y: m.top - 6, 'text-anchor': 'middle' }, g);
        const full = gov.short, w = xb - xa;
        label.textContent = w > full.length * 6.2 + 4 ? full : w > 26 ? full.split(' ')[0].slice(0, Math.floor(w / 6.5)) : '';
      });
    }

    // grade e eixo Y
    const ga = el('g', { class: 'axis' }, svg);
    ticks.forEach((t, i) => {
      el('line', { class: t === 0 ? 'zero-line' : 'grid-line', x1: m.left, x2: W - m.right, y1: sy(t), y2: sy(t) }, ga);
      const tx = el('text', { x: m.left - 8, y: sy(t) + 4, 'text-anchor': 'end' }, ga);
      tx.textContent = labels[i];
    });

    // eixo X: anos
    const yA = Math.ceil(x0), yB = Math.floor(x1);
    const span = yB - yA;
    const step = Math.max(1, Math.ceil(span / Math.max(2, Math.floor((W - m.left) / 64))));
    for (let y = yA; y <= yB; y += step) {
      const tx = el('text', { x: sx(y + (opts.freq === 'A' ? 0.5 : 0)), y: H - 8, 'text-anchor': 'middle' }, ga);
      tx.textContent = String(y);
    }

    // séries
    series.forEach((s, i) => {
      const color = s.color || SERIES_COLORS[i % SERIES_COLORS.length];
      let d = '', pen = false;
      for (const [p, v] of s.points) {
        if (v == null) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${sx(periodToX(p)).toFixed(1)},${sy(v).toFixed(1)}`;
        pen = true;
      }
      el('path', { class: 'series', d, stroke: color }, svg);
      if (s.points.length === 1 || opts.freq === 'A') {
        for (const [p, v] of s.points) if (v != null) el('circle', { cx: sx(periodToX(p)), cy: sy(v), r: 3, fill: color }, svg);
      }
    });

    // camada de interação
    const hover = el('g', { class: 'hover', style: 'display:none' }, svg);
    el('line', { class: 'crosshair', y1: m.top, y2: H - m.bottom }, hover);
    series.forEach((s, i) => el('circle', { class: 'dot', r: 4.5, fill: s.color || SERIES_COLORS[i % SERIES_COLORS.length] }, hover));
    el('rect', { x: m.left, y: 0, width: W - m.left - m.right, height: H, fill: 'transparent', class: 'hit' }, svg);
  }

  function show(i) {
    if (!geom) return;
    idx = Math.max(0, Math.min(periods.length - 1, i));
    const p = periods[idx];
    const hover = svg.querySelector('.hover');
    hover.style.display = '';
    const x = geom.sx(periodToX(p));
    const ch = hover.querySelector('.crosshair');
    ch.setAttribute('x1', x); ch.setAttribute('x2', x);
    const dots = hover.querySelectorAll('.dot');
    const rows = [];
    series.forEach((s, k) => {
      const v = maps[k].get(p);
      if (v == null) { dots[k].style.display = 'none'; return; }
      dots[k].style.display = '';
      dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', geom.sy(v));
      rows.push(`<div class="t-row"><span><span class="sw" style="background:${s.color || SERIES_COLORS[k % SERIES_COLORS.length]}"></span>${escapeHtml(s.name)}</span><strong>${escapeHtml(opts.format ? opts.format(v) : fmtValue(v, opts.ind))}</strong></div>`);
    });
    const gov = governmentForPeriod(p);
    tip.innerHTML = `<div class="t-period">${escapeHtml(fmtPeriod(p, opts.freq))}</div>${gov ? `<div class="t-gov">Governo: ${escapeHtml(gov.short)}</div>` : ''}${rows.join('')}`;
    tip.classList.add('show');
    const tw = tip.offsetWidth;
    const left = x + 14 + tw > geom.W ? x - 14 - tw : x + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${geom.m.top + 4}px`;
  }
  function hide() { const h = svg.querySelector('.hover'); if (h) h.style.display = 'none'; tip.classList.remove('show'); }

  function nearest(clientX) {
    const r = svg.getBoundingClientRect();
    const scale = geom.W / r.width;
    const px = (clientX - r.left) * scale;
    let best = 0, bd = Infinity;
    periods.forEach((p, i) => { const d = Math.abs(geom.sx(periodToX(p)) - px); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  svg.addEventListener('pointermove', e => show(nearest(e.clientX)));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', () => show(idx));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', e => {
    const step = e.shiftKey ? 12 : 1;
    if (e.key === 'ArrowLeft') { show(idx - step); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { show(idx + step); e.preventDefault(); }
    else if (e.key === 'Home') { show(0); e.preventDefault(); }
    else if (e.key === 'End') { show(periods.length - 1); e.preventDefault(); }
    else if (e.key === 'Escape') hide();
  });

  render();
  const ro = new ResizeObserver(() => { render(); });
  ro.observe(container);
  return { destroy() { ro.disconnect(); } };
}

/** Legenda HTML (sempre presente para 2+ séries). */
export function legend(series) {
  if (series.length < 2) return '';
  return `<div class="legend">${series.map((s, i) => `<span><span class="sw" style="background:${s.color || SERIES_COLORS[i]}"></span>${escapeHtml(s.name)}</span>`).join('')}</div>`;
}

/** Minigráfico para cartões de indicador. */
export function sparkline(points, { width = 240, height = 40 } = {}) {
  const pts = points.filter(p => p[1] != null);
  if (pts.length < 2) return '';
  const vs = pts.map(p => p[1]);
  const min = Math.min(...vs), max = Math.max(...vs);
  const sx = i => (i / (pts.length - 1)) * (width - 4) + 2;
  const sy = v => height - 3 - ((v - min) / (max - min || 1)) * (height - 6);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
  const last = pts.at(-1);
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}" fill="none" stroke="var(--series-1)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    <circle cx="${sx(pts.length - 1)}" cy="${sy(last[1])}" r="2.5" fill="var(--series-1)"/></svg>`;
}

/**
 * Barras horizontais (HTML). items: [{label, value, display?, note?, highlight?}]
 * Suporta negativos com eixo zero.
 */
export function barChart(container, items, { format = v => String(v), ariaLabel = 'Gráfico de barras' } = {}) {
  const vals = items.map(i => i.value).filter(v => v != null);
  if (!vals.length) { container.innerHTML = '<div class="empty">Sem dados.</div>'; return; }
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const span = max - min || 1;
  const zero = (-min / span) * 100;
  container.innerHTML = `<div class="bars" role="img" aria-label="${escapeHtml(ariaLabel)}">${items.map(it => {
    if (it.value == null) return `<div class="bar-row"><div class="bar-label">${escapeHtml(it.label)}</div><div class="bar-track"><span class="bar-na">sem dado</span></div><div class="bar-val">—</div></div>`;
    const w = (Math.abs(it.value) / span) * 100;
    const left = it.value >= 0 ? zero : zero - w;
    return `<div class="bar-row${it.highlight ? ' hl' : ''}" title="${escapeHtml(it.note || '')}">
      <div class="bar-label">${escapeHtml(it.label)}</div>
      <div class="bar-track">${min < 0 ? `<span class="bar-zero" style="left:${zero}%"></span>` : ''}<span class="bar-fill" style="left:${left}%;width:${Math.max(w, 0.4)}%"></span></div>
      <div class="bar-val">${escapeHtml(it.display ?? format(it.value))}</div></div>`;
  }).join('')}</div>`;
}
