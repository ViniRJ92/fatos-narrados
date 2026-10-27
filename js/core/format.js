const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function fmtNumber(v, decimals = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Valor com unidade do indicador ("4,58%", "R$ 5,09", "82,9% do PIB"). */
export function fmtValue(v, ind, { decimals = ind?.decimals ?? 1, signed = false } = {}) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = (signed && v > 0 ? '+' : '') + fmtNumber(v, decimals);
  switch (ind?.unit) {
    case '%': return `${s}%`;
    case '% PIB': return `${s}% do PIB`;
    case '% a.a.': return `${s}% a.a.`;
    case 'R$': return `R$ ${s}`;
    case 'US$ mi': return `US$ ${s} mi`;
    default: return s;
  }
}

/** Valor curto para eixos. */
export function fmtAxis(v, unit) {
  const abs = Math.abs(v);
  let s;
  if (abs >= 1e12) s = fmtNumber(v / 1e12, 1) + ' tri';
  else if (abs >= 1e9) s = fmtNumber(v / 1e9, abs >= 1e11 ? 0 : 1) + ' bi';
  else if (abs >= 1e6) s = fmtNumber(v / 1e6, 1) + ' mi';
  else if (abs >= 10000) s = fmtNumber(v / 1000, 0) + ' mil';
  else s = fmtNumber(v, abs < 10 && v % 1 !== 0 ? 1 : 0);
  if (unit === '%' || unit === '% PIB' || unit === '% a.a.') return s + '%';
  return s;
}

export function fmtMoneyBig(v) {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `R$ ${fmtNumber(v / 1e12, 2)} tri`;
  if (abs >= 1e9) return `R$ ${fmtNumber(v / 1e9, 1)} bi`;
  if (abs >= 1e6) return `R$ ${fmtNumber(v / 1e6, 1)} mi`;
  return `R$ ${fmtNumber(v, 2)}`;
}

export function fmtPeriod(p, freq) {
  if (!p) return '—';
  if (/^\d{4}$/.test(p)) return p;
  const [y, m] = p.split('-').map(Number);
  if (freq === 'Q') return `${Math.ceil(m / 3)}º tri/${y}`;
  return `${MESES[m - 1]}/${y}`;
}

export function fmtPeriodLong(p, freq) {
  if (!p) return '—';
  if (/^\d{4}$/.test(p)) return p;
  const [y, m] = p.split('-').map(Number);
  if (freq === 'Q') return `${Math.ceil(m / 3)}º trimestre de ${y}`;
  return `${MESES_LONGOS[m - 1]} de ${y}`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export const fmtIsoDate = s => (s ? s.split('-').reverse().join('/') : 'atual');

export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Template literal que escapa interpolações (use raw() para HTML confiável). */
export function html(strings, ...vals) {
  return strings.reduce((out, s, i) => {
    if (i >= vals.length) return out + s;
    const v = vals[i];
    const str = v && v.__raw ? v.value : Array.isArray(v) ? v.map(x => (x && x.__raw ? x.value : escapeHtml(x))).join('') : escapeHtml(v);
    return out + s + str;
  }, '');
}
export const raw = value => ({ __raw: true, value });
