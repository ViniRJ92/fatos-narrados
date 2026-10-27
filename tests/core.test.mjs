import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compound, accumulate12, dailyToMonthly, q4ToAnnual, annualMeanIndex } from '../js/data/transforms.js';
import { governmentForPeriod, referenceDate, GOVERNMENTS } from '../js/data/governments.js';
import { computeMetric, METRICS } from '../js/data/metrics.js';
import { parseSidra, sidraPeriod } from '../js/api/official.js';
import { INDICATORS } from '../js/data/catalog.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const gov = id => GOVERNMENTS.find(g => g.id === id);

test('compound compõe variações percentuais', () => {
  near(compound([10, 10]), 21);
  near(compound([]), 0);
});

test('accumulate12 exige 12 meses consecutivos', () => {
  // jan/2020 a jan/2021, 1% ao mês
  const months = Array.from({ length: 13 }, (_, i) => [`${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, 1]);
  const acc = accumulate12(months);
  assert.equal(acc.length, 2);
  near(acc[0][1], (1.01 ** 12 - 1) * 100, 1e-3);
  // lacuna quebra a janela
  const gap = [...months.slice(0, 5), ...months.slice(6)];
  assert.equal(accumulate12(gap).length, 0);
});

test('dailyToMonthly calcula média e último valor', () => {
  const d = [['2024-01-02', 1], ['2024-01-31', 3], ['2024-02-01', 5]];
  assert.deepEqual(dailyToMonthly(d, 'mean'), [['2024-01', 2], ['2024-02', 5]]);
  assert.deepEqual(dailyToMonthly(d, 'last'), [['2024-01', 3], ['2024-02', 5]]);
});

test('q4ToAnnual usa o 4º trimestre', () => {
  assert.deepEqual(q4ToAnnual([['2020-09', 1], ['2020-12', -3.3], ['2021-12', 4.8]]), [['2020', -3.3], ['2021', 4.8]]);
});

test('annualMeanIndex só considera anos completos', () => {
  const m = Array.from({ length: 18 }, (_, i) => [`${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, 0]);
  assert.deepEqual(Object.keys(annualMeanIndex(m)), ['2020']);
});

test('atribuição de períodos aos governos segue a regra do último dia', () => {
  assert.equal(referenceDate('2016-05'), '2016-05-31');
  assert.equal(governmentForPeriod('2016-04').id, 'dilma2');
  assert.equal(governmentForPeriod('2016-05').id, 'temer');      // Temer assumiu em 12/05/2016
  assert.equal(governmentForPeriod('2016').id, 'temer');         // ano → governo em 31/12
  assert.equal(governmentForPeriod('1992-09').id, 'collor');
  assert.equal(governmentForPeriod('1992-10').id, 'itamar');
  assert.equal(governmentForPeriod('2002-12').id, 'fhc2');
  assert.equal(governmentForPeriod('2003-01').id, 'lula1');
  assert.equal(governmentForPeriod('2030-01').id, 'lula3');      // mandato em curso (end = null)
});

test('mandatos não se sobrepõem nem deixam lacunas desde 1985', () => {
  for (let i = 1; i < GOVERNMENTS.length; i++) {
    const prevEnd = new Date(GOVERNMENTS[i - 1].end + 'T00:00:00Z');
    const start = new Date(GOVERNMENTS[i].start + 'T00:00:00Z');
    assert.equal((start - prevEnd) / 864e5, 1, `${GOVERNMENTS[i - 1].id} → ${GOVERNMENTS[i].id}`);
  }
});

test('métrica compound usa apenas meses do mandato', () => {
  const metric = METRICS.find(m => m.id === 'ipca-acum');
  const pts = [['2002-12', 50], ...Array.from({ length: 48 }, (_, i) => [`${2003 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`, 0.5]), ['2007-01', 50]];
  const r = computeMetric(metric, gov('lula1'), pts);
  near(r.value, (1.005 ** 48 - 1) * 100, 1e-9);
  assert.equal(r.n, 48);
});

test('métrica delta parte do valor herdado', () => {
  const metric = METRICS.find(m => m.id === 'divida-bruta');
  const pts = [['2018-12', 75], ['2019-01', 76], ['2022-12', 72], ['2023-01', 73]];
  const r = computeMetric(metric, gov('bolsonaro'), pts);
  assert.deepEqual(r.start, ['2018-12', 75]);
  near(r.value, -3);
});

test('métrica delta não inventa ponto de partida quando a série começa no fim do mandato', () => {
  const metric = METRICS.find(m => m.id === 'divida-bruta');
  const r = computeMetric(metric, gov('lula1'), [['2006-12', 55.5], ['2007-01', 55]]);
  assert.equal(r.value, null);
});

test('PIB anual usa média geométrica dos anos atribuídos', () => {
  const metric = METRICS.find(m => m.id === 'pib');
  const r = computeMetric(metric, gov('temer'), [['2015', -3.5], ['2016', -3.3], ['2017', 1.3], ['2018', 1.8], ['2019', 1.2]]);
  near(r.value, (((0.967 * 1.013 * 1.018) ** (1 / 3)) - 1) * 100, 1e-9);
  assert.equal(r.n, 3);
});

test('parseSidra identifica a dimensão de período', () => {
  const rows = [
    { V: 'Valor', D1N: 'Brasil', D2N: 'Variável', D3C: 'Trimestre (Código)', D3N: 'Trimestre' },
    { V: '1.5', D3C: '202401', D3N: '1º trimestre 2024' },
    { V: '...', D3C: '202402', D3N: '2º trimestre 2024' },
  ];
  assert.deepEqual(parseSidra(rows), [['2024-03', 1.5]]);
  assert.equal(sidraPeriod('201203', 'Trimestre Móvel'), '2012-03');
  assert.equal(sidraPeriod('2023', 'Ano'), '2023');
});

test('catálogo: ids únicos e todas as métricas apontam para séries existentes', () => {
  const ids = INDICATORS.map(i => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const m of METRICS) assert.ok(ids.includes(m.series), m.series);
});
