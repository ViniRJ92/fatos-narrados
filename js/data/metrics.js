/**
 * Métricas por mandato — aplicadas com o MESMO critério a todos os governos.
 *
 * Métodos:
 *  compound        → variação acumulada composta das variações mensais do mandato
 *  annualized      → idem, convertida em média anual equivalente ((1+acum)^(12/n) − 1)
 *  cagr-annual     → média geométrica das taxas anuais dos anos atribuídos ao mandato
 *  delta           → valor final − valor herdado (em pontos)
 *  pct-change      → variação % entre valor herdado e valor final
 *  end             → valor no último período do mandato
 *  mean-december   → média dos valores de dezembro (séries acumuladas em 12 meses = ano-calendário)
 *  sum             → soma dos valores mensais do mandato
 *
 * "Valor herdado" = última observação ANTERIOR ao primeiro período atribuído ao mandato.
 */
import { GOVERNMENTS, governmentForPeriod } from './governments.js';
import { compound, mean } from './transforms.js';

export const METRICS = [
  { id: 'ipca-acum', group: 'Inflação e custo de vida', label: 'Inflação acumulada no mandato (IPCA)', series: 'ipca-mensal', use: 'points', method: 'compound', unit: '%', decimals: 1,
    explain: 'Variação composta do IPCA em todos os meses do mandato. Depende da duração do mandato — compare também a média anual.' },
  { id: 'ipca-ano', group: 'Inflação e custo de vida', label: 'Inflação média anual (IPCA)', series: 'ipca-mensal', use: 'points', method: 'annualized', unit: '%', decimals: 1,
    explain: 'Inflação acumulada convertida em taxa anual equivalente, para comparar mandatos de durações diferentes.' },
  { id: 'alimentos', group: 'Inflação e custo de vida', label: 'Alimentação no domicílio — média anual', series: 'ipca-alimentacao-domicilio', use: 'monthly', method: 'annualized', unit: '%', decimals: 1,
    explain: 'Subitem do IPCA. Série disponível desde jul/2006.' },
  { id: 'gasolina', group: 'Inflação e custo de vida', label: 'Gasolina — média anual', series: 'ipca-gasolina', use: 'monthly', method: 'annualized', unit: '%', decimals: 1,
    explain: 'Subitem do IPCA. Série disponível desde jul/2006.' },
  { id: 'energia', group: 'Inflação e custo de vida', label: 'Energia elétrica residencial — média anual', series: 'ipca-energia', use: 'monthly', method: 'annualized', unit: '%', decimals: 1,
    explain: 'Subitem do IPCA. Série disponível desde jul/2006.' },
  { id: 'pib', group: 'Atividade e emprego', label: 'Crescimento médio anual do PIB', series: 'pib-anual', use: 'points', method: 'cagr-annual', unit: '%', decimals: 1,
    explain: 'Média geométrica do crescimento real anual. Cada ano é atribuído ao governo no cargo em 31/12 (2016 → Temer).' },
  { id: 'desoc-delta', group: 'Atividade e emprego', label: 'Desemprego: variação no mandato', series: 'desocupacao', use: 'points', method: 'delta', unit: 'p.p.', decimals: 1,
    explain: 'Taxa de desocupação ao fim do mandato menos a taxa herdada. PNAD Contínua existe desde 2012.' },
  { id: 'desoc-fim', group: 'Atividade e emprego', label: 'Desemprego ao fim do mandato', series: 'desocupacao', use: 'points', method: 'end', unit: '%', decimals: 1,
    explain: 'Taxa de desocupação no último trimestre móvel do mandato.' },
  { id: 'renda', group: 'Atividade e emprego', label: 'Renda média real do trabalho: variação', series: 'rendimento-real', use: 'points', method: 'pct-change', unit: '%', decimals: 1,
    explain: 'Variação do rendimento médio real habitual entre o valor herdado e o fim do mandato.' },
  { id: 'divida-bruta', group: 'Contas públicas', label: 'Dívida bruta: variação no mandato', series: 'divida-bruta', use: 'points', method: 'delta', unit: 'p.p. do PIB', decimals: 1,
    explain: 'Dívida bruta do governo geral ao fim menos a herdada, em pontos percentuais do PIB. Série desde dez/2006.' },
  { id: 'divida-liquida', group: 'Contas públicas', label: 'Dívida líquida: variação no mandato', series: 'divida-liquida', use: 'points', method: 'delta', unit: 'p.p. do PIB', decimals: 1,
    explain: 'Dívida líquida do setor público ao fim menos a herdada. Série desde dez/2001.' },
  { id: 'primario', group: 'Contas públicas', label: 'Resultado primário médio por ano', series: 'resultado-primario', use: 'points', method: 'mean-december', unit: '% do PIB', decimals: 2,
    explain: 'Média do resultado primário dos anos-calendário do mandato (valor de dezembro do acumulado em 12 meses). Positivo = superávit.' },
  { id: 'juros', group: 'Contas públicas', label: 'Juros da dívida — média por ano', series: 'juros-nominais', use: 'points', method: 'mean-december', unit: '% do PIB', decimals: 2,
    explain: 'Juros nominais apropriados pelo setor público consolidado, média dos anos-calendário do mandato.' },
  { id: 'selic-fim', group: 'Juros, câmbio e comércio', label: 'Selic ao fim do mandato', series: 'selic', use: 'points', method: 'end', unit: '% a.a.', decimals: 2,
    explain: 'Meta Selic vigente no último mês do mandato. Meta existe desde mar/1999.' },
  { id: 'dolar', group: 'Juros, câmbio e comércio', label: 'Dólar: variação no mandato', series: 'dolar', use: 'points', method: 'pct-change', unit: '%', decimals: 1,
    explain: 'Variação da média mensal do dólar entre o mês anterior à posse e o último mês do mandato (valores nominais).' },
  { id: 'saldo', group: 'Juros, câmbio e comércio', label: 'Saldo comercial acumulado', series: 'saldo-comercial', use: 'points', method: 'sum', unit: 'US$ bi', decimals: 1, scale: 1 / 1000,
    explain: 'Soma dos saldos mensais da balança comercial (Balanço de Pagamentos) no mandato.' },
];

/** Governos exibidos na comparação (séries consistentes começam em 1995). */
export const COMPARED = GOVERNMENTS.filter(g => g.start >= '1995-01-01');

/**
 * Calcula uma métrica para um governo.
 * @returns {{value:number|null, start?:[string,number], end?:[string,number], n:number, partial:boolean, ongoing:boolean, reason?:string, periods:string[]}}
 */
export function computeMetric(metric, gov, points) {
  const ongoing = gov.end === null;
  if (!points?.length) return { value: null, n: 0, partial: false, ongoing, reason: 'série indisponível', periods: [] };
  const own = points.filter(([p]) => governmentForPeriod(p)?.id === gov.id && points.length);
  const periods = own.map(p => p[0]);
  if (!own.length) return { value: null, n: 0, partial: false, ongoing, reason: 'sem dados no período do mandato', periods };

  const firstIdx = points.findIndex(p => p[0] === own[0][0]);
  const inherited = firstIdx > 0 ? points[firstIdx - 1] : null;
  const seriesStartsLate = firstIdx === 0 && points[0][0] > gov.start.slice(0, 7);
  const scale = metric.scale ?? 1;
  const out = { n: own.length, ongoing, partial: false, periods, end: own.at(-1) };

  // Cobertura parcial: a série começa depois da posse.
  const expectedStart = gov.start.slice(0, 7);
  if (own[0][0].length === 7 && own[0][0] > nextMonthOf(expectedStart)) out.partial = true;

  switch (metric.method) {
    case 'compound':
    case 'annualized': {
      const acc = compound(own.map(p => p[1]));
      out.value = metric.method === 'compound' ? acc : ((1 + acc / 100) ** (12 / own.length) - 1) * 100;
      out.start = own[0];
      break;
    }
    case 'cagr-annual': {
      const f = own.reduce((s, [, v]) => s * (1 + v / 100), 1);
      out.value = (f ** (1 / own.length) - 1) * 100;
      out.start = own[0];
      break;
    }
    case 'delta':
    case 'pct-change': {
      // Sem valor herdado, só se usa o primeiro dado disponível se a série cobrir ao menos 12 meses do mandato.
      const base = inherited || (seriesStartsLate && own.length >= 12 ? own[0] : null);
      if (!base) return { ...out, value: null, reason: 'a série oficial começa no fim do mandato ou depois dele' };
      if (!inherited) out.partial = true;
      out.start = base;
      const a = base[1], b = own.at(-1)[1];
      out.value = metric.method === 'delta' ? b - a : ((b / a) - 1) * 100;
      break;
    }
    case 'end':
      out.value = own.at(-1)[1];
      break;
    case 'mean-december': {
      const dec = own.filter(([p]) => p.endsWith('-12'));
      if (!dec.length) return { ...out, value: null, reason: 'nenhum ano-calendário completo' };
      out.value = mean(dec.map(p => p[1]));
      out.n = dec.length;
      out.periods = dec.map(p => p[0]);
      out.start = dec[0]; out.end = dec.at(-1);
      break;
    }
    case 'sum':
      out.value = own.reduce((s, [, v]) => s + v, 0) * scale;
      out.start = own[0];
      break;
    default:
      throw new Error(`Método desconhecido: ${metric.method}`);
  }
  return out;
}

function nextMonthOf(p) {
  let [y, m] = p.split('-').map(Number);
  m++; if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function seriesPoints(doc, use) {
  if (!doc) return null;
  return use === 'monthly' ? doc.monthly || doc.points : doc.points;
}
