/**
 * Desmontando Boatos — verificador de alegações contra os dados oficiais integrados ao portal.
 *
 * Funciona por regras, sem inteligência artificial: identifica no texto o indicador citado,
 * números, datas, governos e palavras de comparação, e confere com as séries oficiais.
 * Quando não há dado oficial integrado para conferir, a resposta é "Não comprovado" ou
 * "Inconclusivo", nunca "Falso".
 *
 * `ctx` fornece os dados: { series(id), spending(), emendasMeta(), emendasYear(ano), today }.
 */
import { INDICATORS, indicatorById, SOURCE_ORGS, SPENDING, FUNCOES } from '../data/catalog.js';
import { GOVERNMENTS, governmentForPeriod } from '../data/governments.js';
import { compound } from '../data/transforms.js';
import { rawUrl } from '../api/official.js';
import { EMENDAS_SOURCES } from '../data/emendas-catalog.js';

export const CLASSES = {
  verdadeiro: 'Verdadeiro',
  falso: 'Falso',
  parcial: 'Parcialmente verdadeiro',
  enganoso: 'Enganoso ou fora de contexto',
  desatualizado: 'Desatualizado',
  'nao-comprovado': 'Não comprovado',
  inconclusivo: 'Inconclusivo',
};

export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmt = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const per = p => (!p ? '—' : /^\d{4}$/.test(p) ? p : `${MES_CURTO[+p.slice(5, 7) - 1]}/${p.slice(0, 4)}`);

// ---------------------------------------------------------------- léxico
const TOPICS = [
  [/gasolina/, 'ipca-gasolina'], [/diesel/, 'ipca-diesel'], [/etanol|alcool combustivel/, 'ipca-etanol'],
  [/gas de cozinha|botijao|\bglp\b/, 'ipca-gas-botijao'], [/energia eletrica|conta de luz|tarifa de energia|\bluz\b/, 'ipca-energia'],
  [/aluguel/, 'ipca-aluguel'], [/plano de saude/, 'ipca-plano-saude'], [/onibus|passagem de onibus/, 'ipca-onibus'],
  [/\barroz\b/, 'ipca-arroz'], [/\bcarnes?\b/, 'ipca-carnes'], [/\bcafe\b/, 'ipca-cafe'],
  [/aliment|comida|supermercado|cesta basica/, 'ipca-alimentacao-domicilio'],
  [/inflacao|\bipca\b|custo de vida|carestia/, 'ipca-12m'],
  [/desemprego|desocupa|desempregad/, 'desocupacao'], [/\brenda\b|salario medio|rendimento/, 'rendimento-real'],
  [/\bpib\b|economia (cresceu|caiu|encolheu|cresce)|crescimento economico|recessao/, 'pib-anual'],
  [/divida liquida/, 'divida-liquida'], [/juros da divida/, 'juros-nominais'], [/divida/, 'divida-bruta'],
  [/deficit|superavit|rombo|resultado primario|contas publicas/, 'resultado-primario'],
  [/selic|taxa (basica )?de juros|\bjuros\b/, 'selic'], [/dolar|cambio/, 'dolar'],
  [/exporta/, 'exportacoes'], [/importa/, 'importacoes'], [/balanca comercial|saldo comercial/, 'saldo-comercial'],
];
const FN_WORDS = { saude: 'Saúde', educacao: 'Educação', previdencia: 'Previdência Social', 'seguranca publica': 'Segurança Pública', defesa: 'Defesa Nacional',
  'assistencia social': 'Assistência Social', cultura: 'Cultura', 'ciencia e tecnologia': 'Ciência e Tecnologia', agricultura: 'Agricultura', saneamento: 'Saneamento',
  habitacao: 'Habitação', transporte: 'Transporte', 'gestao ambiental': 'Gestão Ambiental', 'meio ambiente': 'Gestão Ambiental', esporte: 'Desporto e Lazer', trabalho: 'Trabalho' };
const SENSITIVE = /corrup|propina|desvi|fraude|roub|lavagem|escandalo|preso|prisao|condenad|investigad|denuncia|delacao|superfaturad|mensalao|lava jato|rachadinha|crime/;
const UP = /subi|aument|cresc|dispar|explodi|alta\b|elev|dobr|tripl|disparada|piorou/;
const DOWN = /\bcai|caiu|diminu|reduz|queda|recu|despenc|baix|encolh|melhorou|cort/;
const NOW = /\b(hoje|atualmente|agora|neste momento|no momento|esta em|esta acima|esta abaixo|atual)\b/;

function govsIn(t) {
  const out = [];
  if (/lula/.test(t)) {
    if (/lula 1|primeiro mandato do lula|lula i\b/.test(t)) out.push('lula1');
    else if (/lula 2|segundo mandato do lula|lula ii\b/.test(t)) out.push('lula2');
    else out.push('lula3');
  }
  if (/bolsonaro/.test(t)) out.push('bolsonaro');
  if (/temer/.test(t)) out.push('temer');
  if (/dilma/.test(t)) out.push(/dilma 1|primeiro mandato da dilma/.test(t) ? 'dilma1' : /dilma 2|segundo mandato da dilma/.test(t) ? 'dilma2' : 'dilma1', ...(/dilma 1|primeiro mandato/.test(t) ? [] : ['dilma2']));
  if (/\bfhc\b|fernando henrique/.test(t)) out.push('fhc1', 'fhc2');
  if (/governo atual|atual governo/.test(t) && !out.length) out.push('lula3');
  return [...new Set(out)].map(id => GOVERNMENTS.find(g => g.id === id));
}

export function parseNumbers(t) {
  const pct = [...t.matchAll(/(-?\d+(?:[.,]\d+)?)\s*(%|por cento|pontos percentuais|p\.p\.)/g)].map(m => Number(m[1].replace(',', '.')));
  const money = [];
  for (const m of t.matchAll(/(?:r\$\s*)?(\d+(?:[.,]\d+)*)\s*(mil|milhoes|milhao|bilhoes|bilhao|bi\b|tri|trilhoes|trilhao|mi\b)?\s*(de reais|reais)?/g)) {
    if (!m[0].includes('r$') && !m[3] && !(m[2] && /r\$|reais/.test(t))) continue;
    const raw = m[1].includes(',') ? m[1].replace(/\./g, '').replace(',', '.') : (m[2] ? m[1] : m[1].replace(/\./g, ''));
    let v = Number(raw);
    const mult = { mil: 1e3, milhao: 1e6, milhoes: 1e6, mi: 1e6, bilhao: 1e9, bilhoes: 1e9, bi: 1e9, tri: 1e12, trilhao: 1e12, trilhoes: 1e12 }[m[2]] || 1;
    v *= mult;
    if (Number.isFinite(v) && v > 0) money.push(v);
  }
  const mult = /triplic/.test(t) ? 3 : /dobr|duplic/.test(t) ? 2 : /pela metade|metade/.test(t) ? 0.5 : null;
  const years = [...new Set([...t.matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map(m => m[1]))].sort();
  const months = [];
  for (const m of t.matchAll(new RegExp(`(${MESES.join('|')})\\s+(?:de\\s+)?(19[89]\\d|20[0-3]\\d)`, 'g'))) months.push(`${m[2]}-${String(MESES.indexOf(m[1]) + 1).padStart(2, '0')}`);
  // números sem unidade logo após palavras de comparação ("acima de 10", "em 5")
  const bare = [...t.matchAll(/(?:acima de|abaixo de|mais de|menos de|passou de|chegou a|esta em|foi de|em torno de|de)\s+(\d+(?:[.,]\d+)?)(?!\s*(%|mil|milh|bilh|tri|reais|\d))/g)]
    .map(m => Number(m[1].replace(',', '.'))).filter(v => !(v >= 1980 && v <= 2039));
  return { pct, money, mult, years, months, bare };
}

function comparator(t) {
  if (/acima de|mais de|passou de|supera|ultrapass|maior que|superior a/.test(t)) return '>';
  if (/abaixo de|menos de|menor que|inferior a|nao chega a/.test(t)) return '<';
  return '=';
}
function record(t) {
  if (/(maior|mais alt[ao]|pior)\s+(da|de toda a)\s+historia|recorde|nunca (foi|esteve) tao alt|maior nivel|nivel mais alto/.test(t)) return 'max';
  if (/(menor|mais baix[ao]|melhor)\s+(da|de toda a)\s+historia|nunca (foi|esteve) tao baix|menor nivel|nivel mais baixo/.test(t)) return 'min';
  return null;
}

// ---------------------------------------------------------------- avaliação
const close = (a, b, unitPct) => {
  const d = Math.abs(a - b), rel = Math.abs(b) > 0 ? d / Math.abs(b) : d;
  if (unitPct ? d <= 0.15 || rel <= 0.03 : rel <= 0.05) return 'exato';
  if (unitPct ? d <= 0.6 || rel <= 0.08 : rel <= 0.15) return 'aproximado';
  return 'diferente';
};
const lastOfYear = (pts, y) => [...pts].reverse().find(p => p[0].startsWith(y)) || null;
function pointFor(pts, ind, sel) {
  if (sel.month) return pts.find(p => p[0] === sel.month) || null;
  if (sel.year) return ind.freq === 'A' ? pts.find(p => p[0] === sel.year) || null : lastOfYear(pts, sel.year);
  return pts.at(-1);
}
function govRange(pts, gov) {
  const own = pts.filter(p => governmentForPeriod(p[0])?.id === gov.id);
  if (!own.length) return null;
  const i = pts.findIndex(p => p[0] === own[0][0]);
  return { own, inherited: i > 0 ? pts[i - 1] : null, end: own.at(-1) };
}

function evidenceFor(ind, doc) {
  const org = SOURCE_ORGS[ind.org];
  return { label: `${ind.title} (${org.name})`, url: rawUrl(ind) || ind.links?.[0], fetchedAt: doc?.fetchedAt };
}

async function checkIndicator(sentence, t, indId, ctx) {
  const ind = indicatorById(indId);
  const doc = await ctx.series(indId).catch(() => null);
  if (!doc) return { status: 'nao-comprovado', finding: `A série oficial de ${ind.short} não pôde ser carregada agora.`, evidence: [] };
  const pts = doc.points;
  const monthly = doc.monthly || (indId === 'ipca-mensal' ? doc.points : null);
  const n = parseNumbers(t);
  const govs = govsIn(t);
  const rec = record(t);
  const cmp = comparator(t);
  const isRate = ['%', '% PIB', '% a.a.'].includes(ind.unit);
  const unitTxt = v => (ind.unit === 'R$' ? `R$ ${fmt(v, ind.decimals)}` : ind.unit === 'US$ mi' ? `US$ ${fmt(v, 0)} milhões` : `${fmt(v, ind.decimals)}${ind.unit === '%' ? '%' : ind.unit === '% PIB' ? '% do PIB' : ind.unit === '% a.a.' ? '% ao ano' : ''}`);
  const ev = [evidenceFor(ind, doc)];
  const timeline = [];
  const latest = pts.at(-1);
  const out = (status, finding, extra = {}) => ({ status, finding, evidence: ev, timeline, indicator: ind.short, ...extra });
  const sel = { year: n.months.length ? null : n.years.at(-1), month: n.months.at(-1) };
  const claimedNum = isRate || ind.unit === 'índice' ? (n.pct[0] ?? n.bare[0]) : ind.unit === 'R$' ? (n.money[0] ?? n.bare[0]) : (n.bare[0] ?? n.pct[0]);
  const scopeNote = ind.display === 'acc12' || indId === 'ipca-12m' ? ' (variação acumulada em 12 meses)' : '';

  // 1. Recorde histórico
  if (rec) {
    const target = n.years.length || n.months.length ? pointFor(pts, ind, sel) : latest;
    if (!target) return out('nao-comprovado', `Não há dado de ${ind.short} para o período citado.`);
    const extreme = pts.reduce((a, b) => ((rec === 'max' ? b[1] > a[1] : b[1] < a[1]) ? b : a));
    timeline.push([target[0], `${ind.short}: ${unitTxt(target[1])}`], [extreme[0], `${rec === 'max' ? 'Maior' : 'Menor'} valor da série: ${unitTxt(extreme[1])}`]);
    const since = `Série oficial desde ${per(pts[0][0])}`;
    if (extreme[0] === target[0] || Math.abs(extreme[1] - target[1]) < 1e-9) {
      return out(pts[0][0] > '2000' ? 'parcial' : 'verdadeiro', `${ind.short} em ${per(target[0])} (${unitTxt(target[1])}) é o ${rec === 'max' ? 'maior' : 'menor'} valor da série oficial. ${since}${pts[0][0] > '2000' ? ', então "da história" vale só para esse período.' : '.'}`);
    }
    return out('falso', `${ind.short} em ${per(target[0])} foi ${unitTxt(target[1])}${scopeNote}. O ${rec === 'max' ? 'maior' : 'menor'} valor da série é ${unitTxt(extreme[1])}, em ${per(extreme[0])}. ${since}.`);
  }

  // 2. Variação durante um governo
  if (govs.length) {
    const results = [];
    for (const g of govs) {
      const r = govRange(pts, g);
      if (!r) { results.push({ g, status: 'nao-comprovado', text: `Não há dado de ${ind.short} no período de ${g.short}.` }); continue; }
      let change, text, dir;
      if ((indId === 'ipca-12m' || ind.display === 'acc12') && monthly) {
        const own = monthly.filter(p => governmentForPeriod(p[0])?.id === g.id);
        change = compound(own.map(p => p[1]));
        dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
        text = `${ind.short} acumulou ${fmt(change)}% de variação de preços em ${g.short} (${per(own[0][0])} a ${per(own.at(-1)[0])}).`;
        timeline.push([own[0][0], `Início: ${g.short}`], [own.at(-1)[0], `Acumulado: ${fmt(change)}%`]);
      } else if (ind.freq === 'A') {
        const vals = r.own.map(p => p[1]);
        change = vals.reduce((s, v) => s * (1 + v / 100), 1);
        change = (change ** (1 / vals.length) - 1) * 100;
        dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
        text = `${ind.short} teve média de ${fmt(change)}% ao ano em ${g.short} (${r.own.map(p => `${p[0]}: ${fmt(p[1])}%`).join('; ')}).`;
        r.own.forEach(p => timeline.push([p[0], `${ind.short}: ${fmt(p[1])}%`]));
      } else {
        const base = r.inherited || r.own[0];
        change = r.end[1] - base[1];
        const rel = base[1] !== 0 ? (r.end[1] / base[1] - 1) * 100 : null;
        dir = Math.abs(change) < (isRate ? 0.1 : Math.abs(base[1]) * 0.01) ? 'flat' : change > 0 ? 'up' : 'down';
        text = `${ind.short} passou de ${unitTxt(base[1])} (${per(base[0])}) para ${unitTxt(r.end[1])} (${per(r.end[0])}) em ${g.short}: ${isRate ? `${change > 0 ? '+' : ''}${fmt(change)} pontos` : `${rel > 0 ? '+' : ''}${fmt(rel)}%`}.${r.inherited ? '' : ' A série começa depois da posse.'}`;
        timeline.push([base[0], `Valor herdado: ${unitTxt(base[1])}`], [r.end[0], `${g.end ? 'Fim do mandato' : 'Último dado'}: ${unitTxt(r.end[1])}`]);
        if (n.mult) {
          const ratio = r.end[1] / base[1];
          const ok = Math.abs(ratio - n.mult) / n.mult <= 0.1;
          results.push({ g, status: ok ? 'verdadeiro' : Math.abs(ratio - n.mult) / n.mult <= 0.25 ? 'parcial' : 'falso', text: `${text} O valor foi multiplicado por ${fmt(ratio, 2)}.` });
          continue;
        }
      }
      const claimedDir = UP.test(t) ? 'up' : DOWN.test(t) ? 'down' : null;
      let status = 'nao-comprovado';
      if (claimedNum != null && (n.pct.length || n.bare.length)) {
        const c = close(Math.abs(change), Math.abs(claimedNum), true);
        status = c === 'exato' ? 'verdadeiro' : c === 'aproximado' ? 'parcial' : 'falso';
        if (claimedDir && claimedDir !== dir && dir !== 'flat') status = 'falso';
      } else if (claimedDir) {
        status = dir === 'flat' ? 'parcial' : claimedDir === dir ? 'verdadeiro' : 'falso';
        if (dir === 'flat') text += ' A variação foi muito pequena.';
      } else continue;
      if (!g.end) text += ' O mandato está em andamento.';
      results.push({ g, status, text });
    }
    if (results.length) {
      const st = results.every(r => r.status === results[0].status) ? results[0].status : 'parcial';
      return out(st, results.map(r => r.text).join(' '), { note: 'Variação no período não prova que o governo causou a mudança. Veja os limites em Governos.' });
    }
  }

  // 3. Valor em uma data (ou hoje)
  if (claimedNum != null) {
    const target = pointFor(pts, ind, sel);
    if (!target) return out('nao-comprovado', `Não há dado de ${ind.short} para ${sel.month ? per(sel.month) : sel.year}. A série oficial vai de ${per(pts[0][0])} a ${per(latest[0])}.`);
    timeline.push([target[0], `${ind.short}: ${unitTxt(target[1])}`]);
    let status;
    if (cmp !== '=') status = (cmp === '>' ? target[1] > claimedNum : target[1] < claimedNum) ? 'verdadeiro' : 'falso';
    else { const c = close(target[1], claimedNum, isRate); status = c === 'exato' ? 'verdadeiro' : c === 'aproximado' ? 'parcial' : 'falso'; }
    let finding = `${ind.short} em ${per(target[0])}: ${unitTxt(target[1])}${scopeNote}. A alegação fala em ${cmp === '>' ? 'mais de ' : cmp === '<' ? 'menos de ' : ''}${isRate ? `${fmt(claimedNum)}%` : unitTxt(claimedNum)}.`;
    if (status === 'falso') {
      // o número aparece em outro período?
      const match = [...pts].reverse().find(p => (cmp === '=' ? close(p[1], claimedNum, isRate) !== 'diferente' : cmp === '>' ? p[1] > claimedNum : p[1] < claimedNum));
      if (match) {
        timeline.push([match[0], `${ind.short}: ${unitTxt(match[1])}`]);
        const recent = match[0] >= `${+latest[0].slice(0, 4) - 3}`;
        const aboutNow = !sel.year && !sel.month;
        if (aboutNow && recent) { status = 'desatualizado'; finding += ` Esse valor foi registrado em ${per(match[0])}, mas não corresponde ao dado mais recente.`; }
        else if (!aboutNow) { status = 'enganoso'; finding += ` O número corresponde a ${per(match[0])}, não ao período citado.`; }
        else finding += ` O último período com esse nível foi ${per(match[0])}.`;
      }
    }
    return out(status, finding);
  }

  // 4. Direção sem governo ("está subindo")
  const claimedDir = UP.test(t) ? 'up' : DOWN.test(t) ? 'down' : null;
  if (claimedDir) {
    const end = sel.year ? lastOfYear(pts, sel.year) : latest;
    if (!end) return out('nao-comprovado', `Não há dado de ${ind.short} para o período citado.`);
    const [y, m] = end[0].split('-');
    const prev = ind.freq === 'A' ? pts.find(p => p[0] === String(+end[0] - 1)) : pts.find(p => p[0] === `${+y - 1}-${m}`);
    if (!prev) return out('nao-comprovado', `Não há dado de ${ind.short} um ano antes de ${per(end[0])} para comparar.`);
    timeline.push([prev[0], `${ind.short}: ${unitTxt(prev[1])}`], [end[0], `${ind.short}: ${unitTxt(end[1])}`]);
    if (ind.freq === 'A' || ind.display === 'acc12' || indId === 'ipca-12m') {
      // taxas: "subiu" pode significar variação positiva (preços subindo) ou taxa maior que antes
      const pricesUp = end[1] > 0;
      const st = claimedDir === 'up' ? (pricesUp ? 'verdadeiro' : 'falso') : (end[1] < prev[1] ? 'verdadeiro' : end[1] < 0 ? 'verdadeiro' : 'falso');
      return out(st, `${ind.short} em ${per(end[0])}: ${unitTxt(end[1])}${scopeNote}; um ano antes: ${unitTxt(prev[1])}. ${claimedDir === 'up' ? (pricesUp ? 'Os preços subiram no período de 12 meses.' : 'Os preços caíram no período de 12 meses.') : end[1] < prev[1] ? 'O ritmo de alta diminuiu.' : 'O ritmo de alta não diminuiu.'}`);
    }
    const dir = end[1] > prev[1] ? 'up' : end[1] < prev[1] ? 'down' : 'flat';
    return out(dir === claimedDir ? 'verdadeiro' : dir === 'flat' ? 'parcial' : 'falso', `${ind.short} passou de ${unitTxt(prev[1])} (${per(prev[0])}) para ${unitTxt(end[1])} (${per(end[0])}), comparação com 12 meses antes.`);
  }

  // Só o tema foi citado: informa o dado, sem classificar.
  return out(null, `${ind.short} em ${per(latest[0])}: ${unitTxt(latest[1])}${scopeNote}. A frase não traz número, período ou comparação que possam ser conferidos.`);
}

async function checkSpending(t, fn, ctx) {
  const doc = await ctx.spending().catch(() => null);
  const ev = [{ label: `${SPENDING.title} (Tesouro Nacional, SICONFI)`, url: doc?.query || SPENDING.api, fetchedAt: doc?.fetchedAt }];
  if (!doc) return { status: 'nao-comprovado', finding: 'Os dados de gastos por função não puderam ser carregados.', evidence: ev };
  const n = parseNumbers(t);
  const series = doc.years.map((y, i) => {
    let v = doc.byFn[fn][i];
    if (v != null && fn === 'Encargos Especiais') v -= doc.refin[i] || 0;
    return [String(y), v];
  }).filter(p => p[1] != null);
  const year = n.years.at(-1) || series.at(-1)[0];
  const p = series.find(x => x[0] === year);
  const timeline = series.slice(-5).map(([y, v]) => [y, `${fn}: R$ ${fmt(v / 1e9)} bi`]);
  if (!p) return { status: 'nao-comprovado', finding: `Não há dado de despesa com ${fn} em ${year}. O SICONFI tem dados de ${series[0][0]} a ${series.at(-1)[0]}.`, evidence: ev, timeline };
  const real = v => v * (doc.deflator[p[0]] ?? 1);
  if (n.money.length) {
    const c = close(p[1], n.money[0], false);
    const cr = close(real(p[1]), n.money[0], false);
    const st = c === 'exato' || cr === 'exato' ? 'verdadeiro' : c === 'aproximado' || cr === 'aproximado' ? 'parcial' : 'falso';
    return { status: st, finding: `A União liquidou R$ ${fmt(p[1] / 1e9)} bilhões com ${fn} em ${p[0]} (R$ ${fmt(real(p[1]) / 1e9)} bilhões em valores de ${doc.deflatorBase}). A alegação fala em R$ ${fmt(n.money[0] / 1e9)} bilhões.`, evidence: ev, timeline };
  }
  const prev = series.find(x => x[0] === String(+p[0] - 1));
  const claimedDir = UP.test(t) ? 'up' : DOWN.test(t) ? 'down' : null;
  if (prev && claimedDir) {
    const nominalUp = p[1] > prev[1], realUp = real(p[1]) > prev[1] * (doc.deflator[prev[0]] ?? 1);
    const okNom = claimedDir === 'up' ? nominalUp : !nominalUp, okReal = claimedDir === 'up' ? realUp : !realUp;
    return { status: okNom && okReal ? 'verdadeiro' : okNom || okReal ? 'parcial' : 'falso',
      finding: `Despesa com ${fn}: R$ ${fmt(prev[1] / 1e9)} bi em ${prev[0]} e R$ ${fmt(p[1] / 1e9)} bi em ${p[0]} (valores da época). Corrigida pela inflação, ${realUp ? 'subiu' : 'caiu'}.${okNom !== okReal ? ' O resultado muda conforme se considere ou não a inflação.' : ''}`, evidence: ev, timeline };
  }
  return { status: null, finding: `A União liquidou R$ ${fmt(p[1] / 1e9)} bilhões com ${fn} em ${p[0]}.`, evidence: ev, timeline };
}

async function checkEmendas(t, ctx) {
  const meta = await ctx.emendasMeta().catch(() => null);
  const ev = [{ label: 'Emendas parlamentares (CGU, Portal da Transparência)', url: EMENDAS_SOURCES.cgu.page, fetchedAt: meta?.updatedAt }];
  if (!meta) return { status: 'nao-comprovado', finding: 'Os dados de emendas não estão disponíveis agora.', evidence: ev };
  const n = parseNumbers(t);
  const anos = n.years.filter(y => meta.totals[y]);
  const ano = anos.at(-1) || meta.years.map(y => y.ano).filter(y => y < String(ctx.today.getFullYear())).at(-1);
  // autor citado pelo nome (2+ palavras para evitar coincidências)
  const autores = meta.autores.filter(a => a[1] && a[1].split(' ').length >= 2 && !/^SEM INFORMA/.test(a[1]) && t.includes(norm(a[1])));
  const pagoWords = /pag|liber|receb|repass/.test(t);
  if (autores.length) {
    const year = await ctx.emendasYear(ano).catch(() => []);
    const mine = year.filter(e => autores.some(a => a[1] === e.autor.nome));
    const emp = mine.reduce((s, e) => s + e.v[0], 0), pago = mine.reduce((s, e) => s + e.pago, 0);
    const base = `Em ${ano}, ${autores.map(a => a[1]).join(', ')} aparece(m) como autor(es) de ${mine.length} emenda(s): R$ ${fmt(emp / 1e6)} milhões empenhados e R$ ${fmt(pago / 1e6)} milhões pagos.`;
    if (n.money.length) {
      const v = pagoWords ? pago : emp;
      const c = close(v, n.money[0], false);
      return { status: c === 'exato' ? 'verdadeiro' : c === 'aproximado' ? 'parcial' : 'falso', finding: `${base} A alegação fala em R$ ${fmt(n.money[0] / 1e6)} milhões (comparado com o valor ${pagoWords ? 'pago' : 'empenhado'}).`, evidence: ev, link: `emendas.html?anos=${ano}&autor=${encodeURIComponent(autores[0][1])}` };
    }
    return { status: null, finding: base, evidence: ev, link: `emendas.html?anos=${ano}&autor=${encodeURIComponent(autores[0][1])}` };
  }
  const tot = meta.totals[ano];
  const base = `Em ${ano}, as emendas somaram R$ ${fmt(tot.v[0] / 1e9)} bilhões empenhados e R$ ${fmt(tot.pago / 1e9)} bilhões pagos (inclui restos a pagar pagos depois), em ${tot.n} registros.`;
  if (n.money.length) {
    const v = pagoWords ? tot.pago : tot.v[0];
    const c = close(v, n.money[0], false);
    return { status: c === 'exato' ? 'verdadeiro' : c === 'aproximado' ? 'parcial' : 'falso', finding: `${base} A alegação fala em R$ ${fmt(n.money[0] / 1e9)} bilhões.`, evidence: ev, link: `emendas.html?anos=${ano}` };
  }
  return { status: null, finding: base, evidence: ev, link: `emendas.html?anos=${ano}` };
}

// ---------------------------------------------------------------- orquestração
export function splitClaims(text) {
  return String(text).replace(/https?:\/\/\S+/g, ' ').split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(s => s.replace(/[^\p{L}\d]/gu, '').length >= 8);
}

export async function verify(text, ctx) {
  const raw = String(text || '').trim();
  const urls = raw.match(/https?:\/\/\S+/g) || [];
  const claims = splitClaims(raw);
  const results = [];
  for (const sentence of claims) {
    const t = norm(sentence);
    const checks = [];
    if (/emenda/.test(t)) checks.push(await checkEmendas(t, ctx));
    const fnKey = Object.keys(FN_WORDS).find(k => t.includes(k));
    if (fnKey && /gast|despes|investi|aplic|orcamento|verba|corte/.test(t) && !/plano de saude/.test(t)) checks.push(await checkSpending(t, FN_WORDS[fnKey], ctx));
    else if (!/emenda/.test(t)) {
      const topic = TOPICS.find(([re]) => re.test(t));
      if (topic) checks.push(await checkIndicator(sentence, t, topic[1], ctx));
    }
    const sensitive = SENSITIVE.test(t);
    const classified = checks.filter(c => c.status);
    let status = classified.length ? (classified.every(c => c.status === classified[0].status) ? classified[0].status : 'parcial') : (sensitive ? 'inconclusivo' : 'nao-comprovado');
    results.push({ sentence, status, sensitive, checks });
  }

  const statuses = results.map(r => r.status);
  const decided = statuses.filter(s => !['nao-comprovado', 'inconclusivo'].includes(s));
  let overall;
  if (!results.length) overall = 'nao-comprovado';
  else if (!decided.length) overall = statuses.includes('inconclusivo') ? 'inconclusivo' : 'nao-comprovado';
  else if (decided.every(s => s === 'verdadeiro')) overall = decided.length === results.length ? 'verdadeiro' : 'parcial';
  else if (decided.every(s => s === 'falso')) overall = decided.length === results.length ? 'falso' : 'parcial';
  else if (decided.includes('enganoso')) overall = 'enganoso';
  else if (decided.every(s => s === 'desatualizado')) overall = 'desatualizado';
  else overall = 'parcial';

  const limitations = [
    'A verificação é automática e só confere números com as séries oficiais integradas ao portal (IBGE, Banco Central, Tesouro Nacional e CGU). Ironia, contexto e intenção não são avaliados.',
    'Quando não há dado oficial para conferir, a alegação fica como não comprovada ou inconclusiva. Isso não quer dizer que seja falsa.',
  ];
  if (urls.length) limitations.push('Links foram identificados, mas o conteúdo das páginas não é lido: o navegador não permite acessar sites de notícias de outro domínio. Copie e cole o texto da notícia para conferir as afirmações.');
  if (results.some(r => r.sensitive)) limitations.push('Acusações de corrupção, crimes ou irregularidades dependem de processos e decisões oficiais. O portal não consulta processos judiciais nem investigações e não trata suspeita como condenação.');
  if (results.some(r => r.checks.some(c => c.note))) limitations.push('Mudanças durante um mandato não provam que o governo foi a causa: há efeitos defasados, crises externas e decisões de outros Poderes.');

  const where = [
    { label: 'Portal da Transparência (CGU)', url: 'https://portaldatransparencia.gov.br/' },
    { label: 'Tribunal de Contas da União', url: 'https://portal.tcu.gov.br/' },
    { label: 'Controladoria-Geral da União', url: 'https://www.gov.br/cgu/pt-br' },
    { label: 'Portal Nacional de Contratações Públicas', url: 'https://pncp.gov.br/' },
    { label: 'Dados abertos da Câmara dos Deputados', url: 'https://dadosabertos.camara.leg.br/' },
    { label: 'Conselho Nacional de Justiça', url: 'https://www.cnj.jus.br/' },
  ];

  return { overall, label: CLASSES[overall], results, urls, limitations, where: results.some(r => r.sensitive || r.status === 'inconclusivo') ? where : [] };
}

/** Indicadores que o verificador consegue reconhecer (para a página de ajuda). */
export const RECOGNIZED = [...new Set(TOPICS.map(t => indicatorById(t[1])?.short).filter(Boolean)), 'Gastos federais por área', 'Emendas parlamentares'];
export { INDICATORS, FUNCOES };
