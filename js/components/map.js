/**
 * Mapa coroplético das UFs em SVG (malha oficial do IBGE, data/geo/uf.json).
 * Cor sequencial em um só tom de azul; a UF é a menor unidade desenhada, então
 * nenhum ponto sugere o endereço de uma obra.
 */
import { escapeHtml } from '../core/format.js';

const SIGLAS = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };
// Rampa sequencial azul (claro → escuro), validada para os dois temas.
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

function rings(geom) {
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
  return [];
}

/**
 * @param {HTMLElement} el
 * @param {object} geo GeoJSON das UFs
 * @param {Record<string, number>} values valor por sigla
 * @param {{format:(v:number)=>string, selected?:string, onSelect?:(uf:string|null)=>void, label:string}} opts
 */
export function ufMap(el, geo, values, opts) {
  const k = Math.cos((-15 * Math.PI) / 180);
  const all = geo.features.flatMap(f => rings(f.geometry).flat());
  const xs = all.map(c => c[0] * k), ys = all.map(c => -c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 600, H = Math.round((W * (maxY - minY)) / (maxX - minX));
  const sx = x => ((x * k - minX) / (maxX - minX)) * W, sy = y => ((-y - minY) / (maxY - minY)) * H;
  const vals = Object.values(values).filter(v => v > 0);
  const max = Math.max(...vals, 1);
  const color = v => (v > 0 ? RAMP[Math.min(RAMP.length - 1, Math.floor(Math.sqrt(v / max) * RAMP.length))] : 'var(--surface-2)');

  const paths = geo.features.map(f => {
    const uf = SIGLAS[f.properties.codarea];
    const d = rings(f.geometry).map(r => 'M' + r.map(c => `${sx(c[0]).toFixed(1)},${sy(c[1]).toFixed(1)}`).join('L') + 'Z').join('');
    const v = values[uf] || 0;
    const sel = opts.selected === uf;
    return `<path d="${d}" data-uf="${uf}" fill="${color(v)}" stroke="${sel ? 'var(--ink)' : 'var(--surface)'}" stroke-width="${sel ? 2.5 : 0.8}"
      tabindex="0" role="button" aria-pressed="${sel}" aria-label="${escapeHtml(`${uf}: ${opts.format(v)}`)}"><title>${escapeHtml(`${uf}: ${opts.format(v)}`)}</title></path>`;
  }).join('');
  const legend = RAMP.map((c, i) => `<span style="display:inline-block;width:22px;height:10px;background:${c}"></span>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="${escapeHtml(opts.label)}" style="width:100%;max-width:560px;display:block;margin:0 auto;cursor:pointer">${paths}</svg>
    <div class="legend" style="justify-content:center;align-items:center;gap:.4rem"><span>menor</span><span style="display:inline-flex">${legend}</span><span>maior (até ${escapeHtml(opts.format(max))})</span><span class="muted">· cinza: sem valor</span></div>`;
  const pick = t => { const uf = t?.dataset?.uf; if (uf) opts.onSelect?.(opts.selected === uf ? null : uf); };
  el.querySelector('svg').addEventListener('click', e => pick(e.target.closest('path')));
  el.querySelector('svg').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e.target.closest('path')); } });
}
