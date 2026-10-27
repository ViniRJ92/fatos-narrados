import { loadManifest } from '../core/data.js';
import { fmtDateTime } from '../core/format.js';

const NAV = [
  ['index.html', 'Início'],
  ['indicador.html', 'Indicadores'],
  ['governos.html', 'Governos'],
  ['gastos.html', 'Gastos públicos'],
  ['fiscalizacao.html', 'Fiscalização'],
  ['fontes.html', 'Fontes'],
  ['metodologia.html', 'Metodologia'],
];

const THEME_KEY = 'fn-theme';
function storedTheme() { try { return localStorage.getItem(THEME_KEY); } catch { return null; } }
function storeTheme(v) { try { localStorage.setItem(THEME_KEY, v); } catch { /* armazenamento indisponível */ } }

function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
applyTheme(storedTheme());

function currentTheme() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function mountLayout() {
  const page = location.pathname.split('/').pop() || 'index.html';
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <a class="skip" href="#conteudo">Pular para o conteúdo</a>
    <div class="wrap">
      <a class="brand" href="index.html" aria-label="Fatos Narrados — página inicial">Fatos Narrados</a>
      <button class="icon-btn menu-btn" aria-expanded="false" aria-controls="nav-principal">Menu</button>
      <nav class="nav" id="nav-principal" aria-label="Principal">
        ${NAV.map(([href, label]) => `<a href="${href}"${href === page ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      </nav>
      <button class="icon-btn theme-btn" type="button" aria-label="Alternar tema claro/escuro" title="Alternar tema">◐</button>
    </div>`;
  document.body.prepend(header);

  const nav = header.querySelector('.nav');
  const menuBtn = header.querySelector('.menu-btn');
  menuBtn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  header.querySelector('.theme-btn').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next); storeTheme(next);
    document.dispatchEvent(new CustomEvent('themechange'));
  });

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="wrap cols">
      <div>
        <h3>Fatos Narrados</h3>
        <p>Portal independente de transparência pública. Não exige que você acredite em uma narrativa: mostra os números e a fonte oficial de cada um, para que você mesmo verifique.</p>
      </div>
      <div>
        <h3>Princípios</h3>
        <ul>
          <li>Somente fontes oficiais e primárias</li>
          <li>Mesmos critérios para todos os governos</li>
          <li>Link para o dado bruto em cada número</li>
        </ul>
      </div>
      <div>
        <h3>Dados</h3>
        <ul>
          <li><a href="fontes.html">Catálogo de fontes</a></li>
          <li><a href="metodologia.html">Metodologia e limitações</a></li>
          <li id="footer-updated" class="muted">Atualização: verificando…</li>
        </ul>
      </div>
    </div>`;
  document.body.append(footer);

  loadManifest().then(m => {
    const el = document.getElementById('footer-updated');
    if (el) el.textContent = `Dados atualizados em ${fmtDateTime(m.updatedAt)}`;
  }).catch(() => {
    const el = document.getElementById('footer-updated');
    if (el) el.textContent = 'Manifesto de dados indisponível';
  });
}
