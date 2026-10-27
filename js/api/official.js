/**
 * Conectores das APIs oficiais. Funcionam no navegador e no Node 18+ (fetch global).
 * Não há chaves, tokens ou intermediários: as requisições vão direto aos órgãos.
 */
import { dailyToMonthly, q4ToAnnual, round } from '../data/transforms.js';

const BCB_BASE = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.';
const SIDRA_BASE = 'https://apisidra.ibge.gov.br/values';

export async function getJSON(url, { timeout = 45000, retries = 2, headers } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', ...headers } });
      if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
      const text = await res.text();
      if (text.trimStart().startsWith('<')) throw new Error(`Resposta não-JSON (HTML) em ${url}`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    } finally { clearTimeout(t); }
  }
  throw lastErr;
}

const brDateToIso = s => { const [d, m, y] = s.split('/'); return `${y}-${m}-${d}`; };
const isoToBr = s => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const num = v => { if (v == null || v === '' ) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

/**
 * Série do SGS/BCB. Séries diárias são limitadas a janelas de 10 anos pela API,
 * por isso a busca é feita em blocos.
 */
export async function fetchBCB({ code, invert = false, daily = null, from = null }, { since = null } = {}) {
  let raw = [];
  if (daily) {
    const startYear = Number((since || from || '1990-01-01').slice(0, 4));
    const endYear = new Date().getUTCFullYear();
    for (let y = startYear; y <= endYear; y += 9) {
      const ini = y === startYear && (since || from) ? isoToBr(since || from) : `01/01/${y}`;
      const fim = `31/12/${Math.min(y + 8, endYear)}`;
      const part = await getJSON(`${BCB_BASE}${code}/dados?formato=json&dataInicial=${ini}&dataFinal=${fim}`);
      raw.push(...part);
    }
  } else {
    const q = since ? `&dataInicial=${isoToBr(since)}` : '';
    raw = await getJSON(`${BCB_BASE}${code}/dados?formato=json${q}`);
  }
  // A meta Selic (432) traz datas futuras (vigência até a próxima reunião do Copom): descartadas.
  const today = new Date().toISOString().slice(0, 10);
  let pts = raw.map(r => [brDateToIso(r.data), num(r.valor)]).filter(p => p[1] != null && p[0] <= today);
  if (from) pts = pts.filter(p => p[0] >= from);
  if (daily) pts = dailyToMonthly(pts, daily);
  else pts = pts.map(([d, v]) => [d.slice(0, 7), v]);
  if (invert) pts = pts.map(([p, v]) => [p, round(-v, 4)]);
  return dedupeSort(pts);
}

/** Converte código de período do SIDRA em "YYYY-MM" ou "YYYY". */
export function sidraPeriod(code, label = '') {
  const c = String(code);
  if (/^\d{4}$/.test(c)) return c;
  const y = c.slice(0, 4), n = Number(c.slice(4));
  if (/trimestre/i.test(label) && !/móvel/i.test(label) && n <= 4) return `${y}-${String(n * 3).padStart(2, '0')}`;
  return `${y}-${String(n).padStart(2, '0')}`;
}

/** Linhas do SIDRA → pontos. A primeira linha da resposta é o cabeçalho. */
export function parseSidra(rows) {
  const [header, ...data] = rows;
  const dimKey = Object.keys(header).find(k => /^D\dN$/.test(k) && /^(Mês|Trimestre|Trimestre Móvel|Ano)$/i.test(header[k]));
  if (!dimKey) throw new Error('SIDRA: dimensão de período não encontrada');
  const codeKey = dimKey.replace(/N$/, 'C');
  const kind = header[dimKey];
  return dedupeSort(data.map(r => [sidraPeriod(r[codeKey], kind), num(r.V)]).filter(p => p[1] != null));
}

export async function fetchSidra({ path }) {
  return parseSidra(await getJSON(`${SIDRA_BASE}${path}`));
}

/** Encadeia a mesma variável/categoria em várias tabelas (ex.: IPCA por subitem). */
export async function fetchSidraChain({ variable, classification, category, tables }) {
  const all = [];
  for (const t of tables) all.push(...await fetchSidra({ path: `/t/${t}/n1/all/v/${variable}/p/all/c${classification}/${category}` }));
  return dedupeSort(all);
}

function dedupeSort(pts) {
  const m = new Map(pts.map(p => [p[0], p[1]]));
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
}

/** Busca um indicador do catálogo. `getById` resolve dependências de séries derivadas. */
export async function fetchIndicator(ind, getById) {
  const f = ind.fetch;
  switch (f.kind) {
    case 'bcb': return fetchBCB(f);
    case 'sidra': return fetchSidra(f);
    case 'sidra-chain': return fetchSidraChain(f);
    case 'derived': {
      const base = await getById(f.from);
      if (f.op === 'q4-to-annual') return q4ToAnnual(base);
      throw new Error(`Operação derivada desconhecida: ${f.op}`);
    }
    default: throw new Error(`Tipo de fonte desconhecido: ${f.kind}`);
  }
}

/** URL pública da consulta, para o cidadão conferir o dado bruto. */
export function rawUrl(ind) {
  const f = ind.fetch;
  if (f.kind === 'bcb') return `${BCB_BASE}${f.code}/dados?formato=json`;
  if (f.kind === 'sidra') return `${SIDRA_BASE}${f.path}`;
  if (f.kind === 'sidra-chain') return `${SIDRA_BASE}/t/${f.tables.at(-1)}/n1/all/v/${f.variable}/p/all/c${f.classification}/${f.category}`;
  return null;
}

// ---------------- SICONFI (Tesouro) ----------------
const SICONFI = 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo';

/** RREO Anexo 02 da União (id_ente=1), 6º bimestre: despesa liquidada no ano por função. */
export async function fetchSpendingYear(year, funcoes) {
  const url = `${SICONFI}?an_exercicio=${year}&nr_periodo=6&co_tipo_demonstrativo=RREO&no_anexo=RREO-Anexo%2002&id_ente=1`;
  const j = await getJSON(url, { timeout: 90000 });
  const items = j.items || [];
  if (!items.length) return null;
  // O nome da coluna de despesa liquidada mudou ao longo dos anos ("Até o Bimestre (d)" em 2015–2016).
  const col = [...new Set(items.map(i => i.coluna))]
    .find(c => /^(DESPESAS LIQUIDADAS ATÉ O BIMESTRE|Até o Bimestre) \(d\)$/i.test(c));
  if (!col) throw new Error(`coluna de despesa liquidada não encontrada (${year})`);
  // Somente o bloco "exceto intra-orçamentárias".
  const liq = items.filter(i => i.coluna === col && i.cod_conta === 'RREO2TotalDespesas');
  const pick = name => liq.find(i => i.conta.trim().toLowerCase() === name.toLowerCase())?.valor ?? null;
  const byFn = Object.fromEntries(funcoes.map(fn => [fn, pick(fn)]));
  const total = liq.find(i => /^DESPESAS \(EXCETO INTRA-OR/i.test(i.conta))?.valor ?? null;
  const refin = (pick('Refinanciamento da Dívida Interna') ?? 0) + (pick('Refinanciamento da Dívida Externa') ?? 0);
  return { year, total, refin, byFn, column: col, url };
}
