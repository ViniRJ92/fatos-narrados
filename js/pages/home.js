import { mountLayout } from '../components/layout.js';

mountLayout();
const $ = id => document.getElementById(id);
const q = $('q');

// O texto vai no fragmento (#) da URL: não é enviado a nenhum servidor e permite compartilhar o resultado.
function go(text) {
  const t = text.trim();
  if (!t) { q.focus(); return; }
  location.href = `resultado.html#q=${encodeURIComponent(t)}`;
}

function grow() { q.style.height = 'auto'; q.style.height = `${Math.min(q.scrollHeight, 220)}px`; }
q.addEventListener('input', grow);
q.addEventListener('keydown', e => {
  // Enter verifica; Shift+Enter quebra a linha (útil para colar notícias).
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(q.value); }
});
$('busca').addEventListener('submit', e => { e.preventDefault(); go(q.value); });
document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => go(c.textContent)));

$('arquivo').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  if (/\.txt$/i.test(f.name) || f.type === 'text/plain') {
    if (f.size > 200000) { $('arquivo-msg').textContent = 'Arquivo grande demais. Cole só o trecho que quer verificar.'; return; }
    q.value = (await f.text()).trim();
    grow();
    $('arquivo-msg').textContent = `Texto de "${f.name}" carregado. Revise e clique em Verificar informação.`;
  } else {
    $('arquivo-msg').textContent = 'Por enquanto só arquivos .txt são lidos. Para PDF ou Word, copie o texto e cole na caixa de pesquisa.';
  }
  e.target.value = '';
});

q.focus();
