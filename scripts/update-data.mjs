#!/usr/bin/env node
/**
 * Atualiza os dados do portal a partir das APIs oficiais.
 *
 *   node scripts/update-data.mjs            → atualiza tudo
 *   node scripts/update-data.mjs ipca-12m   → atualiza só os indicadores informados
 *
 * Gera data/series/<id>.json e data/manifest.json. Se uma fonte falhar, o arquivo
 * anterior é mantido e a falha fica registrada no manifesto (nunca se inventa dado).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICATORS, SPENDING, FUNCOES, SOURCE_ORGS } from '../js/data/catalog.js';
import { fetchIndicator, fetchSpendingYear, rawUrl } from '../js/api/official.js';
import { accumulate12, annualMeanIndex, round } from '../js/data/transforms.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'series');
const MANIFEST = join(ROOT, 'data', 'manifest.json');

const only = process.argv.slice(2);
const now = new Date().toISOString();
await mkdir(OUT, { recursive: true });

const manifest = await readFile(MANIFEST, 'utf8').then(JSON.parse).catch(() => ({ series: {} }));
const cache = new Map();

async function getById(id) {
  if (cache.has(id)) return cache.get(id);
  const saved = await readFile(join(OUT, `${id}.json`), 'utf8').then(JSON.parse).catch(() => null);
  return saved ? saved.monthly || saved.points : [];
}

async function updateIndicator(ind) {
  const t0 = Date.now();
  let pts = await fetchIndicator(ind, getById);
  if (!pts.length) throw new Error('fonte retornou série vazia');
  cache.set(ind.id, pts);
  const doc = {
    id: ind.id, title: ind.title, unit: ind.unit, freq: ind.freq,
    source: SOURCE_ORGS[ind.org].full, query: rawUrl(ind), fetchedAt: now,
    points: pts,
  };
  if (ind.display === 'acc12') { doc.monthly = pts; doc.points = accumulate12(pts); doc.pointsUnit = '% em 12 meses'; }
  await writeFile(join(OUT, `${ind.id}.json`), JSON.stringify(doc));
  const last = doc.points.at(-1);
  manifest.series[ind.id] = { ok: true, fetchedAt: now, first: doc.points[0]?.[0], last: last?.[0], lastValue: last?.[1], count: doc.points.length };
  console.log(`✔ ${ind.id.padEnd(28)} ${String(doc.points.length).padStart(5)} pts  ${doc.points[0]?.[0]} → ${last?.[0]} = ${last?.[1]}  (${Date.now() - t0} ms)`);
}

async function updateSpending() {
  const ipca = cache.get('ipca-mensal') || await getById('ipca-mensal');
  const deflator = annualMeanIndex(ipca);
  const years = [];
  const thisYear = new Date().getUTCFullYear();
  for (let y = SPENDING.firstYear; y <= thisYear; y++) {
    try {
      const r = await fetchSpendingYear(y, FUNCOES);
      if (r) { years.push(r); console.log(`  · RREO ${y}: liquidado R$ ${(r.total / 1e9).toFixed(1)} bi (refinanciamento da dívida: R$ ${(r.refin / 1e9).toFixed(1)} bi)`); }
      else console.log(`  · RREO ${y}: 6º bimestre ainda não publicado`);
    } catch (e) { console.warn(`  ! RREO ${y}: ${e.message}`); }
  }
  if (!years.length) throw new Error('nenhum ano obtido do SICONFI');
  const doc = {
    id: SPENDING.id, title: SPENDING.title, source: SOURCE_ORGS.tesouro.full, fetchedAt: now,
    unit: 'R$', query: years.at(-1).url, column: years.at(-1).column,
    years: years.map(y => y.year), total: years.map(y => y.total), refin: years.map(y => y.refin),
    byFn: Object.fromEntries(FUNCOES.map(fn => [fn, years.map(y => y.byFn[fn])])),
    // Fator para levar o valor do ano a preços médios do último ano com IPCA completo.
    deflatorBase: null, deflator: {},
  };
  const fullYears = Object.keys(deflator).map(Number);
  const baseYear = Math.max(...fullYears.filter(y => y <= doc.years.at(-1)));
  doc.deflatorBase = baseYear;
  for (const y of doc.years) doc.deflator[y] = deflator[y] ? round(deflator[baseYear] / deflator[y], 6) : null;
  await writeFile(join(OUT, `${SPENDING.id}.json`), JSON.stringify(doc));
  manifest.series[SPENDING.id] = { ok: true, fetchedAt: now, first: String(doc.years[0]), last: String(doc.years.at(-1)), count: doc.years.length };
  console.log(`✔ ${SPENDING.id.padEnd(28)} ${doc.years.length} anos`);
}

const failures = [];
// ipca-mensal primeiro: é usado como deflator dos gastos.
const ordered = [...INDICATORS].sort((a, b) => (a.fetch.kind === 'derived') - (b.fetch.kind === 'derived'));
for (const ind of ordered) {
  if (only.length && !only.includes(ind.id)) continue;
  try { await updateIndicator(ind); }
  catch (e) {
    failures.push(ind.id);
    manifest.series[ind.id] = { ...(manifest.series[ind.id] || {}), ok: false, error: e.message, failedAt: now };
    console.error(`✘ ${ind.id}: ${e.message}`);
  }
}
if (!only.length || only.includes(SPENDING.id)) {
  try { await updateSpending(); }
  catch (e) { failures.push(SPENDING.id); manifest.series[SPENDING.id] = { ...(manifest.series[SPENDING.id] || {}), ok: false, error: e.message, failedAt: now }; console.error(`✘ ${SPENDING.id}: ${e.message}`); }
}

manifest.updatedAt = now;
await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(failures.length ? `\nConcluído com ${failures.length} falha(s): ${failures.join(', ')}` : '\nConcluído sem falhas.');
process.exitCode = failures.length ? 1 : 0;
