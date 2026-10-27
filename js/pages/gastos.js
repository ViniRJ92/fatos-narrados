import { mountLayout } from '../components/layout.js';
import { SPENDING, FUNCOES } from '../data/catalog.js';
import { loadSeries } from '../core/data.js';
import { barChart, lineChart } from '../components/chart.js';
import { downloadFile, dataTable } from '../components/widgets.js';
import { fmtMoneyBig, fmtAxis, fmtNumber, fmtDateTime, html, escapeHtml } from '../core/format.js';
import { toCSV } from '../data/transforms.js';

mountLayout();
const $ = id => document.getElementById(id);

let doc;
try { doc = await loadSeries(SPENDING.id); }
catch (e) { $('bars').innerHTML = html`<p class="error">Dados de gastos indisponíveis: ${e.message}</p>`; throw e; }

const state = { year: doc.years.at(-1), real: true, fn: 'Saúde', excludeDebt: true };

/** Valor da função no ano i, com ajustes de refinanciamento e correção monetária. */
function value(fn, i) {
  let v = fn === '__total' ? doc.total[i] : doc.byFn[fn][i];
  if (v == null) return null;
  // Refinanciamento (rolagem) da dívida só aparece em alguns anos no Anexo 2: removido para manter comparabilidade.
  if (state.excludeDebt && (fn === '__total' || fn === 'Encargos Especiais')) v -= doc.refin[i] || 0;
  if (state.real) v *= doc.deflator[doc.years[i]] ?? NaN;
  return Number.isFinite(v) ? v : null;
}

$('year').innerHTML = doc.years.map(y => `<option>${y}</option>`).join('');
$('fn').innerHTML = FUNCOES.map(f => `<option${f === state.fn ? ' selected' : ''}>${escapeHtml(f)}</option>`).join('') + '<option value="__total">Total</option>';
$('meta').innerHTML = html`Fonte: Tesouro Nacional, SICONFI — RREO Anexo 2 da União, coluna “${doc.column}”. Baixado em ${fmtDateTime(doc.fetchedAt)}. <a href="${doc.query}" target="_blank" rel="noopener">Consulta original (JSON)</a>.`;

const pctOf = (v, total) => `${fmtNumber((v / total) * 100, 1)}% do total`;

function render() {
  const i = doc.years.indexOf(+state.year);
  $('year').value = state.year;
  document.querySelectorAll('#mode button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.mode === 'real') === state.real)));
  const priceNote = state.real ? `em R$ de ${doc.deflatorBase} (corrigido pela média anual do IPCA)` : 'em valores nominais (da época)';

  const total = value('__total', i);
  const rows = FUNCOES.map(fn => ({ fn, v: value(fn, i) })).filter(r => r.v != null && r.v > 0).sort((a, b) => b.v - a.v);
  $('total').innerHTML = html`<div class="stats">
    <div><dt>Despesa total liquidada em ${state.year}</dt><dd>${fmtMoneyBig(total)}<br><small>${priceNote}</small></dd></div>
    <div><dt>Maior função</dt><dd>${rows[0]?.fn}<br><small>${pctOf(rows[0]?.v, total)}</small></dd></div>
    <div><dt>Saúde</dt><dd>${fmtMoneyBig(value('Saúde', i))}<br><small>${pctOf(value('Saúde', i), total)}</small></dd></div>
    <div><dt>Educação</dt><dd>${fmtMoneyBig(value('Educação', i))}<br><small>${pctOf(value('Educação', i), total)}</small></dd></div>
  </div>`;
  barChart($('bars'), rows.map(r => ({ label: r.fn, value: r.v, display: `${fmtMoneyBig(r.v)} · ${fmtNumber((r.v / total) * 100, 1)}%`, highlight: r.fn === state.fn })),
    { ariaLabel: `Despesas por função em ${state.year}` });
  $('bars-caption').textContent = `Despesas liquidadas por função em ${state.year}, ${priceNote}.`;

  // evolução da função escolhida
  const label = state.fn === '__total' ? 'Total' : state.fn;
  $('fn-title').textContent = `Evolução: ${label}`;
  const pts = doc.years.map((y, k) => [String(y), value(state.fn, k)]).filter(p => p[1] != null);
  lineChart($('line'), {
    series: [{ name: label, points: pts }], ind: { unit: 'R$', decimals: 0 }, freq: 'A', height: 260,
    format: fmtMoneyBig, axisFormat: v => (v === 0 ? '0' : `R$ ${fmtAxis(v)}`),
    label: `Evolução das despesas com ${label}, ${priceNote}`,
  });

  // tabela completa
  const header = ['Função', ...doc.years.map(String)];
  const tableRows = [...FUNCOES, '__total'].map(fn => [fn === '__total' ? '<strong>Total</strong>' : escapeHtml(fn), ...doc.years.map((_, k) => escapeHtml(fmtMoneyBig(value(fn, k))))]);
  $('table').innerHTML = dataTable(tableRows, header, { numericCols: doc.years.map((_, k) => k + 1) });
}

$('year').addEventListener('change', e => { state.year = +e.target.value; render(); });
$('fn').addEventListener('change', e => { state.fn = e.target.value; render(); });
$('mode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { state.real = b.dataset.mode === 'real'; render(); } });
$('bars').addEventListener('click', e => {
  const row = e.target.closest('.bar-row');
  if (!row) return;
  state.fn = row.querySelector('.bar-label').textContent;
  $('fn').value = state.fn;
  render();
});
$('dl').addEventListener('click', () => {
  const header = ['funcao', ...doc.years.map(y => `${y}${state.real ? `_reais_de_${doc.deflatorBase}` : '_nominal'}`)];
  const rows = [...FUNCOES, '__total'].map(fn => [fn === '__total' ? 'Total' : fn, ...doc.years.map((_, k) => { const v = value(fn, k); return v == null ? '' : Math.round(v); })]);
  downloadFile('despesas-uniao-por-funcao.csv', '﻿' + toCSV(rows, header), 'text/csv;charset=utf-8');
});

render();
