import { mountLayout } from '../components/layout.js';
import { INDICATORS, TOPICS } from '../data/catalog.js';
import { loadMany, loadManifest } from '../core/data.js';
import { kpiCard } from '../components/widgets.js';
import { fmtDateTime, html, escapeHtml } from '../core/format.js';
import { SOURCES } from '../data/sources.js';

mountLayout();

const featured = INDICATORS.filter(i => i.featured);
const kpis = document.getElementById('kpis');
kpis.innerHTML = featured.map(i => `<div class="card kpi loading">${escapeHtml(i.short)}</div>`).join('');
const docs = await loadMany(featured.map(i => i.id));
kpis.innerHTML = featured.map(i => kpiCard(i, docs[i.id])).join('');

loadManifest().then(m => {
  const failed = Object.entries(m.series).filter(([, s]) => !s.ok);
  document.getElementById('freshness').innerHTML = failed.length
    ? html`<p class="notice">Dados atualizados em ${fmtDateTime(m.updatedAt)}. ${failed.length} série(s) não puderam ser atualizadas na última execução e exibem a versão anterior: ${failed.map(f => f[0]).join(', ')}.</p>`
    : html`<p class="notice neutral">Dados baixados das fontes oficiais em ${fmtDateTime(m.updatedAt)}. Cada número leva à consulta original.</p>`;
}).catch(() => {});

// ---------- Temas ----------
document.getElementById('topics').innerHTML = Object.entries(TOPICS).map(([id, t]) => {
  const n = INDICATORS.filter(i => i.topic === id).length;
  return html`<a class="card topic-card" href="tema.html?t=${id}"><h3>${t.title}</h3><p class="muted">${t.desc}</p><span class="count">${n} indicador${n > 1 ? 'es' : ''}</span></a>`;
}).join('') + html`<a class="card topic-card" href="gastos.html"><h3>Gastos por área</h3><p class="muted">Quanto o Governo Federal gastou em saúde, educação, previdência, segurança e outras 24 funções.</p><span class="count">SICONFI · desde 2015</span></a>`;

// ---------- Cobertura ----------
const byStatus = s => SOURCES.filter(x => x.status === s).length;
document.getElementById('coverage').innerHTML = html`
  <div class="stats">
    <div><dt>Indicadores integrados</dt><dd>${INDICATORS.length + 1}</dd></div>
    <div><dt>Fontes integradas</dt><dd>${byStatus('integrada')}</dd></div>
    <div><dt>Consultas ao vivo</dt><dd>${byStatus('ao-vivo')}</dd></div>
    <div><dt>Fontes catalogadas</dt><dd>${byStatus('catalogada') + byStatus('requer-chave')}</dd></div>
  </div>`;

// ---------- Busca ----------
const items = [
  ...INDICATORS.map(i => ({ label: i.title, sub: TOPICS[i.topic].title, href: `indicador.html?id=${i.id}`, text: `${i.title} ${i.short} ${i.description}` })),
  ...Object.entries(TOPICS).map(([id, t]) => ({ label: t.title, sub: 'Tema', href: `tema.html?t=${id}`, text: `${t.title} ${t.desc}` })),
  { label: 'Gastos do Governo Federal por função', sub: 'Gastos públicos', href: 'gastos.html', text: 'gastos despesas saúde educação previdência segurança orçamento' },
  { label: 'Comparar governos', sub: 'Governos', href: 'governos.html', text: 'governos mandatos presidentes comparar lula fhc dilma temer bolsonaro' },
  { label: 'Licitações e contratos (PNCP)', sub: 'Fiscalização', href: 'fiscalizacao.html', text: 'licitações contratos compras pregão dispensa pncp' },
  { label: 'Cota parlamentar dos deputados', sub: 'Fiscalização', href: 'fiscalizacao.html#camara', text: 'deputados cota parlamentar despesas câmara' },
  ...SOURCES.map(s => ({ label: s.name, sub: `Fonte · ${s.org}`, href: 'fontes.html', text: `${s.name} ${s.org} ${s.covers.join(' ')}` })),
];
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const input = document.getElementById('q');
const list = document.getElementById('q-results');
let active = -1;
function renderResults() {
  const q = norm(input.value.trim());
  if (!q) { list.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
  const terms = q.split(/\s+/);
  const hits = items.filter(it => terms.every(t => norm(it.text).includes(t))).slice(0, 10);
  active = -1;
  list.innerHTML = hits.length
    ? hits.map((h, i) => html`<li role="option" id="opt-${i}"><a href="${h.href}">${h.label}<small>${h.sub}</small></a></li>`).join('')
    : '<li class="muted" style="padding:.6rem">Nada encontrado. Veja o <a href="fontes.html">catálogo de fontes</a>.</li>';
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}
input.addEventListener('input', renderResults);
input.addEventListener('keydown', e => {
  const links = [...list.querySelectorAll('a')];
  if (!links.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
    links.forEach((a, i) => a.setAttribute('aria-selected', String(i === active)));
    input.setAttribute('aria-activedescendant', `opt-${active}`);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    location.href = links[Math.max(active, 0)].href;
  } else if (e.key === 'Escape') { list.hidden = true; }
});
document.addEventListener('click', e => { if (!e.target.closest('.search')) list.hidden = true; });
