/**
 * Transformações puras sobre séries. Pontos são pares [periodo, valor]:
 *   mensal/trimestral → "YYYY-MM" (trimestre = mês final), anual → "YYYY".
 * Sem dependências de DOM: usado pelo site, pelo script de atualização e pelos testes.
 */

/** Compõe variações percentuais: [0.5, 0.3] → 0.8015 (%). */
export function compound(pcts) {
  let f = 1;
  for (const p of pcts) f *= 1 + p / 100;
  return (f - 1) * 100;
}

/** Variação acumulada em 12 meses a partir de variações mensais (exige 12 meses consecutivos). */
export function accumulate12(monthly) {
  const out = [];
  for (let i = 11; i < monthly.length; i++) {
    const win = monthly.slice(i - 11, i + 1);
    if (!isConsecutive(win.map(p => p[0]))) continue;
    if (win.some(p => p[1] == null)) continue;
    out.push([monthly[i][0], round(compound(win.map(p => p[1])), 4)]);
  }
  return out;
}

export function nextMonth(period) {
  let [y, m] = period.split('-').map(Number);
  m++; if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function prevMonth(period) {
  let [y, m] = period.split('-').map(Number);
  m--; if (m < 1) { m = 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function isConsecutive(periods) {
  for (let i = 1; i < periods.length; i++) if (nextMonth(periods[i - 1]) !== periods[i]) return false;
  return true;
}

/** Converte observações diárias [["YYYY-MM-DD", v]] em mensais pela média ou último valor. */
export function dailyToMonthly(daily, how = 'mean') {
  const groups = new Map();
  for (const [d, v] of daily) {
    if (v == null) continue;
    const k = d.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, vs]) => [
    k, round(how === 'last' ? vs[vs.length - 1] : vs.reduce((s, x) => s + x, 0) / vs.length, 4),
  ]);
}

/** Série trimestral "YYYY-MM" → anual "YYYY" usando o 4º trimestre (mês 12). */
export function q4ToAnnual(points) {
  return points.filter(([p]) => p.endsWith('-12')).map(([p, v]) => [p.slice(0, 4), v]);
}

export const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export function valueAt(points, period) {
  const hit = points.find(p => p[0] === period);
  return hit ? hit[1] : null;
}

/** Último ponto com período <= period (útil para pegar o valor "na posse"). */
export function lastAtOrBefore(points, period) {
  let best = null;
  for (const p of points) { if (p[0] <= period && p[1] != null) best = p; else if (p[0] > period) break; }
  return best;
}

export function filterRange(points, from, to) {
  return points.filter(([p]) => (!from || p >= from) && (!to || p <= to));
}

export function mean(xs) {
  const v = xs.filter(x => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export const sum = xs => xs.reduce((s, x) => s + (x ?? 0), 0);

/** Índice encadeado (base 100 no primeiro mês) a partir de variações mensais. */
export function chainIndex(monthly, base = 100) {
  let level = base;
  return monthly.map(([p, v]) => { level *= 1 + v / 100; return [p, round(level, 6)]; });
}

/** Média anual de um índice mensal: {YYYY: média}. Usada para deflacionar valores anuais. */
export function annualMeanIndex(monthly) {
  const idx = chainIndex(monthly);
  const byYear = {};
  for (const [p, v] of idx) (byYear[p.slice(0, 4)] ||= []).push(v);
  return Object.fromEntries(Object.entries(byYear).filter(([, vs]) => vs.length === 12).map(([y, vs]) => [y, mean(vs)]));
}

/** Gera CSV (separador ";" e vírgula decimal, padrão brasileiro de planilhas). */
export function toCSV(rows, header) {
  const esc = s => { const t = String(s ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const fmt = v => (typeof v === 'number' ? String(v).replace('.', ',') : v);
  return [header, ...rows].map(r => r.map(c => esc(fmt(c))).join(';')).join('\n');
}
