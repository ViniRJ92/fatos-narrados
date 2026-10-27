import { mountLayout } from '../components/layout.js';
import { METRICS, COMPARED, computeMetric, seriesPoints } from '../data/metrics.js';
import { indicatorById } from '../data/catalog.js';
import { loadMany } from '../core/data.js';
import { barChart } from '../components/chart.js';
import { fmtNumber, fmtPeriod, fmtIsoDate, html, raw, escapeHtml } from '../core/format.js';
import { downloadFile } from '../components/widgets.js';
import { toCSV } from '../data/transforms.js';

mountLayout();
const $ = id => document.getElementById(id);

const params = new URLSearchParams(location.search);
let selMetric = METRICS.find(m => m.id === params.get('m')) || METRICS[1];
let selGov = COMPARED.find(g => g.id === params.get('g')) || null;

$('matrix').innerHTML = '<p class="loading">Calculando métricas a partir das séries oficiais…</p>';
const docs = await loadMany([...new Set(METRICS.map(m => m.series))]);

// resultados[metricId][govId]
const results = Object.fromEntries(METRICS.map(m => [m.id, Object.fromEntries(COMPARED.map(g =>
  [g.id, computeMetric(m, g, seriesPoints(docs[m.series], m.use))]))]));

const signedUnits = ['p.p.', 'p.p. do PIB'];
function fmtMetric(m, v) {
  if (v == null) return '—';
  const signed = signedUnits.includes(m.unit) || ['renda', 'dolar', 'primario', 'saldo'].includes(m.id);
  const s = (signed && v > 0 ? '+' : '') + fmtNumber(v, m.decimals);
  if (m.unit === '%' || m.unit === '% a.a.') return `${s}%`;
  if (m.unit === 'US$ bi') return `US$ ${s} bi`;
  if (m.unit === '% do PIB') return `${s}%`;
  return `${s} ${m.unit.replace(' do PIB', '')}`;
}

function cellNote(r) {
  if (r.value == null) return r.reason || 'sem dado';
  if (r.ongoing) return 'em curso';
  if (r.partial) return 'parcial';
  return '';
}

function renderMatrix() {
  const groups = [...new Set(METRICS.map(m => m.group))];
  $('matrix').innerHTML = `<div class="table-wrap"><table class="gov-table">
    <caption class="sr-only">Indicadores por mandato presidencial, calculados com o mesmo método. Clique em um valor para ver o cálculo.</caption>
    <thead><tr><th scope="col" class="rowh">Indicador</th>${COMPARED.map(g => html`<th scope="col" class="num">${g.short}<br><small>${g.start.slice(0, 4)}–${g.end ? g.end.slice(0, 4) : 'atual'}</small></th>`).join('')}</tr></thead>
    <tbody>${groups.map(gr => `<tr><th colspan="${COMPARED.length + 1}" scope="colgroup" style="background:var(--surface);font-family:var(--serif);font-size:.95rem;color:var(--ink)">${escapeHtml(gr)}</th></tr>` +
      METRICS.filter(m => m.group === gr).map(m => html`<tr class="${m.id === selMetric.id ? 'selected' : ''}">
        <th scope="row" class="rowh"><button type="button" class="linklike" data-m="${m.id}" style="all:unset;cursor:pointer">${m.label}</button><br><small class="muted">${m.unit}</small></th>
        ${raw(COMPARED.map(g => {
          const r = results[m.id][g.id];
          const note = cellNote(r);
          return html`<td class="num">${raw(r.value == null
            ? `<span class="muted" title="${escapeHtml(note)}">—</span>`
            : html`<button type="button" data-m="${m.id}" data-g="${g.id}" aria-label="${m.label}, ${g.short}: ${fmtMetric(m, r.value)}${note ? ` (${note})` : ''}. Ver cálculo.">${fmtMetric(m, r.value)}</button>`)}${raw(note && r.value != null ? `<span class="partial">${escapeHtml(note)}</span>` : '')}</td>`;
        }).join(''))}</tr>`).join('')).join('')}
    </tbody></table></div>`;
}

function renderDetail() {
  const m = selMetric;
  const ind = indicatorById(m.series);
  $('metric-title').textContent = m.label;
  $('metric-explain').textContent = m.explain;
  const items = COMPARED.map(g => {
    const r = results[m.id][g.id];
    return { label: g.short, value: r.value, display: fmtMetric(m, r.value) + (r.ongoing ? ' *' : r.partial ? ' †' : ''), highlight: selGov?.id === g.id };
  });
  barChart($('bars'), items, { ariaLabel: `${m.label} por mandato` });

  const g = selGov;
  if (!g) {
    $('calc').innerHTML = '<p class="muted">Clique em um valor da tabela (ou em uma barra) para ver exatamente como ele foi calculado.</p>';
    return;
  }
  const r = results[m.id][g.id];
  const pv = p => (p ? `${fmtPeriod(p[0], ind.freq)}: ${fmtNumber(p[1], ind.decimals)}` : '—');
  const link = `indicador.html?id=${encodeURIComponent(m.series)}&range=gov&gov=${g.id}`;
  $('calc').innerHTML = html`
    <h3>${g.name}</h3>
    <p class="muted" style="font-size:.88rem">${fmtIsoDate(g.start)} a ${fmtIsoDate(g.end)}${g.note ? ` · ${g.note}` : ''}</p>
    <dl class="stats" style="margin:.8rem 0">
      <div><dt>Resultado</dt><dd>${fmtMetric(m, r.value)}</dd></div>
      ${raw(r.start ? html`<div><dt>${['delta', 'pct-change'].includes(m.method) ? 'Valor herdado' : 'Primeiro período'}</dt><dd>${pv(r.start)}</dd></div>` : '')}
      ${raw(r.end ? html`<div><dt>Último período</dt><dd>${pv(r.end)}</dd></div>` : '')}
      <div><dt>Observações usadas</dt><dd>${r.n}</dd></div>
    </dl>
    ${raw(r.ongoing ? '<p class="notice">Mandato em curso: o valor usa o último dado disponível e vai mudar.</p>' : '')}
    ${raw(r.partial ? '<p class="notice">Cobertura parcial: a série oficial começa depois da posse, então o cálculo não cobre o mandato inteiro.</p>' : '')}
    ${raw(r.value == null ? html`<p class="notice">Sem resultado: ${r.reason}.</p>` : '')}
    <p style="font-size:.9rem">Série usada: <a href="indicador.html?id=${m.series}">${ind.title}</a>. <a href="${link}">Ver o gráfico deste mandato →</a></p>`;
}

function select(mId, gId) {
  if (mId) selMetric = METRICS.find(m => m.id === mId);
  if (gId !== undefined) selGov = COMPARED.find(g => g.id === gId) || null;
  const p = new URLSearchParams({ m: selMetric.id });
  if (selGov) p.set('g', selGov.id);
  history.replaceState(null, '', `?${p}`);
  renderMatrix();
  renderDetail();
}

$('matrix').addEventListener('click', e => {
  const b = e.target.closest('button[data-m]');
  if (!b) return;
  select(b.dataset.m, b.dataset.g);
  if (b.dataset.g && matchMedia('(max-width: 999px)').matches) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('bars').addEventListener('click', e => {
  const row = e.target.closest('.bar-row');
  if (!row) return;
  const idx = [...row.parentElement.children].indexOf(row);
  select(null, COMPARED[idx].id);
});

$('dl').addEventListener('click', () => {
  const header = ['metrica', 'unidade', ...COMPARED.map(g => g.short)];
  const rows = METRICS.map(m => [m.label, m.unit, ...COMPARED.map(g => {
    const v = results[m.id][g.id].value;
    return v == null ? '' : Math.round(v * 1000) / 1000;
  })]);
  downloadFile('comparacao-governos.csv', '﻿' + toCSV(rows, header), 'text/csv;charset=utf-8');
});

renderMatrix();
renderDetail();
