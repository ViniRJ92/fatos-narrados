/**
 * Carregamento dos dados publicados em data/ (gerados por scripts/update-data.mjs).
 * O site nunca exibe número que não esteja nesses arquivos ou que não venha, ao vivo, de API oficial.
 */
const cache = new Map();

function base() {
  // Permite servir o site em subpasta (ex.: GitHub Pages /nome-do-repositorio/).
  return new URL('../../', import.meta.url).href;
}

async function load(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(base() + path, { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(`Não foi possível carregar ${path} (HTTP ${r.status})`);
      return r.json();
    }).catch(e => { cache.delete(path); throw e; }));
  }
  return cache.get(path);
}

export const loadSeries = id => load(`data/series/${id}.json`);
export const loadManifest = () => load('data/manifest.json');
/** Qualquer arquivo dentro de data/ (ex.: 'emendas/meta.json'). */
export const loadData = path => load(`data/${path}`);

export async function loadMany(ids) {
  const entries = await Promise.all(ids.map(async id => [id, await loadSeries(id).catch(() => null)]));
  return Object.fromEntries(entries);
}
