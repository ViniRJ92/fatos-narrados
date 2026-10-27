import { mountLayout } from '../components/layout.js';
import { getJSON } from '../api/official.js';
import { barChart } from '../components/chart.js';
import { downloadFile } from '../components/widgets.js';
import { fmtMoneyBig, fmtNumber, fmtDate, html, raw, escapeHtml } from '../core/format.js';
import { toCSV } from '../data/transforms.js';

mountLayout();
const $ = id => document.getElementById(id);
const money = v => (v == null ? '—' : `R$ ${fmtNumber(v, 2)}`);
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

// =====================================================================
// PNCP — contratações publicadas
// Documentação: https://pncp.gov.br/api/consulta/swagger-ui/index.html
// =====================================================================
const MODALIDADES = [
  [6, 'Pregão eletrônico'], [8, 'Dispensa de licitação'], [9, 'Inexigibilidade'], [4, 'Concorrência eletrônica'],
  [5, 'Concorrência presencial'], [7, 'Pregão presencial'], [12, 'Credenciamento'], [1, 'Leilão eletrônico'],
  [13, 'Leilão presencial'], [3, 'Concurso'], [2, 'Diálogo competitivo'], [11, 'Pré-qualificação'], [10, 'Manifestação de interesse'],
];
$('p-mod').innerHTML = MODALIDADES.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
$('p-uf').innerHTML = '<option value="">Todas</option>' + UFS.map(u => `<option>${u}</option>`).join('');
const today = new Date();
const iso = d => d.toISOString().slice(0, 10);
$('p-to').value = iso(today);
$('p-from').value = iso(new Date(today - 7 * 864e5));

const pncp = { page: 1, total: 0, pages: 0, data: [] };

async function searchPNCP(page = 1) {
  const from = $('p-from').value, to = $('p-to').value;
  if (!from || !to || from > to) { $('p-out').innerHTML = '<p class="error">Informe um período válido.</p>'; return; }
  const q = new URLSearchParams({
    dataInicial: from.replaceAll('-', ''), dataFinal: to.replaceAll('-', ''),
    codigoModalidadeContratacao: $('p-mod').value, pagina: page, tamanhoPagina: 50,
  });
  if ($('p-uf').value) q.set('uf', $('p-uf').value);
  const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?${q}`;
  $('p-out').innerHTML = '<p class="loading">Consultando o PNCP…</p>';
  $('p-go').disabled = true;
  try {
    const j = await getJSON(url, { timeout: 60000, retries: 1 });
    Object.assign(pncp, { page, total: j.totalRegistros || 0, pages: j.totalPaginas || 0, data: j.data || [], url });
    renderPNCP();
  } catch (e) {
    $('p-out').innerHTML = html`<p class="error">O PNCP não respondeu (${e.message}). A API às vezes fica lenta; tente um período menor.</p>`;
  } finally { $('p-go').disabled = false; }
}

function renderPNCP() {
  const term = $('p-q').value.trim().toLowerCase();
  const rows = pncp.data.filter(d => !term || `${d.objetoCompra} ${d.orgaoEntidade?.razaoSocial}`.toLowerCase().includes(term));
  if (!pncp.total) { $('p-out').innerHTML = '<p class="empty">Nenhuma contratação publicada com esses filtros.</p>'; return; }
  const sumEst = rows.reduce((s, d) => s + (d.valorTotalEstimado || 0), 0);
  $('p-out').innerHTML = html`
    <p style="font-size:.9rem">${fmtNumber(pncp.total, 0)} contratações encontradas. Página ${pncp.page} de ${pncp.pages}${term ? `, ${rows.length} contêm “${term}”` : ''}. Valor estimado somado nesta página: <strong>${fmtMoneyBig(sumEst)}</strong>.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Publicação</th><th>Órgão</th><th>Local</th><th>Objeto</th><th class="num">Estimado</th><th class="num">Homologado</th><th>Ver</th></tr></thead>
      <tbody>${raw(rows.map(d => {
        const link = `https://pncp.gov.br/app/editais/${d.orgaoEntidade?.cnpj}/${d.anoCompra}/${d.sequencialCompra}`;
        return html`<tr>
          <td>${fmtDate(d.dataPublicacaoPncp)}</td>
          <td style="min-width:180px">${d.orgaoEntidade?.razaoSocial}<br><small class="muted">${{ F: 'Federal', E: 'Estadual', M: 'Municipal', D: 'Distrital' }[d.orgaoEntidade?.esferaId] || ''}</small></td>
          <td>${d.unidadeOrgao?.municipioNome}/${d.unidadeOrgao?.ufSigla}</td>
          <td style="min-width:260px"><span class="clamp-2" title="${d.objetoCompra}">${d.objetoCompra}</span><small class="muted">${d.modalidadeNome} · ${d.amparoLegal?.nome || ''}</small></td>
          <td class="num">${money(d.valorTotalEstimado)}</td>
          <td class="num">${money(d.valorTotalHomologado)}</td>
          <td><a href="${link}" target="_blank" rel="noopener">PNCP</a></td></tr>`;
      }).join(''))}</tbody></table></div>
    <div class="pager">
      <button class="btn" id="p-prev" ${pncp.page <= 1 ? 'disabled' : ''}>← Anterior</button>
      <button class="btn" id="p-next" ${pncp.page >= pncp.pages ? 'disabled' : ''}>Próxima →</button>
      <button class="btn" id="p-csv">CSV desta página</button>
    </div>
    <p class="muted" style="font-size:.8rem">Consulta feita agora em: <a class="mono" href="${pncp.url}" target="_blank" rel="noopener">${pncp.url}</a></p>`;
  $('p-prev').onclick = () => searchPNCP(pncp.page - 1);
  $('p-next').onclick = () => searchPNCP(pncp.page + 1);
  $('p-csv').onclick = () => downloadFile(`pncp-pagina-${pncp.page}.csv`, '﻿' + toCSV(rows.map(d => [
    d.dataPublicacaoPncp?.slice(0, 10), d.orgaoEntidade?.razaoSocial, d.orgaoEntidade?.cnpj, d.unidadeOrgao?.municipioNome, d.unidadeOrgao?.ufSigla,
    d.objetoCompra, d.modalidadeNome, d.valorTotalEstimado, d.valorTotalHomologado, d.numeroControlePNCP,
  ]), ['data', 'orgao', 'cnpj', 'municipio', 'uf', 'objeto', 'modalidade', 'valor_estimado', 'valor_homologado', 'controle_pncp']), 'text/csv;charset=utf-8');
}
$('p-form').addEventListener('submit', e => { e.preventDefault(); searchPNCP(1); });
$('p-q').addEventListener('input', () => { if (pncp.data.length) renderPNCP(); });

// =====================================================================
// Câmara dos Deputados — cota parlamentar (CEAP)
// Documentação: https://dadosabertos.camara.leg.br/swagger/api.html
// =====================================================================
const CAMARA = 'https://dadosabertos.camara.leg.br/api/v2';
const thisYear = today.getFullYear();
$('c-year').innerHTML = Array.from({ length: thisYear - 2018 }, (_, k) => thisYear - k).map(y => `<option>${y}</option>`).join('');
$('c-uf').innerHTML = '<option value="">Todas</option>' + UFS.map(u => `<option>${u}</option>`).join('');
// Legislaturas de 4 anos; a 57ª começou em 01/02/2023.
const legislatura = y => 57 + Math.floor((y - 2023) / 4);

$('c-form').addEventListener('submit', async e => {
  e.preventDefault();
  const q = new URLSearchParams({ ordem: 'ASC', ordenarPor: 'nome', itens: 100 });
  if ($('c-name').value.trim()) q.set('nome', $('c-name').value.trim());
  if ($('c-uf').value) q.set('siglaUf', $('c-uf').value);
  if (!q.has('nome') && !q.has('siglaUf')) { $('c-list').innerHTML = '<p class="error">Digite parte do nome ou escolha um estado.</p>'; return; }
  $('c-list').innerHTML = '<p class="loading">Buscando deputados…</p>';
  try {
    const j = await getJSON(`${CAMARA}/deputados?${q}`);
    $('c-list').innerHTML = j.dados.length
      ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">${j.dados.map(d => html`<button type="button" class="btn" data-id="${d.id}" data-nome="${d.nome}" style="justify-content:flex-start;text-align:left">${d.nome} <small class="muted">${d.siglaPartido}-${d.siglaUf}</small></button>`).join('')}</div>`
      : '<p class="empty">Nenhum deputado em exercício encontrado.</p>';
  } catch (err) { $('c-list').innerHTML = html`<p class="error">A API da Câmara não respondeu (${err.message}).</p>`; }
});

$('c-list').addEventListener('click', e => {
  const b = e.target.closest('button[data-id]');
  if (b) loadExpenses(b.dataset.id, b.dataset.nome);
});
$('c-year').addEventListener('change', () => { if (current) loadExpenses(current.id, current.nome); });

let current = null;
async function loadExpenses(id, nome) {
  current = { id, nome };
  const year = +$('c-year').value;
  $('c-out').innerHTML = html`<p class="loading">Baixando despesas de ${nome} em ${year}…</p>`;
  try {
    const all = [];
    let url = `${CAMARA}/deputados/${id}/despesas?idLegislatura=${legislatura(year)}&ano=${year}&itens=100&pagina=1&ordem=DESC&ordenarPor=dataDocumento`;
    for (let i = 0; url && i < 30; i++) {
      const j = await getJSON(url);
      all.push(...j.dados);
      url = j.links.find(l => l.rel === 'next')?.href || null;
    }
    renderExpenses(nome, year, all, id);
  } catch (err) {
    $('c-out').innerHTML = html`<p class="error">Falha ao consultar a Câmara (${err.message}).</p>`;
  }
}

function renderExpenses(nome, year, rows, id) {
  if (!rows.length) { $('c-out').innerHTML = html`<p class="empty">Nenhuma despesa de cota parlamentar registrada para ${nome} em ${year}.</p>`; return; }
  const total = rows.reduce((s, r) => s + (r.valorLiquido || 0), 0);
  const byType = {}, bySupplier = {};
  for (const r of rows) {
    byType[r.tipoDespesa] = (byType[r.tipoDespesa] || 0) + r.valorLiquido;
    const k = `${r.nomeFornecedor}|${r.cnpjCpfFornecedor}`;
    bySupplier[k] = (bySupplier[k] || 0) + r.valorLiquido;
  }
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const suppliers = Object.entries(bySupplier).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const cap = s => s.charAt(0) + s.slice(1).toLowerCase().replace(/\.$/, '');
  $('c-out').innerHTML = html`
    <h3>${nome} — cota parlamentar em ${year}</h3>
    <div class="stats" style="margin-bottom:1rem">
      <div><dt>Total reembolsado</dt><dd>${money(total)}</dd></div>
      <div><dt>Documentos</dt><dd>${fmtNumber(rows.length, 0)}</dd></div>
      <div><dt>Maior categoria</dt><dd>${cap(types[0][0])}</dd></div>
    </div>
    <div class="layout-2">
      <div><h4 style="margin:.2rem 0 .6rem">Por tipo de despesa</h4><div id="c-bars"></div></div>
      <div><h4 style="margin:.2rem 0 .6rem">Maiores fornecedores</h4>
        <div class="table-wrap"><table><thead><tr><th>Fornecedor</th><th class="num">Total</th></tr></thead>
        <tbody>${raw(suppliers.map(([k, v]) => { const [n, doc] = k.split('|'); return html`<tr><td>${n}<br><small class="muted mono">${doc}</small></td><td class="num">${money(v)}</td></tr>`; }).join(''))}</tbody></table></div>
      </div>
    </div>
    <details class="data-table" open><summary>Documentos (${rows.length})</summary>
      <div class="table-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Fornecedor</th><th class="num">Valor</th><th>Nota</th></tr></thead>
      <tbody>${raw(rows.slice(0, 300).map(r => html`<tr><td>${fmtDate(r.dataDocumento)}</td><td>${cap(r.tipoDespesa)}</td><td>${r.nomeFornecedor}</td><td class="num">${money(r.valorLiquido)}</td><td>${raw(r.urlDocumento ? html`<a href="${r.urlDocumento}" target="_blank" rel="noopener">abrir</a>` : '—')}</td></tr>`).join(''))}</tbody></table></div>
      ${rows.length > 300 ? 'Mostrando 300 documentos; baixe o CSV para ver todos.' : ''}
    </details>
    <p style="margin-top:.8rem"><button class="btn" id="c-csv">Baixar CSV</button> <span class="muted" style="font-size:.82rem">Fonte: Câmara dos Deputados, API Dados Abertos — <a class="mono" href="${CAMARA}/deputados/${id}/despesas?idLegislatura=${legislatura(year)}&ano=${year}" target="_blank" rel="noopener">consulta original</a></span></p>`;
  barChart($('c-bars'), types.map(([t, v]) => ({ label: cap(t), value: v, display: fmtMoneyBig(v) })), { ariaLabel: 'Despesas por tipo' });
  $('c-csv').onclick = () => downloadFile(`cota-${id}-${year}.csv`, '﻿' + toCSV(rows.map(r => [r.dataDocumento?.slice(0, 10), r.tipoDespesa, r.nomeFornecedor, r.cnpjCpfFornecedor, r.valorLiquido, r.urlDocumento]),
    ['data', 'tipo', 'fornecedor', 'cnpj_cpf', 'valor_liquido', 'documento']), 'text/csv;charset=utf-8');
}
