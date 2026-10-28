/**
 * Verificações sobre parlamentares, projetos de lei e mandatos presidenciais,
 * consultando ao vivo as APIs oficiais da Câmara e do Senado (gratuitas, sem chave).
 *
 * Tipos de afirmação reconhecidos:
 *  - voto de um parlamentar em uma proposição ("X votou contra a PEC 45/2019")
 *  - situação de uma proposição ("o PL 2630/2020 foi arquivado", "virou lei")
 *  - autoria ("X é autor do PL 1234/2023")
 *  - gastos com a cota parlamentar ("o deputado X gastou R$ 300 mil com a cota em 2025")
 *  - partido ("o deputado X é do PL")
 *  - mandatos presidenciais ("Temer assumiu em 2016", "Bolsonaro governou de 2019 a 2022")
 *
 * `get(ctx, url)` faz a consulta (no navegador, a mesma função usada no resto do portal).
 */
import { GOVERNMENTS } from '../data/governments.js';

export const CAMARA = 'https://dadosabertos.camara.leg.br/api/v2';
export const SENADO = 'https://legis.senado.leg.br/dadosabertos';
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const brl = v => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/**
 * A API da Câmara recusa rajadas de consultas vindas do navegador (a resposta de erro vem sem
 * cabeçalho CORS). Por isso as consultas à Câmara passam por uma fila, com intervalo entre elas
 * e novas tentativas com espera crescente. As do Senado seguem direto.
 */
let camaraQueue = Promise.resolve();
const sleep = ms => new Promise(r => setTimeout(r, ms));
function get(ctx, url) {
  if (!url.startsWith(CAMARA)) return ctx.getJSON(url);
  const gap = ctx.camaraDelay ?? 350;
  const run = camaraQueue.then(async () => {
    let err;
    for (let i = 0; i < 4; i++) {
      try { const r = await ctx.getJSON(url); await sleep(gap); return r; }
      catch (e) { err = e; await sleep(gap * 4 * 2 ** i); }
    }
    throw err;
  });
  camaraQueue = run.catch(() => {});
  return run;
}
const dt = s => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

// ---------------------------------------------------------------- reconhecimento
const TIPO_PROP = { pec: 'PEC', pl: 'PL', plp: 'PLP', mpv: 'MPV', mp: 'MPV', pdl: 'PDL', pdc: 'PDC', plv: 'PLV' };

/** "PEC 45/2019", "PL nº 2.630 de 2020", "MP 1.154/2023" → { sigla, numero, ano } */
export function parseProposicao(text) {
  const m = String(text).match(/\b(pec|plp|pl|mpv|mp|pdl|pdc|plv)\s*(?:n[º°o.]*\s*)?(\d{1,2}(?:\.\d{3})|\d{1,5})(?:\s*\/\s*|\s*,?\s+de\s+)(\d{4})\b/i);
  if (!m) return null;
  return { sigla: TIPO_PROP[m[1].toLowerCase()], numero: Number(m[2].replace('.', '')), ano: Number(m[3]) };
}

export function claimedVote(t) {
  if (/votou (a favor|sim|pela aprova|favoravel)|voto (favoravel|sim)|apoiou/.test(t)) return 'Sim';
  if (/votou (contra|nao|pela rejei)|voto contrario|voto nao/.test(t)) return 'Não';
  if (/absteve|abstencao/.test(t)) return 'Abstenção';
  return null;
}

// "gastou" e "aprovad" sozinhos não bastam: aparecem em frases sobre gastos do governo e indicadores.
const POLITICS_CUE = /deputad|senador|parlamentar|vereador|votou|voto|cota parlamentar|partido|filiad|autor|apresentou|projeto de lei|\bpec\b|\bpl\b|medida provisoria|\bmp\b|sancion|arquivad|virou lei|foi presidente|governou|assumiu|tomou posse|presidiu|impeachment|renunci/;
export const hasPoliticsCue = t => POLITICS_CUE.test(t) || !!parseProposicao(t);

// ---------------------------------------------------------------- listas de parlamentares (cache)
let senadoresPromise = null;
const deputadoCache = new Map();

/** Trechos com cara de nome próprio ("Tabata Amaral", "Kim Kataguiri"), sem siglas. */
export function nameCandidates(sentence) {
  const W = '[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-zà-ú]+';
  const re = new RegExp(`${W}(?:\\s+(?:d[aeo]s?\\s+)?${W}){1,3}`, 'g');
  const out = new Set((String(sentence).match(re) || []).map(s => s.replace(/^(A|O|As|Os|Em|Para|No|Na)\s+/, '')));
  // nome de uma palavra logo depois de "deputado"/"senador" ("deputado Tiririca")
  for (const m of String(sentence).matchAll(new RegExp(`(?:deputad[oa]|senador[a]?)\\s+(?:federal\\s+)?(${W})`, 'gi'))) out.add(m[1]);
  return [...out].filter(s => s.length >= 4 && !/^(Deputad|Senador|Câmara|Senado|Brasil|Governo)/.test(s));
}

/** Busca na Câmara pelo nome: uma consulta por nome, sem baixar a lista inteira (a API limita consultas em sequência). */
async function buscaDeputado(nome, ctx) {
  const key = norm(nome);
  if (!deputadoCache.has(key)) deputadoCache.set(key, (async () => {
    for (const q of ['', '&idLegislatura=56']) {
      const j = await get(ctx, `${CAMARA}/deputados?nome=${encodeURIComponent(nome)}${q}&itens=10`);
      if (j.dados?.length) return j.dados.map(d => ({ id: d.id, nome: d.nome, partido: d.siglaPartido, uf: d.siglaUf, casa: 'Câmara', leg: d.idLegislatura }));
    }
    return [];
  })().catch(e => { deputadoCache.delete(key); throw e; }));
  return deputadoCache.get(key);
}
async function senadores(ctx) {
  if (!senadoresPromise) senadoresPromise = get(ctx, `${SENADO}/senador/lista/atual.json`).then(j =>
    j.ListaParlamentarEmExercicio.Parlamentares.Parlamentar.map(p => ({
      id: p.IdentificacaoParlamentar.CodigoParlamentar, nome: p.IdentificacaoParlamentar.NomeParlamentar,
      partido: p.IdentificacaoParlamentar.SiglaPartidoParlamentar, uf: p.IdentificacaoParlamentar.UfParlamentar, casa: 'Senado',
    }))).catch(e => { senadoresPromise = null; throw e; });
  return senadoresPromise;
}

/** Procura no texto o nome de um deputado (legislaturas 56 e 57) ou senador em exercício. */
export async function findParlamentar(t, ctx, sentence = '') {
  const wantSen = /senador/.test(t), wantDep = /deputad/.test(t);
  const sens = await senadores(ctx).catch(() => []);
  const deps = [];
  if (!wantSen || wantDep) for (const c of nameCandidates(sentence)) deps.push(...await buscaDeputado(c, ctx).catch(() => []));
  const pool = wantSen && !wantDep ? [...sens, ...deps] : [...deps, ...sens];
  // nomes compostos sempre; nomes de uma palavra só com "deputado"/"senador" logo antes
  const hits = pool.filter(p => {
    const n = norm(p.nome);
    if (n.length < 4) return false;
    if (n.includes(' ')) return new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t);
    return new RegExp(`(deputad[oa]|senador[a]?) (federal )?${n}\\b`).test(t);
  });
  if (!hits.length) return null;
  // prefere o mandato mais recente
  hits.sort((a, b) => (b.leg || 99) - (a.leg || 99));
  return hits[0];
}

// ---------------------------------------------------------------- proposições
async function propCamara(p, ctx) {
  const j = await get(ctx, `${CAMARA}/proposicoes?siglaTipo=${p.sigla}&numero=${p.numero}&ano=${p.ano}`);
  const hit = j.dados.find(d => d.siglaTipo === p.sigla && d.numero === p.numero && d.ano === p.ano);
  if (!hit) return null;
  const det = await get(ctx, `${CAMARA}/proposicoes/${hit.id}`);
  return { id: hit.id, ementa: det.dados.ementa, status: det.dados.statusProposicao, page: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${hit.id}` };
}

/** Votações principais do plenário da Câmara (texto-base, turnos), sem requerimentos e destaques. */
const MAIN_VOTE = /(aprovad[oa]|rejeitad[oa]).{0,80}(turno|a proposta|o projeto|o substitutivo|a medida provis|a emenda aglutinativa|o texto|o parecer|a pec|o pl\b)/i;
// "Mantido o texto" e "Suprimido" são votações de destaques, mesmo sem a palavra "destaque".
const NOT_MAIN = /requerimento|destaque|destacad|reda[cç][aã]o final|quebra de interst|adiamento|retirada de pauta|mantid[oa] o texto|suprimid/i;
// "ressalvados os destaques" aparece justamente na votação do texto principal
const isMainVote = d => MAIN_VOTE.test(d) && !NOT_MAIN.test(d.replace(/ressalvad[oa]s os destaques/gi, ''));

async function votosCamara(prop, ctx) {
  const j = await get(ctx, `${CAMARA}/proposicoes/${prop.id}/votacoes`);
  const main = j.dados.filter(v => v.siglaOrgao === 'PLEN' && isMainVote(v.descricao || ''))
    .sort((a, b) => String(a.data).localeCompare(String(b.data))).slice(-6);
  const out = [];
  for (const v of main) {
    const votos = await get(ctx, `${CAMARA}/votacoes/${v.id}/votos`).catch(() => ({ dados: [] }));
    out.push({ casa: 'Câmara', id: v.id, data: v.data, descricao: v.descricao, aprovacao: v.aprovacao,
      votos: votos.dados.map(x => ({ nome: x.deputado_?.nome, partido: x.deputado_?.siglaPartido, voto: x.tipoVoto })),
      url: `${CAMARA}/votacoes/${v.id}/votos` });
  }
  return out;
}

async function votosSenado(p, ctx) {
  const url = `${SENADO}/votacao?sigla=${p.sigla === 'MPV' ? 'MPV' : p.sigla}&numero=${p.numero}&ano=${p.ano}`;
  const j = await get(ctx, url).catch(() => []);
  return (Array.isArray(j) ? j : []).filter(v => !/destacad|requerimento/i.test(v.descricaoVotacao || '')).map(v => ({
    casa: 'Senado', id: v.codigoSessaoVotacao, data: v.dataSessao, descricao: v.descricaoVotacao, aprovacao: v.resultadoVotacao === 'A' ? 1 : v.resultadoVotacao === 'R' ? 0 : null,
    votos: (v.votos || []).map(x => ({ nome: x.nomeParlamentar, partido: x.siglaPartidoParlamentar, voto: x.siglaVotoParlamentar })),
    url, page: `https://www25.senado.leg.br/web/atividade/materias/-/materia/${v.codigoMateria}`,
  }));
}

const normVoto = v => (/^sim/i.test(v) ? 'Sim' : /^n[aã]o/i.test(v) ? 'Não' : /absten/i.test(v) ? 'Abstenção' : /obstru/i.test(v) ? 'Obstrução' : v || 'Sem voto');

// ---------------------------------------------------------------- verificações
async function checkVoto(t, p, ctx, sentence) {
  const claim = claimedVote(t);
  const evidence = [], timeline = [];
  const prop = await propCamara(p, ctx).catch(() => null);
  const votacoes = [...(prop ? await votosCamara(prop, ctx).catch(() => []) : []), ...await votosSenado(p, ctx)];
  if (prop) evidence.push({ label: `${p.sigla} ${p.numero}/${p.ano} na Câmara dos Deputados`, url: prop.page });
  if (!votacoes.length) return { status: 'nao-comprovado', finding: `Não foram encontradas votações nominais de plenário da ${p.sigla} ${p.numero}/${p.ano} nas bases da Câmara e do Senado.`, evidence };
  // o nome de quem votou é procurado direto nas listas de votos
  const found = [];
  for (const v of votacoes) {
    const hit = v.votos.find(x => x.nome && norm(x.nome).includes(' ') && t.includes(norm(x.nome)));
    if (hit) found.push({ v, hit });
  }
  if (!found.length) {
    const parl = await findParlamentar(t, ctx, sentence).catch(() => null);
    return { status: 'nao-comprovado', finding: parl
      ? `${parl.nome} não aparece com voto registrado nas votações nominais principais da ${p.sigla} ${p.numero}/${p.ano} (pode ter faltado ou não ser parlamentar na época).`
      : `O nome citado não aparece nas votações nominais principais da ${p.sigla} ${p.numero}/${p.ano}.`, evidence };
  }
  for (const { v, hit } of found) {
    timeline.push([String(v.data).slice(0, 10), `${v.casa}: ${hit.nome} votou "${normVoto(hit.voto)}". ${String(v.descricao).slice(0, 140)}`]);
    evidence.push({ label: `Votos da votação de ${dt(v.data)} (${v.casa})`, url: v.page || v.url });
  }
  const votes = found.map(f => normVoto(f.hit.voto));
  const nome = found[0].hit.nome;
  const etapa = d => (/segundo turno/i.test(d) ? '2º turno' : /primeiro turno/i.test(d) ? '1º turno' : /turno [úu]nico/i.test(d) ? 'turno único' : /aglutinativa/i.test(d) ? 'emenda aglutinativa' : 'texto principal');
  const desc = found.map(f => `${dt(f.v.data)} (${f.v.casa}, ${etapa(f.v.descricao)}): ${normVoto(f.hit.voto)}`).join('; ');
  if (!claim) return { status: null, finding: `Votos de ${nome} na ${p.sigla} ${p.numero}/${p.ano}: ${desc}.`, evidence, timeline };
  const agree = votes.filter(v => v === claim).length;
  const status = agree === votes.length ? 'verdadeiro' : agree === 0 ? 'falso' : 'parcial';
  return { status, finding: `Votos de ${nome} nas votações principais da ${p.sigla} ${p.numero}/${p.ano}: ${desc}. A alegação diz "${claim}".${status === 'parcial' ? ' O voto mudou entre as votações.' : ''}`, evidence, timeline };
}

async function checkStatus(t, p, ctx) {
  const prop = await propCamara(p, ctx).catch(() => null);
  if (!prop) return { status: 'nao-comprovado', finding: `A ${p.sigla} ${p.numero}/${p.ano} não foi encontrada na base da Câmara.`, evidence: [] };
  const sit = prop.status?.descricaoSituacao || 'não informada';
  const ev = [{ label: `${p.sigla} ${p.numero}/${p.ano} na Câmara dos Deputados`, url: prop.page }];
  const timeline = [[String(prop.status?.dataHora || '').slice(0, 10), `Situação na Câmara: ${sit}. Último andamento: ${prop.status?.descricaoTramitacao || '—'}`]];
  const s = norm(sit);
  let status = null, extra = '';
  if (/virou lei|sancionad|transformad[oa] em lei|promulgad/.test(t)) status = /norma juridica/.test(s) ? 'verdadeiro' : 'falso';
  else if (/arquivad/.test(t)) status = /arquivad/.test(s) ? 'verdadeiro' : 'falso';
  else if (/rejeitad/.test(t)) status = /rejeitad/.test(s) ? 'verdadeiro' : 'nao-comprovado';
  else if (/aprovad/.test(t)) {
    if (/norma juridica/.test(s)) status = 'verdadeiro';
    else {
      const camara = (await votosCamara(prop, ctx).catch(() => [])).find(v => v.aprovacao === 1);
      const senado = (await votosSenado(p, ctx)).find(v => v.aprovacao === 1);
      const casas = [camara && `a Câmara aprovou o texto em ${dt(camara.data)}`, senado && `o Senado aprovou em ${dt(senado.data)}`].filter(Boolean);
      // "aprovado" sem dizer onde: aprovação em uma Casa confere, mas a frase pode sugerir que virou lei
      status = casas.length === 2 ? 'verdadeiro' : casas.length ? 'parcial' : 'nao-comprovado';
      if (casas.length) extra = ` ${casas.join(' e ').replace(/^./, c => c.toUpperCase())}. A proposição ainda não virou norma.`;
      if (senado) { ev.push({ label: 'Votações no Senado', url: senado.page }); timeline.push([String(senado.data).slice(0, 10), `Senado: ${String(senado.descricao).slice(0, 120)}`]); }
      if (camara) timeline.push([String(camara.data).slice(0, 10), `Câmara: ${String(camara.descricao).slice(0, 120)}`]);
    }
  }
  return { status, finding: `${p.sigla} ${p.numero}/${p.ano}: ${String(prop.ementa).replace(/\s+/g, ' ').slice(0, 160).replace(/\.$/, '')}. Situação na Câmara: ${sit}.${extra}`, evidence: ev, timeline };
}

async function checkAutoria(t, p, ctx, sentence) {
  const prop = await propCamara(p, ctx).catch(() => null);
  if (!prop) return { status: 'nao-comprovado', finding: `A ${p.sigla} ${p.numero}/${p.ano} não foi encontrada na base da Câmara.`, evidence: [] };
  const j = await get(ctx, `${CAMARA}/proposicoes/${prop.id}/autores`);
  const autores = j.dados.map(a => a.nome);
  const ev = [{ label: `Autores da ${p.sigla} ${p.numero}/${p.ano}`, url: `${CAMARA}/proposicoes/${prop.id}/autores` }, { label: 'Ficha de tramitação', url: prop.page }];
  const match = autores.find(a => t.includes(norm(a)));
  if (match) return { status: 'verdadeiro', finding: `${match} consta como autor(a) da ${p.sigla} ${p.numero}/${p.ano}.`, evidence: ev };
  const parl = await findParlamentar(t, ctx, sentence).catch(() => null);
  if (!parl) return { status: 'nao-comprovado', finding: `Autores registrados: ${autores.slice(0, 5).join(', ')}${autores.length > 5 ? '…' : ''}. O nome citado não foi identificado.`, evidence: ev };
  return { status: 'falso', finding: `${parl.nome} não consta entre os autores da ${p.sigla} ${p.numero}/${p.ano}. Autores registrados: ${autores.slice(0, 5).join(', ')}${autores.length > 5 ? '…' : ''}.`, evidence: ev };
}

const COTA_TIPOS = [[/combustiv/, /COMBUST/], [/passage/, /PASSAGE/], [/divulga/, /DIVULGA/], [/telefon/, /TELEFON/], [/aliment|refei/, /ALIMENTA/], [/hosped|hotel/, /HOSPED/], [/aluguel de carro|locacao de veiculo|fretamento/, /LOCA[CÇ][AÃ]O OU FRETAMENTO|VE[IÍ]CULO/], [/escritorio/, /ESCRIT/]];

async function checkCota(t, parl, numbers, ctx) {
  if (parl.casa !== 'Câmara') return { status: 'nao-comprovado', finding: `A cota parlamentar dos senadores ainda não está integrada ao portal.`, evidence: [] };
  const year = Number(numbers.years.at(-1) || ctx.today.getFullYear());
  const leg = 57 + Math.floor((year - 2023) / 4);
  let url = `${CAMARA}/deputados/${parl.id}/despesas?idLegislatura=${leg}&ano=${year}&itens=100&pagina=1`;
  const rows = [];
  for (let i = 0; url && i < 30; i++) { const j = await get(ctx, url); rows.push(...j.dados); url = j.links?.find(l => l.rel === 'next')?.href || null; }
  const tipo = COTA_TIPOS.find(([re]) => re.test(t));
  const sel = tipo ? rows.filter(r => tipo[1].test(r.tipoDespesa || '')) : rows;
  const total = sel.reduce((s, r) => s + (r.valorLiquido || 0), 0);
  const ev = [{ label: `Despesas da cota parlamentar de ${parl.nome} em ${year} (Câmara)`, url: `${CAMARA}/deputados/${parl.id}/despesas?idLegislatura=${leg}&ano=${year}` }];
  const what = tipo ? `com ${sel[0]?.tipoDespesa?.toLowerCase().replace(/\.$/, '') || 'esse tipo de despesa'}` : 'com a cota parlamentar';
  const base = `${parl.nome} recebeu ${brl(total)} de reembolso ${what} em ${year}, em ${sel.length} documento(s).${year === ctx.today.getFullYear() ? ' O ano ainda não terminou.' : ''}`;
  if (!numbers.money.length) return { status: null, finding: base, evidence: ev };
  const claimed = numbers.money[0];
  const rel = Math.abs(total - claimed) / Math.max(claimed, 1);
  const cmp = /mais de|acima de|passou de/.test(t) ? '>' : /menos de|abaixo de/.test(t) ? '<' : '=';
  const status = cmp === '>' ? (total > claimed ? 'verdadeiro' : 'falso') : cmp === '<' ? (total < claimed ? 'verdadeiro' : 'falso') : rel <= 0.05 ? 'verdadeiro' : rel <= 0.15 ? 'parcial' : 'falso';
  return { status, finding: `${base} A alegação fala em ${cmp === '>' ? 'mais de ' : cmp === '<' ? 'menos de ' : ''}${brl(claimed)}.`, evidence: ev };
}

function checkPartido(sentence, parl) {
  // sem \b antes de "é": em JavaScript a fronteira de palavra não reconhece letras acentuadas
  const m = sentence.match(/(?:^|\s)(?:é|e|era|está|esta) (?:do|filiad[oa] ao|no)\s+(?:partido\s+)?([A-Z][A-Za-z]{1,14}(?:\s?[Dd]o\s?B)?)\b/) || sentence.match(/filiad[oa] ao\s+([A-Z][A-Za-z]{1,14})/);
  if (!m) return null;
  const claimed = m[1].toUpperCase();
  const ok = norm(parl.partido) === norm(claimed);
  return { status: ok ? 'verdadeiro' : 'falso', finding: `Pela lista oficial ${parl.casa === 'Senado' ? 'do Senado' : 'da Câmara'}, ${parl.nome} (${parl.uf}) está registrado(a) no ${parl.partido}. A alegação diz ${claimed}. Esse é o partido mais recente na base; trocas de partido ao longo do mandato não aparecem aqui.`,
    evidence: [{ label: `Cadastro de ${parl.nome}`, url: parl.casa === 'Câmara' ? `https://www.camara.leg.br/deputados/${parl.id}` : `${SENADO}/senador/lista/atual.json` }] };
}

// ---------------------------------------------------------------- mandatos presidenciais
const PRES = { lula: ['lula1', 'lula2', 'lula3'], bolsonaro: ['bolsonaro'], temer: ['temer'], dilma: ['dilma1', 'dilma2'], 'fernando henrique': ['fhc1', 'fhc2'], fhc: ['fhc1', 'fhc2'], collor: ['collor'], itamar: ['itamar'], sarney: ['sarney'] };

export function checkMandato(t) {
  const who = Object.keys(PRES).find(k => new RegExp(`\\b${k}\\b`).test(t));
  if (!who || !/(foi presidente|governou|assumiu|tomou posse|presidiu|mandato|deixou o cargo|impeachment|afastad|renunci)/.test(t)) return null;
  const govs = PRES[who].map(id => GOVERNMENTS.find(g => g.id === id));
  const years = [...t.matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map(m => Number(m[1]));
  if (!years.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const span = g => [Number(g.start.slice(0, 4)), Number((g.end || today).slice(0, 4))];
  const desc = govs.map(g => `${g.short}: ${g.start.split('-').reverse().join('/')} a ${g.end ? g.end.split('-').reverse().join('/') : 'atual'}${g.note ? ` (${g.note})` : ''}`).join(' ');
  const ev = [{ label: 'Mandatos presidenciais (registro do portal, conforme Presidência da República)', url: 'metodologia.html#atribuicao' }];
  let ok;
  if (/assumiu|tomou posse/.test(t)) ok = govs.some(g => Number(g.start.slice(0, 4)) === years[0]);
  else if (/impeachment|afastad|renunci|deixou o cargo/.test(t)) ok = govs.some(g => g.note && new RegExp(String(years[0])).test(g.note) && /impeachment|afastad|renunci/i.test(g.note));
  else if (years.length >= 2) {
    // todo ano do intervalo precisa estar coberto por algum mandato (vale para mandatos seguidos, como Lula de 2003 a 2010)
    const [from, to] = [Math.min(...years), Math.max(...years)];
    ok = Array.from({ length: to - from + 1 }, (_, i) => from + i).every(y => govs.some(g => { const [a, b] = span(g); return y >= a && y <= b; }));
  }
  else ok = govs.some(g => { const [a, b] = span(g); return years[0] >= a && years[0] <= b; });
  return { status: ok ? 'verdadeiro' : 'falso', finding: `Mandatos registrados: ${desc}`, evidence: ev };
}

// ---------------------------------------------------------------- ponto de entrada
/** Retorna uma lista de verificações (pode ser vazia) para uma frase. */
export async function checkPolitica(sentence, t, numbers, ctx) {
  const out = [];
  const p = parseProposicao(t);
  if (p) {
    if (claimedVote(t) || /votou|voto|votacao/.test(t)) out.push(await checkVoto(t, p, ctx, sentence));
    else if (/autor|apresentou|criou|propos|de autoria/.test(t)) out.push(await checkAutoria(t, p, ctx, sentence));
    else out.push(await checkStatus(t, p, ctx));
    return out;
  }
  if (/deputad|senador|parlamentar|cota|partido|filiad|\b[A-Z]{2,}\b/.test(t + sentence)) {
    const parl = /deputad|senador|cota|partido|filiad|gastou|reembols/.test(t) ? await findParlamentar(t, ctx, sentence).catch(() => null) : null;
    if (parl) {
      if (/cota|gastou|gasto|despesa|reembols|combustiv|passage/.test(t) && !/emenda/.test(t)) out.push(await checkCota(t, parl, numbers, ctx));
      const part = checkPartido(sentence, parl);
      if (part) out.push(part);
    }
  }
  const mand = checkMandato(t);
  if (mand) out.push(mand);
  return out;
}

/** Só para testes: limpa os caches das listas. */
export function _resetCaches() { deputadoCache.clear(); senadoresPromise = null; }
