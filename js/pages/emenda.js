import { mountLayout } from '../components/layout.js';
import { loadData } from '../core/data.js';
import { getJSON } from '../api/official.js';
import { downloadFile } from '../components/widgets.js';
import { fmtNumber, fmtMoneyBig, fmtDateTime, html, raw, escapeHtml } from '../core/format.js';
import { toCSV } from '../data/transforms.js';
import { TIPOS, V, VALUE_LABELS, SITUACAO_LABEL, ACESSO, EMENDAS_SOURCES } from '../data/emendas-catalog.js';
import { expandYear, anoDoId, FLAG_LABEL } from '../data/emendas-model.js';

mountLayout();
const $ = id => document.getElementById(id);
const brl = v => (v == null ? '—' : `R$ ${fmtNumber(v, 2)}`);
const ym = s => (s ? `${s.slice(4, 6)}/${s.slice(0, 4)}` : '—');
const dt = s => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const TG = EMENDAS_SOURCES.transferegov.api;

const id = new URLSearchParams(location.search).get('id') || '';
const ano = anoDoId(id);
if (!ano) { $('app').innerHTML = '<p class="notice">Informe o código de uma emenda. Use a <a href="emendas.html">busca de emendas</a>.</p>'; throw new Error('sem id'); }

let meta, doc, det;
try {
  [meta, doc, det] = await Promise.all([loadData('emendas/meta.json'), loadData(`emendas/ano-${ano}.json`), loadData(`emendas/det-${ano}.json`).catch(() => null)]);
} catch (e) {
  $('app').innerHTML = html`<p class="notice">Os dados de emendas não estão disponíveis agora (${e.message}).</p>`;
  throw e;
}
const e = expandYear({ ...doc, rows: doc.rows.filter(r => r[0] === id) }, meta.autores)[0];
if (!e) { $('app').innerHTML = html`<p class="notice">A emenda ${id} não foi encontrada na base da CGU baixada em ${fmtDateTime(meta.updatedAt)}.</p>`; throw new Error('não encontrada'); }

document.title = `Emenda ${e.id.startsWith('SI-') ? 'sem código' : e.id} | Fatos Narrados`;
const tipo = TIPOS[e.tipo];
const favs = (det?.fav?.[e.id] || []).map(([i, total, first, last, n]) => ({ f: det.favs[i], total, first, last, n })).sort((a, b) => b.total - a.total);
const convs = det?.conv?.[e.id] || [];
const isPix = e.grupo === 'pix' && /^\d{12}$/.test(e.id);

// ---------- estrutura da página
$('app').innerHTML = html`
  <header class="page-head">
    <p class="kicker">${tipo?.short || e.tipo} · ${e.ano}</p>
    <h1>${e.id.startsWith('SI-') ? 'Emenda sem código na base' : `Emenda ${e.id}`}</h1>
    <p class="lead">${e.autor.nome}${e.autor.casa ? ` · ${e.autor.casa}` : ''}${e.autor.partidos.length ? ` · ${e.autor.partidos.join('/')}` : ''}. Destino: ${e.parts.map(p => p.loc).slice(0, 3).join('; ')}${e.parts.length > 3 ? ` e mais ${e.parts.length - 3}` : ''}.</p>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      <button class="btn" id="share" type="button">Copiar link</button>
      <button class="btn" id="print" type="button">Imprimir relatório</button>
      <button class="btn" id="dl-json" type="button">Baixar JSON</button>
      <button class="btn" id="dl-csv" type="button">Baixar CSV</button>
      ${raw(/^\d{12}$/.test(e.id)
        ? html`<a class="btn" href="https://portaldatransparencia.gov.br/emendas/detalhe?codigoEmenda=${e.id}" target="_blank" rel="noopener">Ver no Portal da Transparência</a>`
        : html`<a class="btn" href="${EMENDAS_SOURCES.cgu.page}" target="_blank" rel="noopener">Fonte oficial (CGU)</a>`)}
    </div>
    <p id="share-msg" class="muted" style="font-size:.85rem" aria-live="polite"></p>
  </header>
  ${raw(e.flags ? html`<p class="notice">Alertas de qualidade: ${Object.entries(FLAG_LABEL).filter(([b]) => e.flags & b).map(([, l]) => l).join('; ')}. O registro é mostrado como está na base oficial.</p>` : '')}

  <section><h2>Valores</h2>
    <dl class="stats">
      <div><dt>Valor autorizado</dt><dd>Não disponível<br><small>não consta na base da CGU</small></dd></div>
      ${raw(e.v.map((x, i) => html`<div><dt>${VALUE_LABELS[i]}</dt><dd>${brl(x)}</dd></div>`).join(''))}
      <div><dt>Pago no total</dt><dd>${brl(e.pago)}<br><small>pago no ano + restos a pagar pagos</small></dd></div>
      <div><dt>Ainda não pago (estimativa)</dt><dd>${brl(e.naoPago)}</dd></div>
      <div><dt>Situação</dt><dd>${SITUACAO_LABEL[e.situacao]}</dd></div>
    </dl>
    <p class="muted" style="font-size:.84rem;margin-top:.5rem">Os valores são da execução orçamentária no arquivo da CGU. Os recebimentos por favorecido (abaixo) mostram o caminho do mesmo dinheiro e não são somados a estes valores. ${e.recebido ? `Recebimentos registrados: ${brl(e.recebido)}.` : ''}</p>
  </section>

  <section><h2>Quem fez o quê</h2>
    <p class="muted">Apresentar a emenda, autorizar a despesa, empenhar, pagar e receber são etapas diferentes, feitas por pessoas e órgãos diferentes. O autor da emenda não é automaticamente responsável pelo pagamento.</p>
    <div id="papeis"></div>
  </section>

  <section><h2>Para onde foi o dinheiro</h2><div id="destino"></div></section>

  <section><h2>Linha do tempo</h2>
    <p class="muted">Só aparecem como registradas as etapas documentadas nas bases consultadas. Uma etapa sem informação não é sinal de irregularidade.</p>
    <ol id="timeline" class="timeline"></ol>
  </section>

  <section id="pix-sec" ${raw(isPix ? '' : 'hidden')}><h2>Transferência especial no Transferegov.br</h2><div id="pix"><p class="loading">Consultando o Transferegov.br agora…</p></div></section>

  <section><h2>Quem recebeu</h2><div id="favs"></div></section>
  <section><h2>Convênios e instrumentos</h2><div id="convs"></div></section>
  <section><h2>Documentos</h2><div id="docs"></div></section>
  <section><h2>Sigilo e transparência</h2><div id="acesso"></div></section>
  <section><h2>Fontes deste registro</h2><div id="fontes"></div></section>`;

// ---------- quem fez o quê (preenchido também pelos dados do Transferegov)
const papeis = {
  autor: html`${e.autor.nome}${e.autor.casa ? ` (${e.autor.casa}${e.autor.partidos.length ? `, ${e.autor.partidos.join('/')}` : ''})` : ''}`
    + (e.autor.match === 'nome' ? ' <small class="muted">casa e partido cruzados pelo nome com as listas oficiais</small>' : e.autor.match === 'ambiguo' ? ' <small class="muted">o nome aparece na Câmara e no Senado</small>' : ''),
  indicacao: e.grupo === 'relator' ? 'A base registra o relator-geral como autor. Quem pediu o recurso não está identificado nesta base.' : e.grupo === 'bancada' || e.grupo === 'comissao' ? 'Autoria coletiva. Os parlamentares que indicaram o destino não estão identificados nesta base.' : 'O próprio autor (emenda individual).',
  analise: 'Não localizado nesta base.',
  autorizacao: 'Não disponível nesta base.',
  empenho: 'Não disponível na base da CGU (o arquivo traz o valor, não a unidade).',
  pagamento: 'Não disponível na base da CGU.',
  beneficiario: favs.length ? `${favs.length} favorecido(s) com recebimentos registrados (lista abaixo).` : 'Não localizado nesta base.',
  executor: convs.length ? `Convenente: ${escapeHtml(convs.map(c => c[1]).slice(0, 3).join('; '))}` : 'Não localizado nesta base.',
  assinaturas: 'Nomes de agentes públicos que assinaram atos não constam nas bases consultadas.',
};
function renderPapeis() {
  const rows = [['Autor da emenda', papeis.autor], ['Indicação do destino', papeis.indicacao], ['Órgão que analisou', papeis.analise], ['Autorização administrativa', papeis.autorizacao],
    ['Unidade que empenhou', papeis.empenho], ['Unidade que pagou', papeis.pagamento], ['Quem recebeu', papeis.beneficiario], ['Quem executa', papeis.executor], ['Assinaturas', papeis.assinaturas]];
  $('papeis').innerHTML = `<div class="table-wrap"><table><tbody>${rows.map(([k, v]) => `<tr><th scope="row" style="width:220px">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- destino
$('destino').innerHTML = html`<div class="grid cards">
  <div class="card"><h3>Finalidade declarada no orçamento</h3>
    <ul style="padding-left:1.1rem;font-size:.9rem;margin:0">${raw(e.parts.map(p => html`<li><strong>${p.loc}</strong>${p.uf ? ` (${p.uf})` : ''}: ${p.funcName} / ${p.subfName}. Programa ${p.prog} · ${p.progName}. Ação ${p.acao} · ${p.acaoName}${p.poName ? `. ${p.poName}` : ''}. Empenhado ${brl(p.v[V.EMP])}, pago ${brl(p.v[V.PAGO] + p.v[V.RAP_PAGO])}.</li>`).join(''))}</ul></div>
  <div class="card"><h3>Objeto contratado ou pactuado</h3><div id="objeto">${raw(convs.length ? `<ul style="padding-left:1.1rem;font-size:.9rem;margin:0">${convs.map(c => html`<li>Convênio ${c[0]}: ${c[2]}</li>`).join('')}</ul>` : '<p class="muted" style="font-size:.9rem">Nenhum instrumento vinculado nesta base.</p>')}</div></div>
  <div class="card"><h3>Resultado entregue</h3><div id="entregue"><p class="muted" style="font-size:.9rem">O portal não verifica se a obra ou o serviço foi entregue. Pagamento não prova entrega. ${isPix ? 'O relatório de gestão do Transferegov, quando existe, aparece abaixo.' : 'Para isso, consulte a prestação de contas no órgão responsável.'}</p></div></div>
</div>`;

// ---------- linha do tempo
const STEP_STATE = { ok: 'Registrada', nl: 'Informação não localizada', nd: 'Etapa não disponível nesta base', load: 'Consultando…' };
const steps = [
  { t: 'Apresentação da emenda', s: e.id.startsWith('SI-') ? 'nl' : 'ok', d: e.id.startsWith('SI-') ? 'A base não traz o código da emenda.' : `Código ${e.id}, ano ${e.ano}, autor ${escapeHtml(e.autor.nome)}.` },
  { t: 'Registro no orçamento', s: e.parts.length ? 'ok' : 'nl', d: `Programa e ação: ${escapeHtml([...new Set(e.parts.map(p => `${p.prog}/${p.acao}`))].join(', '))}.` },
  { t: 'Autorização', s: 'nd', d: 'A base da CGU não registra o ato de autorização.' },
  { t: 'Empenho', s: e.v[V.EMP] > 0 ? 'ok' : 'nl', d: e.v[V.EMP] > 0 ? `${brl(e.v[V.EMP])} empenhados (número da nota de empenho não consta nesta base).` : 'Nenhum valor empenhado registrado.' },
  { t: 'Liquidação', s: e.v[V.LIQ] > 0 || e.v[V.RAP_PAGO] > 0 ? 'ok' : 'nl',
    d: e.v[V.LIQ] > 0 ? `${brl(e.v[V.LIQ])} liquidados no ano da emenda.`
      : e.v[V.RAP_PAGO] > 0 ? 'A liquidação ocorreu depois do ano da emenda (restos a pagar). A base não separa esse valor.' : 'Nenhum valor liquidado registrado.' },
  { t: 'Pagamento', s: e.pago > 0 ? 'ok' : 'nl', d: e.pago > 0 ? `${brl(e.v[V.PAGO])} pagos no ano e ${brl(e.v[V.RAP_PAGO])} em restos a pagar.` : 'Nenhum pagamento registrado.' },
  { t: 'Transferência ao beneficiário', s: favs.length ? 'ok' : 'nl', d: favs.length ? `Recebimentos entre ${ym(e.primeiro)} e ${ym(e.ultimo)}, por ${favs.length} favorecido(s).` : 'Nenhum recebimento por favorecido registrado.' },
  { t: 'Execução do objeto', s: convs.length ? 'ok' : 'nd', d: convs.length ? `${convs.length} convênio(s) com objeto registrado. Isso não confirma a entrega.` : 'A base da CGU não acompanha a execução física.' },
  { t: 'Prestação de contas', s: 'nd', d: 'A base da CGU não traz prestação de contas.' },
  { t: 'Devoluções, cancelamentos ou pendências', s: e.v[V.RAP_CANC] > 0 ? 'ok' : 'nl', d: e.v[V.RAP_CANC] > 0 ? `${brl(e.v[V.RAP_CANC])} em restos a pagar cancelados.` : 'Nenhum cancelamento ou devolução registrado.' },
];
function renderTimeline() {
  $('timeline').innerHTML = steps.map((s, i) => `<li class="step ${s.s}"><span class="step-n">${i + 1}</span><div><strong>${s.t}</strong> <span class="badge ${s.s === 'ok' ? 'integrada' : 'catalogada'}">${STEP_STATE[s.s]}</span><p style="margin:.2rem 0 0;font-size:.9rem">${s.d}</p></div></li>`).join('');
}

// ---------- favorecidos e convênios
$('favs').innerHTML = favs.length ? html`<div class="table-wrap"><table><thead><tr><th>Favorecido</th><th>Tipo</th><th>Local</th><th class="num">Recebido</th><th>Período</th></tr></thead><tbody>
  ${raw(favs.slice(0, 200).map(x => html`<tr><td>${x.f[1]}${raw(x.f[0] ? html`<br><small class="muted mono">${x.f[0]}</small>` : '')}</td><td>${x.f[3]}<br><small class="muted">${x.f[2]}</small></td><td>${x.f[5]}/${x.f[4]}</td><td class="num">${brl(x.total)}</td><td>${ym(x.first)} a ${ym(x.last)} · ${x.n} pagamento(s)</td></tr>`).join(''))}
  </tbody></table></div>${raw(favs.length > 200 ? '<p class="muted">Mostrando os 200 maiores. O CSV traz todos.</p>' : '')}
  <p class="muted" style="font-size:.84rem">Pessoas físicas aparecem agrupadas por município, sem nome nem CPF.</p>`
  : '<p class="muted">Nenhum recebimento por favorecido registrado para esta emenda.</p>';
$('convs').innerHTML = convs.length ? html`<div class="table-wrap"><table><thead><tr><th>Número</th><th>Convenente</th><th>Objeto</th><th class="num">Valor do convênio</th><th>Publicação</th></tr></thead><tbody>
  ${raw(convs.map(c => html`<tr><td class="mono">${c[0]}</td><td>${c[1]}</td><td style="min-width:240px">${c[2]}</td><td class="num">${brl(c[3])}</td><td>${c[4]}</td></tr>`).join(''))}
  </tbody></table></div><p class="muted" style="font-size:.84rem">O valor do convênio pode incluir contrapartida do convenente e outras fontes; por isso não é somado aos valores da emenda.</p>`
  : `<p class="muted">${e.grupo === 'pix' ? 'Não se aplica: transferências especiais são repassadas sem convênio.' : 'Nenhum convênio vinculado a esta emenda na base da CGU.'}</p>`;

// ---------- documentos e acesso
const docs = [
  ['Proposta da emenda', 'indisponivel'], ['Plano de trabalho', isPix ? 'load' : 'indisponivel'],
  ['Instrumento de transferência / convênio', convs.length ? 'localizado' : e.grupo === 'pix' ? 'nao-se-aplica' : 'indisponivel'],
  ['Termo de compromisso', 'indisponivel'], ['Contrato', 'indisponivel'], ['Processo administrativo', 'indisponivel'],
  ['Nota de empenho', isPix ? 'load' : 'indisponivel'], ['Ordem de pagamento / ordem bancária', isPix ? 'load' : 'indisponivel'],
  ['Relatório de execução', isPix ? 'load' : 'indisponivel'], ['Prestação de contas', isPix ? 'load' : 'indisponivel'],
  ['Relatório de auditoria', 'indisponivel'], ['Parecer de órgão de controle', 'indisponivel'], ['Decisão administrativa ou judicial', 'indisponivel'],
  ['Devolução de recursos', 'indisponivel'],
];
const DOC_LABEL = { localizado: 'Registro localizado', indisponivel: 'Não localizado nas bases consultadas', 'nao-se-aplica': 'Não se aplica a esta modalidade', load: 'Consultando…' };
function renderDocs() {
  $('docs').innerHTML = `<div class="table-wrap"><table><tbody>${docs.map(([n, s]) => `<tr><td>${n}</td><td><span class="badge ${s === 'localizado' ? 'integrada' : 'catalogada'}">${DOC_LABEL[s]}</span></td></tr>`).join('')}</tbody></table></div>
  <p class="muted" style="font-size:.84rem">"Registro localizado" quer dizer que o número ou os dados do documento estão numa base oficial, não que o arquivo completo foi aberto. Auditorias do TCU e da CGU e decisões judiciais não são consultadas automaticamente; procure no <a href="https://portal.tcu.gov.br/" target="_blank" rel="noopener">TCU</a> e na <a href="https://www.gov.br/cgu/pt-br" target="_blank" rel="noopener">CGU</a>.</p>`;
  const anyPublic = docs.some(d => d[1] === 'localizado') || favs.length;
  $('acesso').innerHTML = html`<dl class="stats">
    <div><dt>Situação geral</dt><dd>${ACESSO['nao-verificada']}</dd></div>
    <div><dt>Registros desta emenda</dt><dd>${anyPublic ? ACESSO.publica : ACESSO['nao-localizado']}</dd></div>
    <div><dt>Restrição formal</dt><dd>${ACESSO['nao-disponivel']}</dd></div>
  </dl>
  <p style="font-size:.9rem;margin-top:.6rem">As bases consultadas (CGU e Transferegov.br) não registram sigilo nem restrição formal de acesso. Por isso o portal não afirma que há ou que não há sigilo. A ausência de um documento na internet não é prova de sigilo. Para pedir um documento, use a <a href="https://www.gov.br/acessoainformacao/pt-br" target="_blank" rel="noopener">Lei de Acesso à Informação</a>.</p>`;
}

$('fontes').innerHTML = html`<div class="source-box"><dl>
  <dt>Execução e recebimentos</dt><dd>${EMENDAS_SOURCES.cgu.org}, ${EMENDAS_SOURCES.cgu.name}. Arquivo baixado em ${fmtDateTime(meta.updatedAt)}. <a href="${EMENDAS_SOURCES.cgu.page}" target="_blank" rel="noopener">Página de download</a>.</dd>
  ${raw(isPix ? html`<dt>Transferência especial</dt><dd>${EMENDAS_SOURCES.transferegov.name}, consultado agora. <a class="mono" href="${TG}plano_acao_especial?numero_emenda_parlamentar_plano_acao=eq.${e.id}" target="_blank" rel="noopener">Consulta original</a>.</dd>` : '')}
  <dt>Casa e partido</dt><dd>Listas oficiais da Câmara e do Senado (legislaturas 54 a 57), cruzadas pelo nome do autor.</dd>
</dl></div>`;

// ---------- Transferegov (somente transferências especiais), consultado ao vivo
const pixData = {};
async function loadPix() {
  const q = (path, params) => getJSON(`${TG}${path}?${params}`, { timeout: 30000, retries: 1 });
  // Campos bancários nunca são pedidos.
  const planos = await q('plano_acao_especial', `numero_emenda_parlamentar_plano_acao=eq.${e.id}&select=id_plano_acao,codigo_plano_acao,situacao_plano_acao,cnpj_beneficiario_plano_acao,nome_beneficiario_plano_acao,uf_beneficiario_plano_acao,nome_parlamentar_emenda_plano_acao,codigo_descricao_areas_politicas_publicas_plano_acao,motivo_impedimento_plano_acao,valor_custeio_plano_acao,valor_investimento_plano_acao`);
  pixData.planos = planos;
  if (!planos.length) return;
  const ids = planos.map(p => p.id_plano_acao).join(',');
  const [emp, exe, pt, rg, rgOld] = await Promise.all([
    q('empenho_especial', `id_plano_acao=in.(${ids})&select=id_empenho,id_plano_acao,numero_empenho,data_emissao_empenho,valor_empenho,descricao_situacao_empenho,descricao_tipo_documento_empenho,ug_emitente_empenho,descricao_ug_emitente_empenho`),
    q('executor_especial', `id_plano_acao=in.(${ids})&select=id_executor,id_plano_acao,cnpj_executor,nome_executor,objeto_executor,vl_custeio_executor,vl_investimento_executor`),
    q('plano_trabalho_especial', `id_plano_acao=in.(${ids})&select=id_plano_acao,situacao_plano_trabalho,data_inicio_execucao_plano_trabalho,data_fim_execucao_plano_trabalho,prazo_execucao_meses_plano_trabalho`),
    q('relatorio_gestao_novo_especial', `id_plano_acao=in.(${ids})`),
    q('relatorio_gestao_especial', `id_plano_acao=in.(${ids})&select=id_plano_acao,situacao_relatorio_gestao,parecer_relatorio_gestao`),
  ]);
  Object.assign(pixData, { emp, exe, pt, rg, rgOld });
  if (emp.length) {
    pixData.dh = await q('documento_habil_especial', `id_empenho=in.(${emp.map(x => x.id_empenho).join(',')})&select=id_dh,id_empenho,numero_documento_habil,data_emissao_dh,valor_dh,descricao_ug_pagadora_dh,descricao_situacao_dh`);
    if (pixData.dh.length) pixData.ob = await q('ordem_pagamento_ordem_bancaria_especial', `id_dh=in.(${pixData.dh.map(x => x.id_dh).join(',')})&select=id_dh,numero_ordem_pagamento,numero_ordem_bancaria,data_emissao_ob,descricao_situacao_op,data_assinatura_ordenador_despesa_ob,data_assinatura_gestor_financeiro_ob`);
  }
  if (exe.length) pixData.metas = await q('meta_especial', `id_executor=in.(${exe.map(x => x.id_executor).join(',')})&select=id_executor,sequencial_meta,desc_meta,un_medida_meta,qt_uniade_meta,qt_meses_meta`);
}

function renderPix() {
  const P = pixData;
  if (!P.planos?.length) {
    $('pix').innerHTML = '<p class="muted">O Transferegov.br não retornou plano de ação para este código de emenda.</p>';
    return;
  }
  const by = (arr, k, v) => (arr || []).filter(x => x[k] === v);
  const sum = (arr, k) => (arr || []).reduce((s, x) => s + (Number(x[k]) || 0), 0);
  $('pix').innerHTML = html`<p class="muted" style="font-size:.88rem">${P.planos.length} plano(s) de ação, um por ente beneficiário. Os dados vêm do Transferegov.br e são mantidos separados dos dados da CGU; a ligação entre as duas bases é feita pelo código da emenda.</p>
  ${raw(P.planos.map(p => {
    const emp = by(P.emp, 'id_plano_acao', p.id_plano_acao);
    const dh = (P.dh || []).filter(d => emp.some(x => x.id_empenho === d.id_empenho));
    const ob = (P.ob || []).filter(o => dh.some(d => d.id_dh === o.id_dh));
    const exe = by(P.exe, 'id_plano_acao', p.id_plano_acao);
    const metas = (P.metas || []).filter(m => exe.some(x => x.id_executor === m.id_executor));
    const pt = by(P.pt, 'id_plano_acao', p.id_plano_acao)[0];
    const rg = [...by(P.rg, 'id_plano_acao', p.id_plano_acao), ...by(P.rgOld, 'id_plano_acao', p.id_plano_acao)];
    return html`<details class="card" style="margin-bottom:.6rem"><summary style="cursor:pointer"><strong>${p.nome_beneficiario_plano_acao}</strong> (${p.uf_beneficiario_plano_acao}) · plano ${p.codigo_plano_acao} · ${p.situacao_plano_acao}</summary>
      <div style="font-size:.9rem;margin-top:.6rem">
        <p>Beneficiário: ${p.nome_beneficiario_plano_acao}, CNPJ ${p.cnpj_beneficiario_plano_acao}. Valor do plano: ${brl((p.valor_custeio_plano_acao || 0) + (p.valor_investimento_plano_acao || 0))} (custeio ${brl(p.valor_custeio_plano_acao)}, investimento ${brl(p.valor_investimento_plano_acao)}).</p>
        ${raw(p.motivo_impedimento_plano_acao ? html`<p class="notice">Impedimento registrado: ${p.motivo_impedimento_plano_acao}</p>` : '')}
        <p><strong>Empenho:</strong> ${raw(emp.length ? emp.map(x => html`${x.numero_empenho} de ${dt(x.data_emissao_empenho)}, ${brl(x.valor_empenho)} (${x.descricao_tipo_documento_empenho}), emitido por ${x.descricao_ug_emitente_empenho}`).join('; ') : 'não localizado')}.</p>
        <p><strong>Liquidação (documento hábil):</strong> ${raw(dh.length ? dh.map(d => html`${d.numero_documento_habil} de ${dt(d.data_emissao_dh)}, ${brl(d.valor_dh)}, unidade pagadora ${d.descricao_ug_pagadora_dh}`).join('; ') : 'não localizada')}.</p>
        <p><strong>Pagamento (ordem bancária):</strong> ${raw(ob.length ? ob.map(o => html`${o.numero_ordem_bancaria || o.numero_ordem_pagamento} emitida em ${dt(o.data_emissao_ob)} (${o.descricao_situacao_op}); assinada pelo ordenador de despesa em ${dt(o.data_assinatura_ordenador_despesa_ob)} e pelo gestor financeiro em ${dt(o.data_assinatura_gestor_financeiro_ob)}`).join('; ') : 'não localizado')}.</p>
        <p><strong>Executor e objeto:</strong> ${raw(exe.length ? exe.map(x => html`${x.nome_executor}: ${x.objeto_executor}`).join('; ') : 'não localizado')}.</p>
        ${raw(metas.length ? html`<p><strong>Metas:</strong> ${metas.map(m => `${m.desc_meta} (${m.qt_uniade_meta} ${m.un_medida_meta})`).join('; ')}.</p>` : '')}
        <p><strong>Plano de trabalho:</strong> ${pt ? `${pt.situacao_plano_trabalho}, execução de ${dt(pt.data_inicio_execucao_plano_trabalho)} a ${dt(pt.data_fim_execucao_plano_trabalho)}` : 'não localizado'}.</p>
        <p><strong>Relatório de gestão:</strong> ${raw(rg.length ? rg.map(r => html`${r.tipo_relatorio_gestao_novo || ''} ${r.situacao_relatorio_gestao_novo || r.situacao_relatorio_gestao || ''}${r.valor_executado_relatorio_gestao_novo != null ? `, executado ${brl(r.valor_executado_relatorio_gestao_novo)}, pendente ${brl(r.valor_pendente_relatorio_gestao_novo)}` : ''}${r.parecer_relatorio_gestao ? `, parecer: ${r.parecer_relatorio_gestao}` : ''}`).join('; ') : 'não localizado')}.</p>
        <p class="muted">Dados bancários existem na base, mas não são exibidos aqui.</p>
      </div></details>`;
  }).join(''))}`;

  // atualiza papéis, etapas e documentos com o que foi encontrado
  const ugEmp = [...new Set((P.emp || []).map(x => x.descricao_ug_emitente_empenho))];
  const ugPag = [...new Set((P.dh || []).map(x => x.descricao_ug_pagadora_dh))];
  if (ugEmp.length) papeis.empenho = `${escapeHtml(ugEmp.join('; '))} <small class="muted">Transferegov.br</small>`;
  if (ugPag.length) papeis.pagamento = `${escapeHtml(ugPag.join('; '))} <small class="muted">Transferegov.br</small>`;
  papeis.beneficiario = `${escapeHtml(P.planos.map(p => p.nome_beneficiario_plano_acao).slice(0, 5).join('; '))}${P.planos.length > 5 ? ` e mais ${P.planos.length - 5}` : ''} <small class="muted">planos de ação no Transferegov.br</small>`;
  if (P.exe?.length) papeis.executor = `${escapeHtml(P.exe.map(x => x.nome_executor).slice(0, 5).join('; '))} <small class="muted">Transferegov.br</small>`;
  if ((P.ob || []).some(o => o.data_assinatura_ordenador_despesa_ob)) papeis.assinaturas = 'As ordens bancárias registram as datas de assinatura do ordenador de despesa e do gestor financeiro. Os nomes não são publicados nesta base.';
  renderPapeis();
  steps[2] = { t: 'Autorização e análise do plano', s: 'ok', d: `Planos de ação no Transferegov.br: ${escapeHtml([...new Set(P.planos.map(p => p.situacao_plano_acao))].join(', '))}.` };
  if (P.emp?.length) steps[3].d += ` Notas de empenho: ${escapeHtml(P.emp.map(x => x.numero_empenho).slice(0, 6).join(', '))}${P.emp.length > 6 ? '…' : ''}.`;
  if (P.ob?.length) steps[5].d += ` Ordens bancárias: ${P.ob.length}, a primeira em ${dt(P.ob.map(o => o.data_emissao_ob).filter(Boolean).sort()[0])}.`;
  if (P.exe?.length) steps[7] = { t: 'Execução do objeto', s: 'ok', d: `${P.exe.length} executor(es) com objeto registrado. Isso não confirma a entrega.` };
  if (P.rg?.length || P.rgOld?.length) steps[8] = { t: 'Prestação de contas', s: 'ok', d: `Relatório(s) de gestão registrados no Transferegov.br${P.rg?.length ? `; valor executado informado: ${brl(sum(P.rg, 'valor_executado_relatorio_gestao_novo'))}` : ''}.` };
  else steps[8] = { t: 'Prestação de contas', s: 'nl', d: 'Nenhum relatório de gestão localizado no Transferegov.br.' };
  const pend = sum(P.rg, 'valor_pendente_relatorio_gestao_novo');
  if (pend > 0) steps[9] = { t: 'Devoluções, cancelamentos ou pendências', s: 'ok', d: `${steps[9].s === 'ok' ? steps[9].d + ' ' : ''}Relatórios informam ${brl(pend)} pendentes.` };
  renderTimeline();
  const set = (name, ok) => { const d = docs.find(x => x[0] === name); if (d) d[1] = ok ? 'localizado' : 'indisponivel'; };
  set('Plano de trabalho', P.pt?.length); set('Nota de empenho', P.emp?.length); set('Ordem de pagamento / ordem bancária', P.ob?.length);
  set('Relatório de execução', P.rg?.length || P.rgOld?.length); set('Prestação de contas', (P.rg || []).some(r => /final/i.test(r.tipo_relatorio_gestao_novo || '')));
  renderDocs();
  if (P.exe?.length) $('objeto').insertAdjacentHTML('beforeend', html`<p style="font-size:.9rem"><strong>Transferegov.br:</strong> ${P.exe.map(x => x.objeto_executor).slice(0, 5).join('; ')}</p>`);
}

renderPapeis(); renderTimeline(); renderDocs();
if (isPix) {
  loadPix().then(renderPix).catch(err => {
    $('pix').innerHTML = html`<p class="notice">Não foi possível consultar o Transferegov.br agora (${err.message}). As etapas dessa base aparecem como não localizadas.</p>`;
    for (const d of docs) if (d[1] === 'load') d[1] = 'indisponivel';
    renderDocs();
  });
}

// ---------- ações
$('share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('share-msg').textContent = 'Link copiado.'; }
  catch { $('share-msg').textContent = `Copie o endereço: ${location.href}`; }
});
$('print').addEventListener('click', () => window.print());
const exportObj = () => ({
  emenda: e.id, ano: e.ano, tipo: e.tipo, autor: e.autor, numero: e.numero, valores: Object.fromEntries(VALUE_LABELS.map((l, i) => [l, e.v[i]])),
  pago_total: e.pago, nao_pago_estimado: e.naoPago, situacao: SITUACAO_LABEL[e.situacao],
  destinos: e.parts.map(p => ({ localidade: p.loc, ibge: p.ibge, uf: p.uf, funcao: p.funcName, subfuncao: p.subfName, programa: `${p.prog} ${p.progName}`, acao: `${p.acao} ${p.acaoName}`, valores: p.v })),
  recebimentos: favs.map(x => ({ favorecido: x.f[1], documento: x.f[0], tipo: x.f[3], uf: x.f[4], municipio: x.f[5], total: x.total, de: x.first, ate: x.last, pagamentos: x.n })),
  convenios: convs.map(c => ({ numero: c[0], convenente: c[1], objeto: c[2], valor: c[3], publicacao: c[4] })),
  transferegov: isPix ? { planos: pixData.planos || null } : null,
  alertas: Object.entries(FLAG_LABEL).filter(([b]) => e.flags & b).map(([, l]) => l),
  fonte: EMENDAS_SOURCES.cgu.page, baixado_em: meta.updatedAt,
});
$('dl-json').addEventListener('click', () => downloadFile(`emenda-${e.id}.json`, JSON.stringify(exportObj(), null, 2), 'application/json'));
$('dl-csv').addEventListener('click', () => {
  const rows = favs.length ? favs.map(x => [e.id, e.ano, e.autor.nome, x.f[1], x.f[0] || '', x.f[3], x.f[5], x.f[4], x.total, x.first, x.last])
    : [[e.id, e.ano, e.autor.nome, '', '', '', '', '', '', '', '']];
  downloadFile(`emenda-${e.id}-recebimentos.csv`, '﻿' + toCSV(rows, ['emenda', 'ano', 'autor', 'favorecido', 'documento', 'tipo', 'municipio', 'uf', 'recebido', 'de', 'ate']), 'text/csv;charset=utf-8');
});
