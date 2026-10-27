import { SOURCE_ORGS } from '../data/catalog.js';
import { fmtPeriod, fmtValue, html, raw } from '../core/format.js';
import { sparkline } from './chart.js';
import { rawUrl } from '../api/official.js';

/** Ponto de 12 meses (ou 4 trimestres / 1 ano) antes do último, para contexto neutro. */
export function yearAgo(points, freq) {
  const last = points.at(-1);
  if (!last) return null;
  let target;
  if (freq === 'A') target = String(+last[0] - 1);
  else { const [y, m] = last[0].split('-'); target = `${+y - 1}-${m}`; }
  return points.find(p => p[0] === target) || null;
}

export function sourceLine(ind) {
  const org = SOURCE_ORGS[ind.org];
  const f = ind.fetch;
  const ref = f.kind === 'bcb' ? `SGS ${f.code}` : f.kind === 'sidra' ? `SIDRA ${f.path.split('/')[2]}` : f.kind === 'sidra-chain' ? `SIDRA ${f.tables.join('/')}` : 'série derivada';
  return `${org.name} · ${ref}`;
}

export function kpiCard(ind, doc) {
  if (!doc) return html`<div class="card kpi"><div class="label">${ind.short}</div><div class="muted">Dado indisponível no momento.</div></div>`;
  const pts = doc.points;
  const last = pts.at(-1);
  const prev = yearAgo(pts, ind.freq);
  const tenYears = pts.filter(p => p[0] >= String(+last[0].slice(0, 4) - 10));
  const unitShort = { '%': '%', '% PIB': '% do PIB', '% a.a.': '% a.a.', 'R$': '', 'US$ mi': 'US$ mi', 'índice': '' }[ind.unit] ?? '';
  const valueTxt = ind.unit === 'R$' ? fmtValue(last[1], ind) : fmtValue(last[1], { decimals: ind.decimals });
  return html`<a class="card kpi" href="indicador.html?id=${ind.id}">
    <span class="label">${ind.short}</span>
    <span class="value">${valueTxt}${raw(unitShort ? `<span class="unit">${unitShort}</span>` : '')}</span>
    <span class="meta">${ind.display === 'acc12' ? 'acumulado em 12 meses · ' : ''}${fmtPeriod(last[0], ind.freq)}</span>
    ${raw(prev ? html`<span class="delta">Um ano antes: ${fmtValue(prev[1], ind)}</span>` : '')}
    ${raw(sparkline(tenYears))}
    <span class="src">Fonte: ${sourceLine(ind)}</span>
  </a>`;
}

export function sourceBox(ind, doc) {
  const org = SOURCE_ORGS[ind.org];
  const q = rawUrl(ind);
  return html`<div class="source-box">
    <dl>
      <dt>Órgão</dt><dd><a href="${org.url}" rel="noopener" target="_blank">${org.full}</a></dd>
      <dt>Série</dt><dd>${sourceLine(ind)}</dd>
      ${raw(q ? html`<dt>Dado bruto</dt><dd><a class="mono" href="${q}" rel="noopener" target="_blank">${q}</a></dd>` : '')}
      ${raw((ind.links || []).filter(l => l !== q).map(l => html`<dt>Consulta</dt><dd><a href="${l}" rel="noopener" target="_blank">${l}</a></dd>`).join(''))}
      <dt>Baixado em</dt><dd>${doc ? new Date(doc.fetchedAt).toLocaleString('pt-BR') : '—'}</dd>
      <dt>Cobertura</dt><dd>${doc ? `${fmtPeriod(doc.points[0][0], ind.freq)} a ${fmtPeriod(doc.points.at(-1)[0], ind.freq)}` : '—'}</dd>
    </dl>
  </div>`;
}

export function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function dataTable(rows, header, { numericCols = [] } = {}) {
  return `<div class="table-wrap"><table><thead><tr>${header.map((h, i) => `<th${numericCols.includes(i) ? ' class="num"' : ''} scope="col">${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${numericCols.includes(i) ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
