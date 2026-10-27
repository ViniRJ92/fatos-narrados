import { mountLayout } from '../components/layout.js';
import { INDICATORS, TOPICS, indicatorById } from '../data/catalog.js';
import { GOVERNMENTS, governmentById, governmentForPeriod } from '../data/governments.js';
import { loadSeries } from '../core/data.js';
import { lineChart, legend } from '../components/chart.js';
import { sourceBox, downloadFile, dataTable } from '../components/widgets.js';
import { fmtValue, fmtPeriod, fmtNumber, html, raw, escapeHtml } from '../core/format.js';
import { filterRange, mean, compound, accumulate12, prevMonth } from '../data/transforms.js';
import { fetchBCB, fetchSidra } from '../api/official.js';

mountLayout();

const params = new URLSearchParams(location.search);
const state = {
  id: indicatorById(params.get('id')) ? params.get('id') : 'ipca-12m',
  cmp: params.get('cmp') || '',
  range: params.get('range') || '10a',
  gov: params.get('gov') || '',
  bands: params.get('bands') !== '0',
};

const $ = id => document.getElementById(id);
let chart = null;

// ---------- seletores ----------
$('ind').innerHTML = Object.entries(TOPICS).map(([t, info]) =>
  `<optgroup label="${escapeHtml(info.title)}">${INDICATORS.filter(i => i.topic === t).map(i => `<option value="${i.id}">${escapeHtml(i.short)}</option>`).join('')}</optgroup>`).join('');
$('gov').innerHTML = '<option value="">Escolha um mandato…</option>' + GOVERNMENTS.map(g => `<option value="${g.id}">${escapeHtml(g.short)} (${g.start.slice(0, 4)}–${g.end ? g.end.slice(0, 4) : 'atual'})</option>`).join('');

function syncUrl() {
  const p = new URLSearchParams({ id: state.id });
  if (state.cmp) p.set('cmp', state.cmp);
  if (state.range !== '10a') p.set('range', state.range);
  if (state.range === 'gov' && state.gov) p.set('gov', state.gov);
  if (!state.bands) p.set('bands', '0');
  history.replaceState(null, '', `?${p}`);
}

function rangeFor(doc, ind) {
  const last = doc.points.at(-1)[0];
  const y = +last.slice(0, 4);
  const sameMonth = n => (ind.freq === 'A' ? String(y - n) : `${y - n}${last.slice(4)}`);
  switch (state.range) {
    case '5a': return [sameMonth(5), null];
    case '10a': return [sameMonth(10), null];
    case '20a': return [sameMonth(20), null];
    case 'real': return [ind.startFrom || (ind.freq === 'A' ? '1995' : '1995-01'), null];
    case 'gov': {
      const g = governmentById(state.gov);
      if (!g) return [sameMonth(10), null];
      // inclui o mês anterior à posse (valor herdado)
      const from = ind.freq === 'A' ? String(+g.start.slice(0, 4) - 1) : prevMonth(g.start.slice(0, 7));
      const to = g.end ? (ind.freq === 'A' ? g.end.slice(0, 4) : g.end.slice(0, 7)) : null;
      return [from, to];
    }
    default: return [ind.startFrom || null, null];
  }
}

async function render() {
  const ind = indicatorById(state.id);
  syncUrl();
  $('ind').value = state.id;
  document.querySelectorAll('#ranges button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === state.range)));
  $('gov-field').hidden = state.range !== 'gov';
  $('gov').value = state.gov;
  $('bands').checked = state.bands;

  // comparação: só indicadores com a mesma unidade (nunca dois eixos)
  const comparable = INDICATORS.filter(i => i.id !== ind.id && i.unit === ind.unit && i.freq === ind.freq);
  $('cmp').innerHTML = '<option value="">— nenhum —</option>' + comparable.map(i => `<option value="${i.id}">${escapeHtml(i.short)}</option>`).join('');
  if (!comparable.some(i => i.id === state.cmp)) state.cmp = '';
  $('cmp').value = state.cmp;
  $('cmp-field').hidden = !comparable.length;

  document.title = `${ind.title} — Fatos e Narrativas`;
  $('title').textContent = ind.title;
  $('desc').textContent = ind.description;
  $('kicker').textContent = TOPICS[ind.topic].title;
  $('chart').innerHTML = '<p class="loading">Carregando série oficial…</p>';

  let doc, cmpDoc;
  try {
    [doc, cmpDoc] = await Promise.all([loadSeries(ind.id), state.cmp ? loadSeries(state.cmp) : null]);
  } catch (e) {
    $('chart').innerHTML = html`<p class="error">Não foi possível carregar a série: ${e.message}</p>`;
    return;
  }
  const [from, to] = rangeFor(doc, ind);
  const pts = filterRange(doc.points, from, to);
  const cmpInd = state.cmp ? indicatorById(state.cmp) : null;
  const series = [{ name: ind.short, points: pts }];
  if (cmpDoc) series.push({ name: cmpInd.short, points: filterRange(cmpDoc.points, from, to) });

  chart?.destroy();
  const holder = document.createElement('div');
  $('chart').innerHTML = legend(series);
  $('chart').append(holder);
  chart = lineChart(holder, {
    series, ind, freq: ind.freq, bands: state.bands,
    label: `${ind.title}, de ${fmtPeriod(pts[0]?.[0], ind.freq)} a ${fmtPeriod(pts.at(-1)?.[0], ind.freq)}. Use as setas para percorrer os valores.`,
  });
  $('chart-unit').textContent = ind.display === 'acc12' ? 'Variação acumulada em 12 meses (%)' : `Unidade: ${ind.unit}`;

  renderStats(ind, doc, pts, from, to);
  renderTable(ind, pts, cmpDoc ? { ind: cmpInd, pts: filterRange(cmpDoc.points, from, to) } : null);
  $('notes').innerHTML = html`<h2 class="h3" style="font-size:1.1rem">Sobre o dado</h2><p>${ind.description}</p><p class="muted">${ind.notes}</p>`;
  $('source').innerHTML = sourceBox(ind, doc);
  $('verify-result').textContent = '';

  $('dl-csv').onclick = () => {
    const header = ['periodo', ind.id, ...(cmpDoc ? [cmpInd.id] : []), 'governo'];
    const cmpMap = cmpDoc ? new Map(cmpDoc.points) : null;
    const lines = [header.join(';'), ...pts.map(([p, v]) => [p, String(v).replace('.', ','), ...(cmpMap ? [String(cmpMap.get(p) ?? '').replace('.', ',')] : []), governmentForPeriod(p)?.short || ''].join(';'))];
    downloadFile(`${ind.id}.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
  };
  $('dl-json').onclick = () => downloadFile(`${ind.id}.json`, JSON.stringify({ ...doc, points: pts }, null, 2), 'application/json');
}

function renderStats(ind, doc, pts, from, to) {
  if (!pts.length) { $('stats').innerHTML = ''; return; }
  const first = pts[0], last = pts.at(-1);
  const vals = pts.map(p => p[1]);
  const min = pts.reduce((a, b) => (b[1] < a[1] ? b : a)), max = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const isRate = ['%', '% PIB', '% a.a.'].includes(ind.unit);
  const diff = last[1] - first[1];
  const diffTxt = isRate ? `${diff > 0 ? '+' : ''}${fmtNumber(diff, ind.decimals)} p.p.` : `${diff > 0 ? '+' : ''}${fmtNumber((last[1] / first[1] - 1) * 100, 1)}%`;
  const cells = [
    ['Início', fmtValue(first[1], ind), fmtPeriod(first[0], ind.freq)],
    ['Fim', fmtValue(last[1], ind), fmtPeriod(last[0], ind.freq)],
    ['Diferença', diffTxt, isRate ? 'pontos percentuais' : 'variação percentual'],
    ['Mínimo', fmtValue(min[1], ind), fmtPeriod(min[0], ind.freq)],
    ['Máximo', fmtValue(max[1], ind), fmtPeriod(max[0], ind.freq)],
    ['Média', fmtValue(mean(vals), ind), `${pts.length} observações`],
  ];
  // Variação acumulada de preços no intervalo (somente séries com dados mensais de variação)
  const monthly = doc.monthly || (ind.id === 'ipca-mensal' ? doc.points : null);
  if (monthly) {
    const mFrom = ind.id === 'ipca-mensal' ? from : (from ? addMonths(first[0], -11) : null);
    const win = filterRange(monthly, mFrom, to);
    if (win.length) cells.push(['Acumulado no período', fmtValue(compound(win.map(p => p[1])), { unit: '%', decimals: 1 }), `${fmtPeriod(win[0][0])} a ${fmtPeriod(win.at(-1)[0])}`]);
  }
  $('stats').innerHTML = `<dl class="stats">${cells.map(([k, v, s]) => html`<div><dt>${k}</dt><dd>${v}<br><small>${s}</small></dd></div>`).join('')}</dl>`;
}

function addMonths(p, n) {
  let [y, m] = p.split('-').map(Number);
  m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function renderTable(ind, pts, cmp) {
  const cmpMap = cmp ? new Map(cmp.pts) : null;
  const rows = [...pts].reverse().map(([p, v]) => [
    escapeHtml(fmtPeriod(p, ind.freq)), escapeHtml(fmtValue(v, ind)),
    ...(cmpMap ? [escapeHtml(fmtValue(cmpMap.get(p), cmp.ind))] : []),
    escapeHtml(governmentForPeriod(p)?.short || '—'),
  ]);
  const header = ['Período', escapeHtml(ind.short), ...(cmp ? [escapeHtml(cmp.ind.short)] : []), 'Governo'];
  $('table').innerHTML = dataTable(rows, header, { numericCols: cmp ? [1, 2] : [1] });
}

// ---------- verificação ao vivo ----------
async function liveLatest(ind) {
  const f = ind.fetch;
  if (f.kind === 'bcb') {
    const since = new Date(Date.now() - (f.daily ? 70 : 800) * 864e5).toISOString().slice(0, 10);
    return fetchBCB(f, { since });
  }
  if (f.kind === 'sidra') return fetchSidra({ path: f.path.replace('/p/all', '/p/last%2013') });
  if (f.kind === 'sidra-chain') {
    const m = await fetchSidra({ path: `/t/${f.tables.at(-1)}/n1/all/v/${f.variable}/p/last%2012/c${f.classification}/${f.category}` });
    return accumulate12(m);
  }
  if (f.kind === 'derived') {
    const base = await liveLatest(indicatorById(f.from));
    return base.filter(([p]) => p.endsWith('-12')).map(([p, v]) => [p.slice(0, 4), v]);
  }
  return [];
}

$('verify').addEventListener('click', async () => {
  const ind = indicatorById(state.id);
  const btn = $('verify');
  btn.disabled = true;
  $('verify-result').innerHTML = '<span class="loading">Consultando a API oficial agora…</span>';
  try {
    const [doc, live] = await Promise.all([loadSeries(ind.id), liveLatest(ind)]);
    const l = live.at(-1);
    if (!l) throw new Error('a API não retornou dados');
    const saved = doc.points.find(p => p[0] === l[0]);
    const same = saved && Math.abs(saved[1] - l[1]) < 0.011;
    $('verify-result').innerHTML = html`Fonte oficial agora: <strong>${fmtValue(l[1], ind)}</strong> em ${fmtPeriod(l[0], ind.freq)}. ${raw(
      !saved ? '<strong>Há dado mais recente na fonte do que no portal</strong> — a próxima atualização vai incorporá-lo.'
        : same ? 'Confere com o valor exibido aqui. ✔'
          : html`O portal tem ${fmtValue(saved[1], ind)} para o mesmo período — provável revisão do órgão; a próxima atualização vai corrigir.`)}`;
  } catch (e) {
    $('verify-result').innerHTML = html`<span class="error">Não foi possível consultar a fonte agora (${e.message}). Tente novamente ou use o link do dado bruto.</span>`;
  } finally { btn.disabled = false; }
});

// ---------- eventos ----------
$('ind').addEventListener('change', e => { state.id = e.target.value; state.cmp = ''; render(); });
$('cmp').addEventListener('change', e => { state.cmp = e.target.value; render(); });
$('ranges').addEventListener('click', e => {
  const b = e.target.closest('button[data-range]');
  if (!b) return;
  state.range = b.dataset.range;
  if (state.range === 'gov' && !state.gov) state.gov = GOVERNMENTS.at(-1).id;
  render();
});
$('gov').addEventListener('change', e => { state.gov = e.target.value; render(); });
$('bands').addEventListener('change', e => { state.bands = e.target.checked; render(); });

render();
