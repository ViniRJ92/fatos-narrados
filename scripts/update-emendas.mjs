#!/usr/bin/env node
/**
 * Baixa e processa as emendas parlamentares do Portal da Transparência (CGU).
 *
 *   node scripts/update-emendas.mjs              → baixa o ZIP oficial e processa
 *   node scripts/update-emendas.mjs --zip x.zip  → usa um ZIP já baixado
 *
 * Gera:
 *   data/emendas/meta.json     totais, índices de autores, controle de qualidade, fontes
 *   data/emendas/ano-AAAA.json emendas do ano (leve, usado na busca e nos filtros)
 *   data/emendas/det-AAAA.json favorecidos e convênios do ano (carregado sob demanda)
 *
 * Regras:
 *  - Nada é descartado: registros sem código, sem autor ou duplicados são mantidos e marcados.
 *  - Recebimentos por favorecido e convênios NÃO entram nos totais (são o mesmo dinheiro
 *    visto por outro ângulo, ou instrumentos com contrapartida) — evita dupla contagem.
 *  - Pessoas físicas favorecidas não têm nome nem documento publicados aqui.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listZip } from './lib/unzip.mjs';
import { EMENDAS_SOURCES, TIPOS, situacao, pagoTotal, naoPago } from '../js/data/emendas-catalog.js';
import { getJSON } from '../js/api/official.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'emendas');
const now = new Date().toISOString();
const argZip = process.argv.indexOf('--zip');

// Códigos IBGE das UFs (fonte: IBGE).
const UF_IBGE = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };

// ---------------------------------------------------------------- CSV
function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function* rows(buf) {
  const text = buf.toString('latin1'); // arquivos da CGU são ISO-8859-1
  let start = 0, header = null;
  while (start < text.length) {
    let end = text.indexOf('\n', start); if (end < 0) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, '');
    start = end + 1;
    if (!line) continue;
    const r = parseLine(line);
    if (!header) { header = r; continue; }
    yield Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']));
  }
}
const money = s => { const n = Number(String(s).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const r2 = x => Math.round(x * 100) / 100;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const SEM = v => !v || v === 'Sem informação' || v === 'S/I';

class Dict { constructor() { this.list = []; this.map = new Map(); } id(v) { if (!this.map.has(v)) { this.map.set(v, this.list.length); this.list.push(v); } return this.map.get(v); } }

// ---------------------------------------------------------------- parlamentares (casa/partido por correspondência de nome)
async function loadParlamentares() {
  const byName = new Map();
  const add = (nome, rec) => { const k = norm(nome); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(rec); };
  for (const leg of [54, 55, 56, 57]) {
    let url = `${EMENDAS_SOURCES.camara.api}?idLegislatura=${leg}&itens=100&ordem=ASC&ordenarPor=nome`;
    while (url) {
      const j = await getJSON(url);
      for (const d of j.dados) add(d.nome, { casa: 'Câmara', partido: d.siglaPartido, uf: d.siglaUf, leg });
      url = j.links.find(l => l.rel === 'next')?.href || null;
    }
  }
  const s = await getJSON(EMENDAS_SOURCES.senado.api);
  for (const p of s.ListaParlamentarLegislatura.Parlamentares.Parlamentar) {
    const id = p.IdentificacaoParlamentar;
    add(id.NomeParlamentar, { casa: 'Senado', partido: id.SiglaPartidoParlamentar, uf: id.UfParlamentar });
  }
  return byName;
}

function classifyAutor(nome, byName) {
  const n = norm(nome);
  if (!n || n === 'SEM INFORMACAO') return { casa: null, match: 'sem-autor' };
  if (n.startsWith('BANCADA')) return { casa: 'Bancada estadual', match: 'coletivo' };
  if (/^(COM\.|COMISSAO|CMO)/.test(n)) return { casa: 'Comissão', match: 'coletivo' };
  if (n.startsWith('RELATOR')) return { casa: 'Relator-geral (CMO)', match: 'coletivo' };
  const hits = byName.get(n);
  if (!hits) return { casa: null, match: 'nao-encontrado' };
  const casas = [...new Set(hits.map(h => h.casa))];
  return {
    casa: casas.length === 1 ? casas[0] : casas.join('/'),
    partidos: [...new Set(hits.map(h => h.partido).filter(Boolean))],
    ufs: [...new Set(hits.map(h => h.uf).filter(Boolean))],
    match: casas.length === 1 ? 'nome' : 'ambiguo',
  };
}

// ---------------------------------------------------------------- principal
console.log('Baixando arquivo oficial de emendas da CGU…');
const zipBuf = argZip > 0
  ? await readFile(process.argv[argZip + 1])
  : Buffer.from(await (await fetch(EMENDAS_SOURCES.cgu.file, { headers: { 'User-Agent': 'Mozilla/5.0 (FatosNarrados; dados abertos)' } })).arrayBuffer());
const entries = listZip(zipBuf);
const entry = name => { const e = entries.find(x => x.name === name); if (!e) throw new Error(`Arquivo ${name} ausente no ZIP`); return e.read(); };
console.log(`ZIP com ${entries.length} arquivos: ${entries.map(e => `${e.name} (${(e.size / 1e6).toFixed(1)} MB)`).join(', ')}`);

console.log('Consultando listas de deputados e senadores (legislaturas 55–57)…');
let byName = new Map(), parlamentaresOk = true;
try { byName = await loadParlamentares(); } catch (e) { parlamentaresOk = false; console.warn('! Listas de parlamentares indisponíveis:', e.message); }

const emendas = new Map();          // id → registro
const years = new Map();            // ano → { dicts }
const autores = new Dict();         // código|nome
const quality = { semCodigo: 0, semAutor: 0, partesDuplicadas: 0, valoresInconsistentes: 0, localidadeSemInfo: 0, favSemEmenda: 0, favSemEmendaValor: 0, convSemEmenda: 0, convDuplicados: 0, exemplos: {} };
const sample = (k, id) => { (quality.exemplos[k] ||= []).length < 5 && quality.exemplos[k].push(id); };
const yearCtx = ano => {
  if (!years.has(ano)) years.set(ano, { loc: new Dict(), prog: {}, acao: {}, func: {}, subf: {}, po: {}, fav: new Dict(), favRows: [] });
  return years.get(ano);
};

let lines = 0;
const partKeys = new Set();
for (const r of rows(entry('EmendasParlamentares.csv'))) {
  lines++;
  const ano = r['Ano da Emenda'];
  const y = yearCtx(ano);
  const code = r['Código da Emenda'];
  const noId = SEM(code);
  const raw = Object.values(r).join('|');
  const id = noId ? `SI-${ano}-${createHash('sha1').update(raw).digest('hex').slice(0, 10)}` : code;
  let e = emendas.get(id);
  if (!e) {
    const autorNome = SEM(r['Nome do Autor da Emenda']) ? 'Sem informação' : r['Nome do Autor da Emenda'];
    e = {
      id, ano, tipo: r['Tipo de Emenda'],
      autor: autores.id(`${r['Código do Autor da Emenda']}|${autorNome}`),
      numero: SEM(r['Número da emenda']) ? null : r['Número da emenda'],
      v: [0, 0, 0, 0, 0, 0], parts: [], flags: 0, fav: [], conv: [],
    };
    if (noId) { e.flags |= 1; quality.semCodigo++; sample('semCodigo', id); }
    if (SEM(r['Código do Autor da Emenda'])) { e.flags |= 2; quality.semAutor++; sample('semAutor', id); }
    emendas.set(id, e);
  }
  const vals = ['Valor Empenhado', 'Valor Liquidado', 'Valor Pago', 'Valor Restos A Pagar Inscritos', 'Valor Restos A Pagar Cancelados', 'Valor Restos A Pagar Pagos'].map(k => money(r[k]));
  vals.forEach((x, i) => { e.v[i] += x; });
  const ufCode = String(r['Código UF IBGE'] || '').slice(0, 2);
  const uf = UF_IBGE[ufCode] || null;
  const ibge = /^\d{7}$/.test(r['Código Município IBGE']) ? r['Código Município IBGE'] : null;
  const loc = r['Localidade de aplicação do recurso'];
  if (SEM(loc)) { e.flags |= 16; quality.localidadeSemInfo++; }
  y.func[r['Código Função']] = r['Nome Função'];
  y.subf[r['Código Subfunção']] = r['Nome Subfunção'];
  y.prog[r['Código Programa']] = r['Nome Programa'];
  y.acao[r['Código Ação']] = r['Nome Ação'];
  y.po[`${r['Código Ação']}.${r['Código Plano Orçamentário']}`] = r['Nome Plano Orçamentário'];
  const pk = [id, ibge, loc, r['Código Função'], r['Código Subfunção'], r['Código Programa'], r['Código Ação'], r['Código Plano Orçamentário']].join('|');
  if (partKeys.has(pk)) { e.flags |= 4; quality.partesDuplicadas++; sample('partesDuplicadas', id); }
  partKeys.add(pk);
  e.parts.push([y.loc.id(loc), ibge, uf, r['Código Função'], r['Código Subfunção'], r['Código Programa'], r['Código Ação'], r['Código Plano Orçamentário'], vals.map(r2)]);
}
console.log(`EmendasParlamentares.csv: ${lines} linhas, ${emendas.size} registros de emenda`);

for (const e of emendas.values()) {
  e.v = e.v.map(r2);
  if (e.v[1] > e.v[0] * 1.001 + 1 || e.v[2] > e.v[1] * 1.001 + 1) { e.flags |= 8; quality.valoresInconsistentes++; sample('valoresInconsistentes', e.id); }
}

// ---------- recebimentos por favorecido (não somados aos totais)
let favLines = 0;
const favAgg = new Map(); // emendaId|favKey → [total, first, last, n]
const favInfo = new Map();
for (const r of rows(entry('EmendasParlamentares_PorFavorecido.csv'))) {
  favLines++;
  const code = r['Código da Emenda'];
  const val = money(r['Valor Recebido']);
  if (SEM(code)) { quality.favSemCodigo = (quality.favSemCodigo || 0) + 1; quality.favSemCodigoValor = (quality.favSemCodigoValor || 0) + val; continue; }
  if (!emendas.has(code)) {
    // Emenda presente só no arquivo de favorecidos: preservada, sem valores de execução (evita dupla contagem).
    quality.favSemEmenda++; quality.favSemEmendaValor += val; sample('favSemEmenda', code);
    const ano = /^d{12}$/.test(code) ? code.slice(0, 4) : r['Ano/Mês'].slice(0, 4);
    yearCtx(ano);
    emendas.set(code, { id: code, ano, tipo: r['Tipo de Emenda'], autor: autores.id(`${r['Código do Autor da Emenda']}|${SEM(r['Nome do Autor da Emenda']) ? 'Sem informação' : r['Nome do Autor da Emenda']}`),
      numero: SEM(r['Número da emenda']) ? null : r['Número da emenda'], v: [0, 0, 0, 0, 0, 0], parts: [], flags: 32, fav: [], conv: [] });
  }
  const tipo = r['Tipo Favorecido'];
  const pf = /^Pessoa F/i.test(tipo);
  // Pessoas físicas: agregadas por município, sem nome nem documento.
  const key = pf ? `PF|${r['UF Favorecido']}|${r['Município Favorecido']}` : r['Código do Favorecido'];
  if (!favInfo.has(key)) favInfo.set(key, pf
    ? [null, 'Pessoas físicas (identificação omitida)', '', 'Pessoa Física', r['UF Favorecido'], r['Município Favorecido']]
    : [r['Código do Favorecido'], r['Favorecido'], r['Natureza Jurídica'], tipo, r['UF Favorecido'], r['Município Favorecido']]);
  const k = `${code}\u0000${key}`;
  const ym = r['Ano/Mês'];
  const a = favAgg.get(k);
  if (a) { a[0] += val; if (ym < a[1]) a[1] = ym; if (ym > a[2]) a[2] = ym; a[3]++; }
  else favAgg.set(k, [val, ym, ym, 1]);
}
for (const [k, a] of favAgg) {
  const [code, key] = k.split('\u0000');
  const e = emendas.get(code);
  const y = yearCtx(e.ano);
  e.fav.push([y.fav.id(key), r2(a[0]), a[1], a[2], a[3]]);
}
console.log(`PorFavorecido.csv: ${favLines} linhas, ${favAgg.size} pares emenda–favorecido`);

// ---------- convênios (instrumentos; valor pode incluir contrapartida — não somado)
let convLines = 0;
const convSeen = new Set();
for (const r of rows(entry('EmendasParlamentares_Convenios.csv'))) {
  convLines++;
  const code = r['Código da Emenda'];
  const e = emendas.get(code);
  if (!e) { quality.convSemEmenda++; sample('convSemEmenda', code); continue; }
  const k = `${code}|${r['Número Convênio']}`;
  if (convSeen.has(k)) { quality.convDuplicados++; sample('convDuplicados', code); }
  convSeen.add(k);
  e.conv.push([r['Número Convênio'], r['Convenente'], r['Objeto Convênio'], r2(money(r['Valor Convênio'])), r['Data Publicação Convênio'], r['Localidade do gasto']]);
}
console.log(`Convenios.csv: ${convLines} linhas`);

// ---------- autores
const autorList = autores.list.map(s => {
  const [code, nome] = s.split('|');
  const c = parlamentaresOk ? classifyAutor(nome, byName) : { casa: null, match: 'nao-verificado' };
  return [code, nome, c.casa, c.partidos || [], c.ufs || [], c.match];
});

// ---------- saída por ano
await mkdir(OUT, { recursive: true });
const tipoList = Object.keys(TIPOS);
const yearsMeta = [];
const totals = {};
for (const [ano, y] of [...years.entries()].sort()) {
  const list = [...emendas.values()].filter(e => e.ano === ano);
  const favs = y.fav.list.map(k => favInfo.get(k));
  const doc = {
    ano, fetchedAt: now, source: EMENDAS_SOURCES.cgu.file,
    tipos: tipoList, loc: y.loc.list, func: y.func, subf: y.subf, prog: y.prog, acao: y.acao, po: y.po, favs: favs.map(f => [f[0], f[1], f[3], f[4], f[5]]),
    // [id, tipoIdx, autorIdx, numero, v[6], flags, parts[], favIdx[], recebido, primeiroAnoMes, ultimoAnoMes, nConvenios]
    rows: list.map(e => [e.id, tipoList.indexOf(e.tipo), e.autor, e.numero, e.v, e.flags, e.parts,
      e.fav.map(f => f[0]), r2(e.fav.reduce((s, f) => s + f[1], 0)),
      e.fav.reduce((m, f) => (!m || f[2] < m ? f[2] : m), null), e.fav.reduce((m, f) => (!m || f[3] > m ? f[3] : m), null), e.conv.length]),
  };
  const json = JSON.stringify(doc);
  await writeFile(join(OUT, `ano-${ano}.json`), json);
  const det = { ano, fetchedAt: now, favs,
    fav: Object.fromEntries(list.filter(e => e.fav.length).map(e => [e.id, e.fav])),
    conv: Object.fromEntries(list.filter(e => e.conv.length).map(e => [e.id, e.conv])) };
  await writeFile(join(OUT, `det-${ano}.json`), JSON.stringify(det));
  const t = { n: list.length, v: [0, 0, 0, 0, 0, 0], pago: 0, naoPago: 0, porTipo: {}, porUF: {}, porFuncao: {}, situacao: {} };
  for (const e of list) {
    if (e.flags & 32) { t.soRecebimentos = (t.soRecebimentos || 0) + 1; }
    e.v.forEach((x, i) => { t.v[i] += x; });
    t.pago += pagoTotal(e.v); t.naoPago += naoPago(e.v);
    const tt = (t.porTipo[e.tipo] ||= { n: 0, emp: 0, pago: 0 }); tt.n++; tt.emp += e.v[0]; tt.pago += pagoTotal(e.v);
    const s = situacao(e.v); t.situacao[s] = (t.situacao[s] || 0) + 1;
    for (const p of e.parts) {
      const uf = p[2] || 'Sem UF';
      const u = (t.porUF[uf] ||= { emp: 0, pago: 0 }); u.emp += p[8][0]; u.pago += p[8][2] + p[8][5];
      const f = (t.porFuncao[y.func[p[3]] || p[3]] ||= { emp: 0, pago: 0 }); f.emp += p[8][0]; f.pago += p[8][2] + p[8][5];
    }
  }
  totals[ano] = JSON.parse(JSON.stringify(t, (k, v) => (typeof v === 'number' ? r2(v) : v)));
  yearsMeta.push({ ano, emendas: list.length, bytes: json.length });
  console.log(`✔ ano-${ano}.json  ${list.length} emendas  ${(json.length / 1e6).toFixed(2)} MB`);
}

quality.favSemEmendaValor = r2(quality.favSemEmendaValor);
quality.favSemCodigoValor = r2(quality.favSemCodigoValor || 0);
const meta = {
  updatedAt: now,
  sources: EMENDAS_SOURCES,
  files: entries.map(e => ({ name: e.name, bytes: e.size })),
  lines: { emendas: lines, favorecidos: favLines, convenios: convLines },
  parlamentaresVerificados: parlamentaresOk,
  years: yearsMeta, totals, quality,
  autores: autorList,
};
await writeFile(join(OUT, 'meta.json'), JSON.stringify(meta));

// Malha das UFs (IBGE), usada no mapa.
try {
  const geo = await getJSON(EMENDAS_SOURCES.ibge.api, { timeout: 60000 });
  await mkdir(join(ROOT, 'data', 'geo'), { recursive: true });
  await writeFile(join(ROOT, 'data', 'geo', 'uf.json'), JSON.stringify(geo));
  console.log('✔ malha das UFs (IBGE)');
} catch (e) { console.warn('! malha do IBGE indisponível; mantida a versão anterior:', e.message); }

// Manifesto geral
const MANIFEST = join(ROOT, 'data', 'manifest.json');
const manifest = await readFile(MANIFEST, 'utf8').then(JSON.parse).catch(() => ({ series: {} }));
manifest.series.emendas = { ok: true, fetchedAt: now, first: yearsMeta[0]?.ano, last: yearsMeta.at(-1)?.ano, count: emendas.size };
await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
console.log('Qualidade:', JSON.stringify({ ...quality, exemplos: undefined }));
