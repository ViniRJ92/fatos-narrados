import { mountLayout } from '../components/layout.js';
import { INDICATORS, TOPICS } from '../data/catalog.js';
import { loadMany, loadSeries } from '../core/data.js';
import { lineChart, barChart } from '../components/chart.js';
import { sourceLine } from '../components/widgets.js';
import { fmtValue, fmtPeriod, fmtNumber, html, escapeHtml } from '../core/format.js';
import { filterRange, compound } from '../data/transforms.js';

mountLayout();
const $ = id => document.getElementById(id);
const topicId = TOPICS[new URLSearchParams(location.search).get('t')] ? new URLSearchParams(location.search).get('t') : 'contas-publicas';
const topic = TOPICS[topicId];
const inds = INDICATORS.filter(i => i.topic === topicId);

document.title = `${topic.title} — Fatos Narrados`;
$('title').textContent = topic.title;
$('desc').textContent = topic.desc;
$('topic-nav').innerHTML = Object.entries(TOPICS).map(([id, t]) =>
  `<a class="btn${id === topicId ? ' primary' : ''}" href="tema.html?t=${id}"${id === topicId ? ' aria-current="page"' : ''}>${escapeHtml(t.title)}</a>`).join('') +
  '<a class="btn" href="gastos.html">Gastos por área</a>';

const docs = await loadMany(inds.map(i => i.id));

// ---------- extras por tema ----------
if (topicId === 'custo-de-vida') renderCostOfLiving();
if (topicId === 'contas-publicas') $('extra').innerHTML = html`<div class="card"><h2 style="font-size:1.2rem">Para onde vai o dinheiro federal?</h2><p class="muted">Despesas liquidadas pela União por função (saúde, educação, previdência, segurança…), segundo o RREO enviado ao Tesouro Nacional.</p><a class="btn primary" href="gastos.html">Ver gastos por função →</a></div>`;

// ---------- pequenos múltiplos ----------
$('charts').innerHTML = inds.map(i => html`<article class="card" id="c-${i.id}">
  <h3><a href="indicador.html?id=${i.id}">${i.title}</a></h3>
  <p class="muted" style="font-size:.86rem;margin-bottom:.4rem">${docs[i.id] ? `Último dado: ${fmtValue(docs[i.id].points.at(-1)[1], i)} (${fmtPeriod(docs[i.id].points.at(-1)[0], i.freq)})` : 'Indisponível'}</p>
  <div class="chart-slot"></div>
  <div class="chart-foot"><span>Fonte: ${sourceLine(i)}</span><a href="indicador.html?id=${i.id}">Explorar →</a></div>
</article>`).join('');

for (const i of inds) {
  const doc = docs[i.id];
  const slot = document.querySelector(`#c-${CSS.escape(i.id)} .chart-slot`);
  if (!doc) { slot.innerHTML = '<p class="empty">Série indisponível.</p>'; continue; }
  const lastYear = +doc.points.at(-1)[0].slice(0, 4);
  const from = i.freq === 'A' ? String(lastYear - 20) : `${lastYear - 15}-01`;
  lineChart(slot, { series: [{ name: i.short, points: filterRange(doc.points, from) }], ind: i, freq: i.freq, height: 220, label: `${i.title}, últimos 15 anos` });
}

function renderCostOfLiving() {
  const items = inds.filter(i => i.display === 'acc12');
  $('extra').innerHTML = html`<div class="layout-2">
    <div class="card">
      <h2 style="font-size:1.2rem">O que mais subiu nos últimos 12 meses</h2>
      <p class="muted" style="font-size:.88rem">Variação de preços acumulada em 12 meses, por item do IPCA, comparada ao índice geral (em destaque).</p>
      <div id="ranking"></div>
    </div>
    <div class="card">
      <h2 style="font-size:1.2rem">Calculadora da inflação</h2>
      <p class="muted" style="font-size:.88rem">Corrige um valor pelo IPCA oficial entre dois meses.</p>
      <form id="calc" class="grid" style="gap:.6rem">
        <label class="field"><span>Valor (R$)</span><input type="number" id="calc-v" min="0" step="0.01" value="100" inputmode="decimal"></label>
        <label class="field"><span>De (mês)</span><input type="month" id="calc-from" value="2015-01" min="1995-01"></label>
        <label class="field"><span>Até (mês)</span><input type="month" id="calc-to"></label>
        <button class="btn primary" type="submit">Calcular</button>
      </form>
      <p id="calc-out" aria-live="polite" style="margin-top:.8rem"></p>
    </div>
  </div>`;
  const general = docs['ipca-12m'];
  const rows = items.map(i => ({ label: i.short, value: docs[i.id]?.points.at(-1)?.[1] ?? null, period: docs[i.id]?.points.at(-1)?.[0] }));
  if (general) rows.push({ label: 'IPCA geral', value: general.points.at(-1)[1], highlight: true, period: general.points.at(-1)[0] });
  rows.sort((a, b) => (b.value ?? -999) - (a.value ?? -999));
  barChart($('ranking'), rows.map(r => ({ ...r, display: `${r.value > 0 ? '+' : ''}${fmtNumber(r.value, 1)}%` })), { ariaLabel: 'Variação em 12 meses por item do IPCA' });
  const p = rows.find(r => r.period)?.period;
  if (p) $('ranking').insertAdjacentHTML('beforeend', html`<p class="muted" style="font-size:.8rem;margin-top:.5rem">12 meses até ${fmtPeriod(p)}. Fonte: IBGE, SIDRA 7060.</p>`);

  loadSeries('ipca-mensal').then(doc => {
    const last = doc.points.at(-1)[0];
    $('calc-to').value = last; $('calc-to').max = last; $('calc-from').max = last;
    const run = () => {
      const v = parseFloat($('calc-v').value);
      const a = $('calc-from').value, b = $('calc-to').value;
      if (!(v >= 0) || !a || !b || a > b) { $('calc-out').innerHTML = '<span class="error">Informe um valor e um intervalo válido (início antes do fim).</span>'; return; }
      // Correção de a até b: inclui as variações dos meses de a (inclusive) até b (inclusive).
      const win = filterRange(doc.points, a, b);
      const acc = compound(win.map(x => x[1]));
      $('calc-out').innerHTML = html`<strong style="font-size:1.4rem">R$ ${fmtNumber(v * (1 + acc / 100), 2)}</strong><br><span class="muted">IPCA acumulado de ${fmtPeriod(win[0][0])} a ${fmtPeriod(win.at(-1)[0])}: ${fmtNumber(acc, 2)}% (${win.length} meses). R$ ${fmtNumber(v, 2)} no início do período compram o mesmo que esse valor ao fim.</span>`;
    };
    $('calc').addEventListener('submit', e => { e.preventDefault(); run(); });
    run();
  });
}
