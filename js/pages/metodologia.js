import { mountLayout } from '../components/layout.js';
import { METRICS } from '../data/metrics.js';
import { indicatorById } from '../data/catalog.js';
import { html } from '../core/format.js';

mountLayout();

// A lista de métricas é gerada do mesmo código que faz os cálculos: documentação e cálculo não divergem.
document.getElementById('metric-list').innerHTML = `<div class="table-wrap"><table>
  <thead><tr><th>Métrica</th><th>Série oficial</th><th>Como é calculada</th></tr></thead>
  <tbody>${METRICS.map(m => html`<tr><td>${m.label}</td><td><a href="indicador.html?id=${m.series}">${indicatorById(m.series).short}</a></td><td>${m.explain}</td></tr>`).join('')}</tbody>
</table></div>`;
