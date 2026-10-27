import { mountLayout } from '../components/layout.js';
import { loadData } from '../core/data.js';
import { barChart } from '../components/chart.js';
import { ufMap } from '../components/map.js';
import { downloadFile } from '../components/widgets.js';
import { fmtMoneyBig, fmtNumber, fmtDateTime, html, raw, escapeHtml } from '../core/format.js';
import { toCSV } from '../data/transforms.js';
import { TIPOS, SITUACAO_LABEL, EMENDAS_SOURCES, V } from '../data/emendas-catalog.js';
import { expandYear, applyFilters, summarize, groupBy, FLAG, FLAG_LABEL, INCOMPLETA, norm } from '../data/emendas-model.js';

mountLayout();
const $ = id => document.getElementById(id);
const PAGE = 25;
const brl = v => (v == null ? '—' : `R$ ${fmtNumber(v, 2)}`);

let meta;
try { meta = await loadData('emendas/meta.json'); }
catch (e) {
  $('status').innerHTML = html`<p class="notice">Os dados de emendas não estão disponíveis agora (${e.message}). Eles são baixados do Portal da Transparência a cada publicação do site; se a CGU estiver fora do ar, tente mais tarde.</p>`;
  throw e;
}

const years = meta.years.map(y => y.ano);
const thisYear = String(new Date().getFullYear());
const defaultYear = [...years].reverse().find(y => y < thisYear) || years.at(-1);
const cache = new Map();
let list = [], filtered = [], page = 0;
const state = { tab: 'lista' };

// ---------- opções fixas dos filtros
$('anos').innerHTML = [...years].reverse().map(y => `<option value="${y}">${y}${y === thisYear ? ' (em execução)' : ''}</option>`).join('')
  + `<option value="ultimos3">Últimos 3 anos completos</option><option value="todos">Todos os anos (${years[0]} a ${years.at(-1)}, mais pesado)</option>`;
$('tipo').innerHTML += Object.entries(TIPOS).map(([k, t]) => `<option value="${escapeHtml(k)}">${escapeHtml(t.short)}</option>`).join('');
$('situacao').innerHTML += Object.entries(SITUACAO_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
$('transp').innerHTML += '<option value="incompleta">Qualquer informação incompleta</option>'
  + [FLAG.SEM_AUTOR, FLAG.SEM_CODIGO, FLAG.VALORES_INCONSISTENTES, FLAG.SO_RECEBIMENTOS].map(f => `<option value="flag-${f}">${FLAG_LABEL[f]}</option>`).join('')
  + '<option value="" disabled>Restrição formal de acesso (a base não registra)</option>';
const partidos = [...new Set(meta.autores.flatMap(a => a[3]))].sort();
$('partido').innerHTML += partidos.map(p => `<option>${escapeHtml(p)}</option>`).join('');
$('dl-autores').innerHTML = meta.autores.map(a => `<option value="${escapeHtml(a[1])}">`).join('');

// ---------- carregamento
function yearsFor(sel) {
  if (sel === 'todos') return years;
  if (sel === 'ultimos3') return years.filter(y => y < thisYear).slice(-3);
  return [sel];
}
async function loadYears(ys) {
  $('status').innerHTML = html`<p class="loading">Carregando emendas de ${ys.join(', ')}…</p>`;
  const docs = await Promise.all(ys.map(async y => {
    if (!cache.has(y)) cache.set(y, expandYear(await loadData(`emendas/ano-${y}.json`), meta.autores));
    return cache.get(y);
  }));
  list = docs.flat();
  $('status').innerHTML = html`<p class="notice neutral">Base oficial da CGU baixada em ${fmtDateTime(meta.updatedAt)}. Anos carregados: ${ys.join(', ')}${ys.includes(thisYear) ? ` (o ano de ${thisYear} ainda está em execução)` : ''}. <a href="${EMENDAS_SOURCES.cgu.page}" target="_blank" rel="noopener">Fonte original</a>.</p>`;
  // opções que dependem dos dados carregados
  const ufs = [...new Set(list.flatMap(e => e.ufs))].sort();
  $('uf').innerHTML = '<option value="">Todas</option>' + ufs.map(u => `<option>${u}</option>`).join('');
  const progs = new Map(list.flatMap(e => e.parts.map(p => [p.prog, p.progName])));
  $('programa').innerHTML = '<option value="">Todos</option>' + [...progs].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([c, n]) => `<option value="${escapeHtml(c)}">${escapeHtml(`${c} · ${n}`)}</option>`).join('');
  const funcs = [...new Set(list.flatMap(e => e.funcs))].sort();
  $('funcao').innerHTML = '<option value="">Todas</option>' + funcs.map(f => `<option>${escapeHtml(f)}</option>`).join('');
  $('dl-municipios').innerHTML = [...new Set(list.flatMap(e => e.municipios))].sort().slice(0, 6000).map(m => `<option value="${escapeHtml(m)}">`).join('');
}

// ---------- filtros ↔ URL
const form = $('f');
function readForm() { return Object.fromEntries(new FormData(form).entries()); }
function writeForm(p) { for (const el of form.elements) if (el.name && p.has(el.name)) el.value = p.get(el.name); }
function syncUrl(f) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  if (state.tab !== 'lista') p.set('aba', state.tab);
  history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
}

async function instrumentoIds(num) {
  const ys = [...new Set(list.map(e => e.ano))];
  const ids = new Set();
  const n = num.replace(/\D/g, '');
  for (const y of ys) {
    const det = await loadData(`emendas/det-${y}.json`).catch(() => null);
    if (!det) continue;
    for (const [id, convs] of Object.entries(det.conv)) if (convs.some(c => String(c[0]) === n)) ids.add(id);
  }
  return ids;
}

let running = 0;
async function run() {
  const my = ++running;
  const f = readForm();
  const ys = yearsFor(f.anos || defaultYear);
  await loadYears(ys);
  if (f.instrumento) f.instrumentoIds = await instrumentoIds(f.instrumento);
  if (my !== running) return;
  filtered = applyFilters(list, f);
  page = 0;
  delete f.instrumentoIds;
  syncUrl(f);
  render(ys);
}

// ---------- painel
function card(label, value, { periodo, fonte = 'CGU, Portal da Transparência', metodo, note } = {}) {
  return html`<div class="card kpi">
    <span class="label">${label}</span>
    <span class="value" style="font-size:1.55rem">${value}</span>
    ${raw(note ? html`<span class="meta">${note}</span>` : '')}
    <details style="font-size:.8rem;color:var(--ink-3);margin-top:.3rem"><summary style="cursor:pointer">Período, fonte e método</summary>
      <p style="margin:.3rem 0 0"><strong>Período:</strong> ${periodo}<br><strong>Fonte:</strong> ${fonte}<br><strong>Método:</strong> ${metodo}</p></details>
  </div>`;
}

function renderCards(ys) {
  const t = summarize(filtered);
  const periodo = `emendas de ${ys.length > 1 ? `${ys[0]} a ${ys.at(-1)}` : ys[0]}, filtros aplicados`;
  $('cards').innerHTML = [
    card('Total autorizado', 'Não disponível', { periodo, fonte: 'Não consta na base consultada', metodo: 'A dotação autorizada de cada emenda não está no arquivo da CGU. Ela aparece no Siga Brasil (Senado), que não tem API pública.', note: 'Não está na base da CGU' }),
    card('Empenhado', fmtMoneyBig(t.emp), { periodo, metodo: 'Soma de "Valor Empenhado" das emendas filtradas. Execução orçamentária.' }),
    card('Liquidado no ano', fmtMoneyBig(t.liq), { periodo, metodo: 'Soma de "Valor Liquidado". Só inclui o ano da emenda; o que é liquidado depois aparece como restos a pagar.' }),
    card('Pago', fmtMoneyBig(t.pago), { periodo, metodo: 'Pago no ano mais restos a pagar pagos nos anos seguintes. Por isso pode ser maior que o liquidado no ano.', note: 'Inclui restos a pagar pagos depois' }),
    card('Ainda não pago (estimativa)', fmtMoneyBig(t.naoPago), { periodo, metodo: 'Empenhado menos pago, restos a pagar pagos e restos a pagar cancelados, emenda a emenda.' }),
    card('Emendas identificadas', fmtNumber(t.n, 0), { periodo, metodo: 'Registros distintos. Linhas sem código são contadas uma a uma e marcadas.', note: t.soRecebimentos ? `${fmtNumber(t.soRecebimentos, 0)} conhecidas só pelos recebimentos` : '' }),
    card('Beneficiários', fmtNumber(t.nFavs, 0), { periodo, metodo: 'Favorecidos distintos (CNPJ ou código) que receberam recursos dessas emendas. Pessoas físicas não são identificadas e contam uma vez por município.', note: 'Recebimentos não somam aos totais' }),
    card('Municípios contemplados', fmtNumber(t.nMunicipios, 0), { periodo, metodo: 'Códigos IBGE distintos na localidade de aplicação. Emendas com destino "Múltiplo", "Nacional" ou estadual não entram.' }),
    card('Órgãos executores', 'Não disponível', { periodo, fonte: 'Não consta na base consultada', metodo: 'O arquivo de emendas da CGU não informa o órgão executor. Nas transferências especiais, a página de cada emenda mostra a unidade que empenhou e pagou.' }),
    card('Com informação incompleta', fmtNumber(t.incompletas, 0), { periodo, metodo: 'Sem código, sem autor, com valores inconsistentes ou conhecidas só pelos recebimentos. Veja a aba Qualidade dos dados.' }),
    card('Restrição formal de acesso', 'Não identificável', { periodo, metodo: 'Nenhuma das bases consultadas registra sigilo ou restrição formal. A falta de um documento não é tratada como sigilo.', note: 'A base não registra esse dado' }),
  ].join('');
}

// ---------- lista
const sorters = { emp: (a, b) => b.v[V.EMP] - a.v[V.EMP], pago: (a, b) => b.pago - a.pago, naoPago: (a, b) => b.naoPago - a.naoPago, id: (a, b) => a.id.localeCompare(b.id) };
function renderList() {
  const sorted = [...filtered].sort(sorters[$('ordem').value]);
  const slice = sorted.slice(page * PAGE, (page + 1) * PAGE);
  const f = readForm();
  $('count').textContent = `${fmtNumber(filtered.length, 0)} emendas encontradas`
    + (f.beneficiario || f.cnpj ? '. Os valores são das emendas inteiras, não só do que esse beneficiário recebeu (veja a página de cada emenda).' : '');
  $('lista').innerHTML = slice.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Emenda</th><th>Autor</th><th>Destino</th><th class="num">Empenhado</th><th class="num">Pago</th><th>Situação</th></tr></thead>
    <tbody>${slice.map(e => html`<tr>
      <td><a href="emenda.html?id=${encodeURIComponent(e.id)}">${e.id.startsWith('SI-') ? 'Sem código' : e.id}</a><br><small class="muted">${e.ano} · ${e.tipoShort}</small>
        ${raw(e.flags & INCOMPLETA ? '<br><small class="badge requer-chave">informação incompleta</small>' : '')}</td>
      <td>${e.autor.nome}${raw(e.autor.casa ? html`<br><small class="muted">${e.autor.casa}${e.autor.partidos.length ? ` · ${e.autor.partidos.join('/')}` : ''}</small>` : '')}</td>
      <td style="min-width:200px">${e.parts.slice(0, 2).map(p => p.loc).join('; ')}${e.parts.length > 2 ? ` e mais ${e.parts.length - 2}` : ''}<br><small class="muted">${e.funcs.join(', ')}</small></td>
      <td class="num">${brl(e.v[V.EMP])}</td><td class="num">${brl(e.pago)}</td>
      <td>${SITUACAO_LABEL[e.situacao]}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="empty">Nenhuma emenda com esses filtros.</p>';
  const pages = Math.ceil(filtered.length / PAGE);
  $('pager').innerHTML = pages > 1 ? html`<button class="btn" data-p="${page - 1}" ${raw(page === 0 ? 'disabled' : '')}>← Anterior</button><span>Página ${page + 1} de ${pages}</span><button class="btn" data-p="${page + 1}" ${raw(page >= pages - 1 ? 'disabled' : '')}>Próxima →</button>` : '';
}
$('pager').addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (b) { page = +b.dataset.p; renderList(); $('count').scrollIntoView({ block: 'start' }); } });
$('ordem').addEventListener('change', () => { page = 0; renderList(); });

$('csv').addEventListener('click', () => {
  const header = ['emenda', 'ano', 'tipo', 'autor', 'casa', 'partido', 'numero', 'localidades', 'ufs', 'areas', 'empenhado', 'liquidado', 'pago_no_ano', 'restos_a_pagar_pagos', 'restos_a_pagar_cancelados', 'pago_total', 'nao_pago_estimado', 'situacao', 'convenios', 'alertas', 'fonte'];
  const rows = filtered.map(e => [e.id, e.ano, e.tipo, e.autor.nome, e.autor.casa || '', e.autor.partidos.join('/'), e.numero || '', e.parts.map(p => p.loc).join(' | '), e.ufs.join('/'), e.funcs.join('/'),
    e.v[V.EMP], e.v[V.LIQ], e.v[V.PAGO], e.v[V.RAP_PAGO], e.v[V.RAP_CANC], Math.round(e.pago * 100) / 100, Math.round(e.naoPago * 100) / 100, SITUACAO_LABEL[e.situacao], e.nConv,
    Object.entries(FLAG_LABEL).filter(([b]) => e.flags & b).map(([, l]) => l).join(' | '), EMENDAS_SOURCES.cgu.page]);
  downloadFile('emendas-filtradas.csv', '﻿' + toCSV(rows, header), 'text/csv;charset=utf-8');
});

// ---------- mapa
let geo = null, mapUF = null;
async function renderMap() {
  geo ||= await loadData('geo/uf.json').catch(() => null);
  if (!geo) { $('mapa').innerHTML = '<p class="empty">Malha do IBGE indisponível.</p>'; return; }
  const metric = $('mapa-valor').value;
  const groups = groupBy(filtered, 'uf');
  const values = Object.fromEntries(groups.map(g => [g.key, metric === 'n' ? g.n : g[metric]]));
  const fmt = v => (metric === 'n' ? `${fmtNumber(v, 0)} emendas` : fmtMoneyBig(v));
  mapUF = readForm().uf || mapUF;
  ufMap($('mapa'), geo, values, { format: fmt, selected: mapUF, label: 'Recursos de emendas por estado', onSelect: uf => { mapUF = uf; renderMap(); } });
  const sem = groups.find(g => g.key === 'sem-uf');
  $('mapa-nota').textContent = `Valores pela localidade de aplicação informada na emenda, repartidos por estado. ${sem ? `${fmt(values['sem-uf'])} não têm estado definido (destino nacional ou múltiplo) e não aparecem no mapa.` : ''} A cor indica o estado, nunca o endereço de uma obra.`;
  // municípios do estado selecionado
  const muni = groupBy(filtered, 'municipio').filter(g => !mapUF || String(g.label).endsWith(` - ${mapUF}`)).sort((a, b) => b.pago - a.pago).slice(0, 15);
  $('mun-title').textContent = mapUF ? `Municípios de ${mapUF}` : 'Municípios com mais recursos pagos';
  $('municipios').innerHTML = muni.length ? `<ol style="padding-left:1.2rem;margin:0">${muni.map(m => html`<li><button type="button" class="linklike" data-mun="${m.label}" style="all:unset;cursor:pointer;color:var(--accent)">${m.label}</button> <small class="muted">${fmtMoneyBig(m.pago)} pagos · ${m.n} emendas</small></li>`).join('')}</ol>` : '<p class="muted">Sem municípios identificados.</p>';
  const areas = groupBy(mapUF ? filtered.filter(e => e.ufs.includes(mapUF)) : filtered, 'funcao').sort((a, b) => b.pago - a.pago).slice(0, 6);
  barChart($('areas'), areas.map(a => ({ label: a.label, value: a.pago, display: fmtMoneyBig(a.pago) })), { ariaLabel: 'Áreas com mais recursos pagos' });
}
$('mapa-valor').addEventListener('change', renderMap);
$('municipios').addEventListener('click', e => {
  const b = e.target.closest('button[data-mun]');
  if (!b) return;
  form.elements.municipio.value = b.dataset.mun;
  setTab('lista'); run();
});

// ---------- comparação
function renderCompare() {
  const dim = $('cmp-dim').value, met = $('cmp-met').value;
  const q = $('cmp-q').value.split(',').map(s => norm(s.trim())).filter(Boolean);
  let g = groupBy(filtered, dim);
  if (q.length) g = g.filter(x => q.some(t => norm(x.label).includes(t) || norm(x.key) === t));
  g.sort(dim === 'ano' ? (a, b) => String(a.key).localeCompare(String(b.key)) : (a, b) => (b[met] ?? -1) - (a[met] ?? -1));
  const top = dim === 'ano' ? g : g.slice(0, 20);
  const fmt = v => (v == null ? '—' : met === 'pctPago' ? `${fmtNumber(v, 1)}%` : ['n', 'nFavs'].includes(met) ? fmtNumber(v, 0) : fmtMoneyBig(v));
  $('cmp').innerHTML = '<div id="cmp-bars"></div><div id="cmp-table" style="margin-top:1rem"></div>';
  barChart($('cmp-bars'), top.map(x => ({ label: x.label, value: x[met], display: fmt(x[met]) })), { ariaLabel: 'Comparação' });
  $('cmp-table').innerHTML = `<details class="data-table"><summary>Tabela com todas as medidas</summary><div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Emendas</th><th class="num">Empenhado</th><th class="num">Pago</th><th class="num">Pago/empenhado</th><th class="num">Beneficiários</th></tr></thead><tbody>${
    top.map(x => html`<tr><td>${x.label}</td><td class="num">${fmtNumber(x.n, 0)}</td><td class="num">${fmtMoneyBig(x.emp)}</td><td class="num">${fmtMoneyBig(x.pago)}</td><td class="num">${x.pctPago == null ? '—' : `${fmtNumber(x.pctPago, 1)}%`}</td><td class="num">${fmtNumber(x.nFavs, 0)}</td></tr>`).join('')}</tbody></table></div></details>`;
}
['cmp-dim', 'cmp-met'].forEach(id => $(id).addEventListener('change', renderCompare));
$('cmp-q').addEventListener('input', renderCompare);

// ---------- tipos
function renderTipos() {
  $('tipos').innerHTML = Object.entries(TIPOS).map(([k, t]) => {
    const sub = filtered.filter(e => e.tipo === k);
    const s = summarize(sub);
    return html`<article class="card"><h3>${t.short}</h3><p style="font-size:.9rem">${t.note}</p>
      <p class="muted" style="font-size:.85rem;margin:0">Nos filtros atuais: ${fmtNumber(s.n, 0)} emendas, ${fmtMoneyBig(s.emp)} empenhados, ${fmtMoneyBig(s.pago)} pagos.</p></article>`;
  }).join('');
}

// ---------- qualidade
function renderQualidade() {
  const q = meta.quality;
  const loaded = summarize(filtered);
  const counts = Object.fromEntries(Object.keys(FLAG_LABEL).map(b => [b, filtered.filter(e => e.flags & b).length]));
  const files = meta.files.map(f => `${f.name} (${fmtNumber(f.bytes / 1e6, 1)} MB)`).join(', ');
  $('qualidade').innerHTML = html`<div class="layout-2"><div class="card">
    <h2 style="font-size:1.2rem">Ocorrências nos dados filtrados</h2>
    <p class="muted" style="font-size:.88rem">Nenhum registro é apagado por causa de uma divergência. Os casos são marcados e continuam visíveis na busca.</p>
    <div class="table-wrap"><table><thead><tr><th>Ocorrência</th><th class="num">Emendas</th></tr></thead><tbody>
      ${raw(Object.entries(FLAG_LABEL).map(([b, l]) => html`<tr><td>${l}</td><td class="num">${fmtNumber(counts[b], 0)}</td></tr>`).join(''))}
    </tbody></table></div>
    <p style="font-size:.88rem;margin-top:.8rem">Total de ${fmtNumber(loaded.n, 0)} emendas nos filtros atuais.</p>
  </div><aside class="card">
    <h2 style="font-size:1.1rem">Base completa da CGU</h2>
    <ul style="font-size:.88rem;padding-left:1.1rem">
      <li>Baixada em ${fmtDateTime(meta.updatedAt)}. Arquivos: ${files}.</li>
      <li>${fmtNumber(meta.lines.emendas, 0)} linhas de execução, ${fmtNumber(meta.lines.favorecidos, 0)} de recebimentos e ${fmtNumber(meta.lines.convenios, 0)} de convênios.</li>
      <li>${fmtNumber(q.semCodigo, 0)} linhas sem código de emenda e ${fmtNumber(q.semAutor, 0)} sem autor identificado (quase todas de 2014 e de emendas de bancada e relator até 2020).</li>
      <li>${fmtNumber(q.favSemCodigo || 0, 0)} recebimentos, somando ${fmtMoneyBig(q.favSemCodigoValor || 0)}, não trazem código de emenda e não podem ser ligados a uma emenda.</li>
      <li>${fmtNumber(q.convSemEmenda, 0)} convênios citam emendas que não estão no arquivo de execução.</li>
      <li>${fmtNumber(q.valoresInconsistentes, 0)} emendas têm liquidado ou pago maior que o empenhado.</li>
      <li>${fmtNumber(q.favSemEmenda, 0)} emendas aparecem só no arquivo de recebimentos e foram preservadas sem valores de execução.</li>
      <li>Casa e partido: ${meta.parlamentaresVerificados ? 'cruzados com as listas da Câmara e do Senado' : 'não verificados nesta atualização (listas indisponíveis)'}; ${fmtNumber(meta.autores.filter(a => a[5] === 'ambiguo').length, 0)} nomes aparecem nas duas Casas e ${fmtNumber(meta.autores.filter(a => a[5] === 'nao-encontrado').length, 0)} não foram encontrados.</li>
      <li>A base é atualizada pela CGU; o ano corrente está sempre incompleto.</li>
    </ul>
  </aside></div>`;
}

// ---------- abas
function setTab(t) {
  state.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === t)));
  document.querySelectorAll('.tab').forEach(s => { s.hidden = s.id !== `tab-${t}`; });
  renderTab();
  syncUrl(readForm());
}
function renderTab() {
  if (state.tab === 'mapa') renderMap();
  else if (state.tab === 'comparar') renderCompare();
  else if (state.tab === 'tipos') renderTipos();
  else if (state.tab === 'qualidade') renderQualidade();
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

function render() { renderCards(yearsFor(readForm().anos || defaultYear)); renderList(); renderTab(); }

// ---------- eventos
let timer;
form.addEventListener('input', e => { if (e.target.name === 'uf') mapUF = e.target.value || null; clearTimeout(timer); timer = setTimeout(run, 300); });
form.addEventListener('submit', e => { e.preventDefault(); run(); });
form.addEventListener('reset', () => { mapUF = null; setTimeout(() => { $('anos').value = defaultYear; run(); }, 0); });

// estado inicial a partir da URL
const params = new URLSearchParams(location.search);
$('anos').value = params.get('anos') && [...$('anos').options].some(o => o.value === params.get('anos')) ? params.get('anos') : defaultYear;
await loadYears(yearsFor($('anos').value));
writeForm(params);
if (params.get('aba')) state.tab = params.get('aba');
document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === state.tab)));
document.querySelectorAll('.tab').forEach(s => { s.hidden = s.id !== `tab-${state.tab}`; });
run();
