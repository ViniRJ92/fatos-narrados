import { mountLayout } from '../components/layout.js';
import { loadSeries, loadData } from '../core/data.js';
import { verify, CLASSES } from '../verify/engine.js';
import { expandYear } from '../data/emendas-model.js';
import { fmtDateTime, html, raw } from '../core/format.js';

mountLayout();
const $ = id => document.getElementById(id);

let metaPromise;
const emendasMeta = () => (metaPromise ||= loadData('emendas/meta.json'));
const ctx = {
  series: id => loadSeries(id),
  spending: () => loadSeries('despesas-funcao'),
  emendasMeta,
  emendasYear: async ano => expandYear(await loadData(`emendas/ano-${ano}.json`), (await emendasMeta()).autores),
  today: new Date(),
};

const SECTIONS = [
  ['verdadeiro', 'O que foi confirmado'],
  ['falso', 'O que foi desmentido'],
  ['parcial', 'O que está parcialmente correto'],
  ['enganoso', 'O que está fora de contexto'],
  ['desatualizado', 'O que está desatualizado'],
  ['nao-comprovado', 'O que ainda não foi comprovado'],
  ['inconclusivo', 'O que não dá para concluir com dados oficiais'],
];

function readHash() {
  const m = location.hash.match(/q=([^&]*)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function run() {
  const text = readHash();
  $('q').value = text;
  if (!text.trim()) { $('app').innerHTML = '<p class="muted">Digite ou cole o que você quer verificar.</p>'; return; }
  $('app').innerHTML = '<p class="loading">Consultando os dados oficiais…</p>';
  const r = await verify(text, ctx);

  // agrupa os achados por classificação
  const items = r.results.flatMap(res => {
    const classified = res.checks.filter(c => c.status);
    if (!classified.length) return [{ status: res.status, sentence: res.sentence, finding: res.checks[0]?.finding || (res.sensitive
      ? 'A frase trata de uma acusação ou de um fato que não aparece nas bases oficiais integradas ao portal.'
      : 'O portal não encontrou um dado oficial integrado que permita conferir esta frase.'), link: res.checks[0]?.link }];
    return classified.map(c => ({ status: c.status, sentence: res.sentence, finding: c.finding, note: c.note, link: c.link }));
  });
  const evidence = [...new Map(r.results.flatMap(x => x.checks.flatMap(c => c.evidence || [])).filter(e => e.url).map(e => [e.url, e])).values()];
  const timeline = r.results.flatMap(x => x.checks.flatMap(c => c.timeline || [])).filter((p, i, a) => a.findIndex(q => q[0] === p[0] && q[1] === p[1]) === i)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const counts = Object.fromEntries(SECTIONS.map(([k]) => [k, items.filter(i => i.status === k).length]));
  const resumo = r.results.length
    ? `Foram analisadas ${r.results.length} afirmação(ões). ${SECTIONS.filter(([k]) => counts[k]).map(([k, l]) => `${counts[k]} ${CLASSES[k].toLowerCase()}`).join(', ')}.`
    : 'Não foi possível identificar uma afirmação verificável no texto.';
  const perLabel = p => (/^\d{4}-\d{2}$/.test(p) ? `${p.slice(5)}/${p.slice(0, 4)}` : p);

  $('app').innerHTML = html`
    <section>
      <p class="kicker muted" style="text-transform:uppercase;letter-spacing:.08em;font-size:.78rem;margin:0 0 .4rem">Classificação</p>
      <span class="verdict ${r.overall}">${r.label}</span>
      <h1 style="font-size:clamp(1.4rem,3.2vw,2rem);margin:1rem 0 .4rem">Resumo da investigação</h1>
      <p class="lead">${resumo}</p>
    </section>
    ${raw(SECTIONS.filter(([k]) => counts[k]).map(([k, label]) => html`<section><h2>${label}</h2><ul class="claim-list">${raw(items.filter(i => i.status === k).map(i => html`<li>
      <p style="margin:0 0 .3rem"><strong>"${i.sentence}"</strong></p>
      <p style="margin:0">${i.finding}</p>
      ${raw(i.note ? html`<p class="muted" style="margin:.3rem 0 0;font-size:.86rem">${i.note}</p>` : '')}
      ${raw(i.link ? html`<p style="margin:.3rem 0 0;font-size:.88rem"><a href="${i.link}">Ver os registros no portal →</a></p>` : '')}
    </li>`).join(''))}</ul></section>`).join(''))}
    <section><h2>Documentos oficiais consultados</h2>
      ${raw(evidence.length ? html`<ul>${raw(evidence.map(e => html`<li>${e.label}${e.fetchedAt ? `, dados baixados em ${fmtDateTime(e.fetchedAt)}` : ''}. <a class="mono" href="${e.url}" target="_blank" rel="noopener" style="overflow-wrap:anywhere">${e.url}</a></li>`).join(''))}</ul>`
        : '<p class="muted">Nenhuma base oficial integrada se aplica a este texto.</p>')}
      ${raw(r.where.length ? html`<p>Onde procurar informações oficiais sobre o assunto:</p><ul>${raw(r.where.map(w => html`<li><a href="${w.url}" target="_blank" rel="noopener">${w.label}</a></li>`).join(''))}</ul>` : '')}
    </section>
    ${raw(timeline.length ? html`<section><h2>Cronologia dos dados</h2><ul>${raw(timeline.map(([p, t]) => html`<li><strong>${perLabel(p)}</strong>: ${t}</li>`).join(''))}</ul></section>` : '')}
    ${raw(r.urls.length ? html`<section><h2>Links informados</h2><ul>${raw(r.urls.map(u => html`<li class="mono" style="overflow-wrap:anywhere">${u}</li>`).join(''))}</ul></section>` : '')}
    <section><h2>Limitações desta verificação</h2><ul>${raw(r.limitations.map(l => html`<li>${l}</li>`).join(''))}</ul>
      <p><a href="metodologia.html#verificador">Como o verificador funciona</a> · <a href="index.html">Fazer outra pesquisa</a></p></section>`;
}

$('busca').addEventListener('submit', e => {
  e.preventDefault();
  location.hash = `q=${encodeURIComponent($('q').value.trim())}`;
});
$('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('busca').requestSubmit(); } });
window.addEventListener('hashchange', run);
run();
