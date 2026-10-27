import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify, parseNumbers, splitClaims, norm } from '../js/verify/engine.js';

// Séries sintéticas: o teste não depende de dados baixados.
const months = (from, n, f) => Array.from({ length: n }, (_, i) => {
  const y = +from.slice(0, 4) + Math.floor((+from.slice(5) - 1 + i) / 12), m = ((+from.slice(5) - 1 + i) % 12) + 1;
  return [`${y}-${String(m).padStart(2, '0')}`, f(i)];
});
const SERIES = {
  'ipca-12m': { points: months('2020-01', 80, i => (i === 40 ? 12 : 4 + (i % 3) * 0.1)), fetchedAt: 'x' },
  desocupacao: { points: months('2018-01', 104, i => 12 - i * 0.06), fetchedAt: 'x' },
  'divida-bruta': { points: months('2015-01', 140, i => (i === 70 ? 90 : 70 + (i % 5))), fetchedAt: 'x' },
  'pib-anual': { points: [['2022', 3.0], ['2023', 3.2], ['2024', 3.4], ['2025', 2.3]], fetchedAt: 'x' },
};
const ctx = {
  series: async id => { if (!SERIES[id]) throw new Error('sem série'); return SERIES[id]; },
  spending: async () => ({ years: [2023, 2024], byFn: { Educação: [125e9, 132e9], 'Encargos Especiais': [1e12, 1e12] }, refin: [0, 0], deflator: { 2023: 1.05, 2024: 1 }, deflatorBase: 2024 }),
  emendasMeta: async () => { throw new Error('sem dados'); },
  emendasYear: async () => [],
  today: new Date('2026-10-27'),
};

test('extrai números, percentuais, valores em reais e anos', () => {
  const n = parseNumbers(norm('A inflação chegou a 10,5% em 2021 e o governo gastou R$ 2,5 bilhões'));
  assert.deepEqual(n.pct, [10.5]);
  assert.deepEqual(n.years, ['2021']);
  assert.equal(n.money[0], 2.5e9);
});

test('separa frases e ignora links', () => {
  assert.equal(splitClaims('A inflação subiu. O desemprego caiu! https://exemplo.com/noticia').length, 2);
});

test('valor que nunca ocorreu na série é falso', async () => {
  const r = await verify('A inflação está acima de 20%.', ctx);
  assert.equal(r.results[0].status, 'falso');
});

test('valor que ocorreu há pouco tempo, mas não agora, é desatualizado', async () => {
  const r = await verify('A inflação está acima de 10%.', ctx);
  assert.equal(r.results[0].status, 'desatualizado');
});

test('valor que já foi verdade, mas não agora, é desatualizado ou falso, nunca verdadeiro', async () => {
  const r = await verify('A inflação está em 12%.', ctx);
  assert.notEqual(r.results[0].status, 'verdadeiro');
});

test('direção durante um governo é conferida', async () => {
  const r = await verify('O desemprego caiu no governo Lula 3.', ctx);
  assert.equal(r.results[0].status, 'verdadeiro');
  const r2 = await verify('O desemprego subiu no governo Lula 3.', ctx);
  assert.equal(r2.results[0].status, 'falso');
});

test('recorde histórico compara com o extremo da série', async () => {
  const r = await verify('A dívida pública é a maior da história.', ctx);
  assert.equal(r.results[0].status, 'falso');
});

test('número anual conferido com tolerância', async () => {
  assert.equal((await verify('O PIB cresceu 3,4% em 2024.', ctx)).results[0].status, 'verdadeiro');
  assert.equal((await verify('O PIB cresceu 3% em 2024.', ctx)).results[0].status, 'parcial');
  assert.equal((await verify('O PIB cresceu 6% em 2024.', ctx)).results[0].status, 'falso');
});

test('gastos por área: corte alegado contra aumento registrado é falso', async () => {
  const r = await verify('O governo cortou os gastos com educação em 2024.', ctx);
  assert.equal(r.results[0].status, 'falso');
});

test('acusação sem base oficial é inconclusiva, nunca falsa', async () => {
  const r = await verify('O ministro recebeu propina de uma empreiteira.', ctx);
  assert.equal(r.overall, 'inconclusivo');
  assert.ok(r.where.length > 0);
});

test('assunto sem dado integrado fica não comprovado', async () => {
  const r = await verify('O preço do pão francês triplicou na padaria do bairro.', ctx);
  assert.equal(r.overall, 'nao-comprovado');
});

test('fonte indisponível não vira falso', async () => {
  const r = await verify('As emendas somaram R$ 47 bilhões em 2025.', ctx);
  assert.equal(r.overall, 'nao-comprovado');
});

test('links são registrados com a limitação explicada', async () => {
  const r = await verify('Veja https://exemplo.com/noticia sobre a inflação acima de 10%.', ctx);
  assert.equal(r.urls.length, 1);
  assert.ok(r.limitations.some(l => /links/i.test(l)));
});
