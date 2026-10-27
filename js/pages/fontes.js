import { mountLayout } from '../components/layout.js';
import { SOURCES, STATUS_LABEL, VERIFIED_ON } from '../data/sources.js';
import { INDICATORS, SOURCE_ORGS } from '../data/catalog.js';
import { loadManifest } from '../core/data.js';
import { rawUrl } from '../api/official.js';
import { sourceLine } from '../components/widgets.js';
import { fmtPeriod, fmtDateTime, fmtIsoDate, html, raw } from '../core/format.js';

mountLayout();
const $ = id => document.getElementById(id);
$('verified').textContent = fmtIsoDate(VERIFIED_ON);

let filter = '';
function renderSources() {
  const list = SOURCES.filter(s => !filter || s.status === filter);
  $('sources').innerHTML = list.map(s => html`<article class="card">
    <div style="display:flex;justify-content:space-between;gap:.5rem;align-items:start;flex-wrap:wrap">
      <div><small class="muted">${s.org}</small><h3 style="margin:.1rem 0 .4rem">${s.name}</h3></div>
      <span class="badge ${s.status}">${STATUS_LABEL[s.status]}</span>
    </div>
    <p style="font-size:.9rem;margin-bottom:.4rem"><strong>Cobre:</strong> ${s.covers.join(' · ')}</p>
    <p style="font-size:.86rem;margin-bottom:.4rem" class="muted"><strong>Formatos:</strong> ${s.formats.join(', ')}</p>
    <p style="font-size:.86rem" class="muted"><strong>Limitações:</strong> ${s.limits}</p>
    <p style="font-size:.86rem;margin:0;overflow-wrap:anywhere"><a href="${s.url}" target="_blank" rel="noopener">Site oficial</a>${raw(s.catalog ? html` · <a href="${s.catalog}" target="_blank" rel="noopener">Documentação/catálogo</a>` : '')}${raw(s.api ? html`<br><span class="mono muted">${s.api}</span>` : '')}</p>
  </article>`).join('');
}
$('filter').innerHTML = '<option value="">Todas</option>' + Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('filter').addEventListener('change', e => { filter = e.target.value; renderSources(); });
renderSources();

const manifest = await loadManifest().catch(() => ({ series: {} }));
$('series').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Indicador</th><th>Fonte</th><th>Cobertura</th><th>Último dado</th><th>Atualizado</th><th>Dado bruto</th></tr></thead><tbody>${
  INDICATORS.map(i => {
    const m = manifest.series[i.id] || {};
    return html`<tr><td><a href="indicador.html?id=${i.id}">${i.title}</a></td><td>${sourceLine(i)}</td>
      <td>${m.first ? `${fmtPeriod(m.first, i.freq)} – ${fmtPeriod(m.last, i.freq)}` : '—'}</td>
      <td>${fmtPeriod(m.last, i.freq)}</td>
      <td>${raw(m.ok === false ? html`<span class="error">falhou: ${m.error}</span>` : fmtDateTime(m.fetchedAt))}</td>
      <td>${raw(rawUrl(i) ? html`<a href="${rawUrl(i)}" target="_blank" rel="noopener">API</a>` : '—')}</td></tr>`;
  }).join('')}
  ${html`<tr><td><a href="gastos.html">Despesas da União por função</a></td><td>${SOURCE_ORGS.tesouro.name} · SICONFI RREO</td><td>${manifest.series['despesas-funcao']?.first || '—'} – ${manifest.series['despesas-funcao']?.last || '—'}</td><td>${manifest.series['despesas-funcao']?.last || '—'}</td><td>${fmtDateTime(manifest.series['despesas-funcao']?.fetchedAt)}</td><td><a href="https://apidatalake.tesouro.gov.br/docs/siconfi/" target="_blank" rel="noopener">API</a></td></tr>`}
  </tbody></table></div>`;
